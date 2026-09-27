/**
 * Media recompression for share links. Images, sounds and videos are already compressed, so the lossless codec
 * cannot shrink them much; at a quality below "original" they are re-encoded lossily:
 *   - PNG images embedded in SVG costumes become WebP inside the SVG, at the same pixel size (at "small", no
 *     larger than twice their size on the stage).
 *   - Opaque PNG costumes become JPEG, a format Scratch projects support. PNGs with transparency stay.
 *   - Sounds (MP3 and WAV) become MP3 at the same sample rate. The encoder delay is skipped, so sounds stay
 *     in sync with the timeline.
 *   - Videos keep their container family (MP4/MOV -> MP4 with H.264, WebM -> WebM with VP9/VP8), size, frame
 *     rate and duration: the editor derives on-stage size from the video's pixel size. Their audio is copied
 *     (it is small next to the picture, and macOS runs its AAC encoder in the GPU process, which low bitrates
 *     crash).
 * A file is only replaced when the result is clearly smaller; anything that cannot be decoded or encoded in
 * this browser is shared unchanged. Replaced files get new md5 names and project.json follows them.
 *
 * Runs on the main thread: decoding audio needs an AudioContext, which workers do not have.
 */
import md5 from 'js-md5';
import {Mp3Encoder} from '@breezystack/lamejs';
import {floatToInt16} from '../audio/audio-encoder';

const PROJECT_JSON = 'project.json';

const MEDIA_QUALITIES = {
    original: null,
    standard: {
        imageQuality: 0.9,
        stereoKbps: 96,
        monoKbps: 64,
        videoBitsPerPixel: 0.02
    },
    small: {
        imageQuality: 0.75,
        // Embedded images are scaled down to this many pixels per unit of their size on the stage, which is
        // sharp on the stage but softer in movies rendered above stage size.
        imagePixelsPerUnit: 2,
        stereoKbps: 64,
        monoKbps: 48,
        videoBitsPerPixel: 0.01
    }
};
const DEFAULT_MEDIA_QUALITY = 'standard';

// A re-encoded file must be at most this fraction of the original to replace it.
const MAX_SIZE_RATIO = 0.85;
const MIN_VIDEO_BITRATE = 150000;
// A video conversion that makes no progress for this long is abandoned (for example after the GPU process
// crashed, which leaves hardware encoders waiting forever).
const VIDEO_STALL_MS = 20000;
// Hardware encoders can take down the GPU process at low bitrates, which stalls the whole page.
const hardwareAcceleration = 'prefer-software';
const EMBEDDED_PNG_PATTERN = /data:image\/png;base64,([A-Za-z0-9+/=\s]+)/g;
const SOUND_EXTENSIONS = new Set(['mp3', 'wav']);
const MP4_VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4']);
const WEBM_VIDEO_EXTENSIONS = new Set(['webm']);
const MP3_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const MP3_BLOCK_SIZE = 1152;
// Longest encoder plus decoder delay searched for, in input samples. LAME may resample internally at low
// bitrates, so the delay depends on the settings and is measured instead of assumed.
const MAX_MP3_DELAY = 8192;
const MIN_DELAY_CORRELATION = 0.5;
// Keeps the page responsive while LAME runs on the main thread.
const MP3_BLOCKS_PER_YIELD = 64;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const getExtension = name => {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
};

// A message round trip instead of setTimeout, which background tabs throttle to once a second or less.
const yieldToBrowser = () => new Promise(resolve => {
    if (typeof MessageChannel !== 'function') {
        setTimeout(resolve, 0);
        return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
    };
    channel.port2.postMessage(null);
});

// ---- project.json ---------------------------------------------------------------------------------------------

/**
 * The images, sounds and videos in a project that recompression can shrink.
 * @param {Array<{name: string, data: Uint8Array}>} files Project files.
 * @returns {Array<{name: string, kind: string}>} Media files, each once.
 */
const getRecompressibleMedia = files => {
    const projectFile = files.find(file => file.name === PROJECT_JSON);
    if (!projectFile) return [];
    let project;
    try {
        project = JSON.parse(textDecoder.decode(projectFile.data));
    } catch (error) {
        return [];
    }
    const names = new Set(files.map(file => file.name));
    const media = new Map();
    const targets = Array.isArray(project.targets) ? project.targets : [];
    for (const target of targets) {
        const costumes = target && Array.isArray(target.costumes) ? target.costumes : [];
        for (const costume of costumes) {
            const name = costume && costume.md5ext;
            if (typeof name !== 'string' || !names.has(name) || media.has(name)) continue;
            const extension = getExtension(name);
            if (extension === 'png') media.set(name, {name, kind: 'bitmap'});
            if (extension === 'svg') media.set(name, {name, kind: 'vector'});
        }
        const sounds = target && Array.isArray(target.sounds) ? target.sounds : [];
        for (const sound of sounds) {
            const name = sound && sound.md5ext;
            if (typeof name !== 'string' || !names.has(name) || media.has(name)) continue;
            if (!SOUND_EXTENSIONS.has(getExtension(name))) continue;
            media.set(name, {name, kind: 'sound'});
        }
    }
    const videos = Array.isArray(project.movieVideos) ? project.movieVideos : [];
    for (const video of videos) {
        const name = video && video.md5ext;
        if (typeof name !== 'string' || !names.has(name) || media.has(name)) continue;
        const extension = getExtension(name);
        if (!MP4_VIDEO_EXTENSIONS.has(extension) && !WEBM_VIDEO_EXTENSIONS.has(extension)) continue;
        media.set(name, {name, kind: 'video'});
    }
    return Array.from(media.values());
};

/**
 * Points project.json at replaced media files.
 * @param {Uint8Array} projectJSON Saved project.json.
 * @param {Map<string, {name: string, mimeType: ?string}>} replacements Old file name to the new file.
 * @returns {Uint8Array} Updated project.json.
 */
const updateProjectMedia = (projectJSON, replacements) => {
    const renamed = new Map();
    for (const [from, to] of replacements) {
        renamed.set(from, to.name);
        renamed.set(from.split('.')[0], to.name.split('.')[0]);
    }
    const visit = value => {
        if (typeof value === 'string') return renamed.has(value) ? renamed.get(value) : value;
        if (Array.isArray(value)) return value.map(visit);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const key of Object.keys(value)) result[key] = visit(value[key]);
        const replacement = typeof value.md5ext === 'string' && replacements.get(value.md5ext);
        if (replacement) {
            const dataFormat = getExtension(replacement.name);
            if ('dataFormat' in value) result.dataFormat = dataFormat;
            // ADPCM describes the WAV data; the new file is MP3.
            if (value.format === 'adpcm') result.format = '';
            if ('mimeType' in value && replacement.mimeType) result.mimeType = replacement.mimeType;
        }
        return result;
    };
    const project = visit(JSON.parse(textDecoder.decode(projectJSON)));
    return textEncoder.encode(JSON.stringify(project));
};

// ---- Sounds ---------------------------------------------------------------------------------------------------

const MP3_SAMPLE_RATE_TABLE = [
    [11025, 12000, 8000], // MPEG 2.5
    null,
    [22050, 24000, 16000], // MPEG 2
    [44100, 48000, 32000] // MPEG 1
];

// The sample rate stored in the file itself; project.json's rate is not always accurate.
const readSampleRate = data => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ascii = (offset, length) => String.fromCharCode(...data.subarray(offset, offset + length));
    if (data.length >= 28 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') {
        for (let offset = 12; offset + 16 <= data.length;) {
            const size = view.getUint32(offset + 4, true);
            if (ascii(offset, 4) === 'fmt ' && offset + 16 <= data.length) return view.getUint32(offset + 12, true);
            offset += 8 + size + (size & 1);
        }
        return 0;
    }
    let offset = 0;
    // Skip an ID3v2 tag (its size is a 28-bit syncsafe integer).
    if (data.length >= 10 && ascii(0, 3) === 'ID3') {
        offset = 10 + ((data[6] & 0x7F) << 21) + ((data[7] & 0x7F) << 14) + ((data[8] & 0x7F) << 7) + (data[9] & 0x7F);
    }
    for (; offset + 4 <= data.length; offset++) {
        if (data[offset] !== 0xFF || (data[offset + 1] & 0xE0) !== 0xE0) continue;
        const rates = MP3_SAMPLE_RATE_TABLE[(data[offset + 1] >> 3) & 3];
        const layer = (data[offset + 1] >> 1) & 3;
        const index = (data[offset + 2] >> 2) & 3;
        if (rates && layer === 1 && index < 3) return rates[index];
    }
    return 0;
};

const decodeAudio = (data, sampleRate) => {
    const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Context) return Promise.resolve(null);
    // Decoding at the file's own rate avoids resampling.
    const context = new Context(1, 1, sampleRate);
    // decodeAudioData detaches its buffer, so it gets a copy.
    return context.decodeAudioData(data.slice().buffer);
};

const isMono = channels => {
    if (channels.length < 2) return true;
    const [left, right] = channels;
    for (let i = 0; i < left.length; i++) {
        if (Math.abs(left[i] - right[i]) > 1 / 32768) return false;
    }
    return true;
};

const encodeMp3 = async (channels, sampleRate, kbps, skip, onFraction) => {
    const samples = channels.map(floatToInt16);
    const encoder = new Mp3Encoder(samples.length, sampleRate, kbps);
    const chunks = [];
    let byteLength = 0;
    const collect = chunk => {
        if (chunk.length) {
            chunks.push(chunk);
            byteLength += chunk.length;
        }
    };
    const length = samples[0].length;
    // Starting `skip` samples in makes the decoded output line up with the original.
    let blocks = 0;
    for (let offset = Math.min(skip, length); offset < length; offset += MP3_BLOCK_SIZE) {
        const end = Math.min(length, offset + MP3_BLOCK_SIZE);
        collect(samples.length > 1 ?
            encoder.encodeBuffer(samples[0].subarray(offset, end), samples[1].subarray(offset, end)) :
            encoder.encodeBuffer(samples[0].subarray(offset, end)));
        if (++blocks % MP3_BLOCKS_PER_YIELD === 0) {
            onFraction(offset / length);
            await yieldToBrowser();
        }
    }
    collect(encoder.flush());
    const encoded = new Uint8Array(byteLength);
    let position = 0;
    for (const chunk of chunks) {
        encoded.set(chunk, position);
        position += chunk.length;
    }
    return encoded;
};

const delays = new Map();

// Encodes and decodes a noise burst with the same settings to find how late decoded output starts.
const measureMp3Delay = async (channelCount, sampleRate, kbps) => {
    const key = `${channelCount}:${sampleRate}:${kbps}`;
    if (delays.has(key)) return delays.get(key);
    const burstStart = Math.floor(sampleRate / 4);
    const burstLength = Math.floor(sampleRate / 4);
    const probe = new Float32Array(sampleRate);
    let seed = 1;
    for (let i = burstStart; i < burstStart + burstLength; i++) {
        seed = ((seed * 1103515245) + 12345) >>> 0;
        probe[i] = ((seed / 0x100000000) - 0.5) * 0.8;
    }
    const encoded = await encodeMp3(new Array(channelCount).fill(probe), sampleRate, kbps, 0, () => {});
    const decoded = (await decodeAudio(encoded, sampleRate)).getChannelData(0);
    let best = -1;
    let delay = -1;
    for (let lag = 0; lag <= MAX_MP3_DELAY; lag++) {
        let product = 0;
        let probeEnergy = 0;
        let decodedEnergy = 0;
        for (let i = burstStart; i < burstStart + burstLength; i += 2) {
            const value = decoded[i + lag] || 0;
            product += probe[i] * value;
            probeEnergy += probe[i] * probe[i];
            decodedEnergy += value * value;
        }
        const correlation = product / Math.sqrt((probeEnergy * decodedEnergy) + 1e-12);
        if (correlation > best) {
            best = correlation;
            delay = lag;
        }
    }
    const result = best >= MIN_DELAY_CORRELATION ? delay : -1;
    delays.set(key, result);
    return result;
};

const recompressSound = async (file, preset, onFraction) => {
    const sampleRate = readSampleRate(file.data);
    if (!MP3_SAMPLE_RATES.has(sampleRate)) return null;
    let buffer;
    try {
        buffer = await decodeAudio(file.data, sampleRate);
    } catch (error) {
        // For example ADPCM WAV, which only Scratch's own decoder reads.
        return null;
    }
    if (!buffer || buffer.sampleRate !== sampleRate || buffer.numberOfChannels > 2 || buffer.length === 0) {
        return null;
    }
    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    const mono = isMono(channels);
    const used = mono ? channels.slice(0, 1) : channels;
    const kbps = mono ? preset.monoKbps : preset.stereoKbps;
    const delay = await measureMp3Delay(used.length, sampleRate, kbps);
    if (delay < 0) return null;
    const data = await encodeMp3(used, sampleRate, kbps, delay, onFraction);
    return {data, extension: 'mp3', mimeType: null};
};

// ---- Images ---------------------------------------------------------------------------------------------------

// Draws an image at its own size (or the given smaller size), without premultiplying or converting colors.
const drawImage = async (data, size) => {
    const bitmap = await createImageBitmap(new Blob([data]), Object.assign({
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none'
    }, size ? {resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high'} : {}));
    const canvas = typeof OffscreenCanvas === 'function' ?
        new OffscreenCanvas(bitmap.width, bitmap.height) :
        Object.assign(document.createElement('canvas'), {width: bitmap.width, height: bitmap.height});
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === 'function') bitmap.close();
    return {canvas, context};
};

const encodeCanvas = async (canvas, type, quality) => {
    const blob = typeof canvas.convertToBlob === 'function' ?
        await canvas.convertToBlob({type, quality}) :
        await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    // Browsers that cannot encode the type fall back to PNG.
    if (!blob || blob.type !== type) return null;
    return new Uint8Array(await blob.arrayBuffer());
};

const isOpaque = ({canvas, context}) => {
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) return false;
    }
    return true;
};

const recompressBitmap = async (file, preset) => {
    const image = await drawImage(file.data);
    if (!isOpaque(image)) return null;
    const data = await encodeCanvas(image.canvas, 'image/jpeg', preset.imageQuality);
    return data && {data, extension: 'jpg', mimeType: null};
};

const base64ToBytes = text => {
    const binary = atob(text.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const bytesToBase64 = bytes => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
};

const readAttribute = (tag, name) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
    return match ? match[1] : null;
};

// How many units on the stage one unit of the element's own width covers, from its transform attribute.
const readScale = transform => {
    if (!transform) return 1;
    const scale = /^\s*scale\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)\s*$/.exec(transform);
    if (scale) return Math.max(Math.abs(Number(scale[1])), Math.abs(Number(scale[2] || scale[1])));
    const matrix = /^\s*matrix\(\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/.exec(transform);
    if (matrix) {
        const [a, b, c, d] = matrix.slice(1, 5).map(Number);
        return Math.max(Math.hypot(a, b), Math.hypot(c, d));
    }
    return /^\s*translate\([^)]*\)\s*$/.test(transform) ? 1 : null;
};

// The pixel size an embedded image needs at the preset's resolution, or null to keep its own size.
const getTargetSize = (text, index, preset, image) => {
    if (!preset.imagePixelsPerUnit) return null;
    const tagStart = text.lastIndexOf('<image', index);
    const tagEnd = text.indexOf('>', index);
    if (tagStart < 0 || tagEnd < 0 || text.lastIndexOf('>', index) > tagStart) return null;
    const tag = text.slice(tagStart, tagEnd + 1);
    const scale = readScale(readAttribute(tag, 'transform'));
    const width = Number(readAttribute(tag, 'width'));
    const height = Number(readAttribute(tag, 'height'));
    if (!scale || !(width > 0) || !(height > 0)) return null;
    const factor = Math.min(1, (width * scale * preset.imagePixelsPerUnit) / image.width,
        (height * scale * preset.imagePixelsPerUnit) / image.height);
    if (factor > 0.9) return null;
    return {
        width: Math.max(1, Math.round(image.width * factor)),
        height: Math.max(1, Math.round(image.height * factor))
    };
};

const readPngSize = png => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    return png.length >= 24 ? {width: view.getUint32(16), height: view.getUint32(20)} : null;
};

// Replaces PNGs embedded in an SVG with WebP where that is clearly smaller.
const recompressVector = async (file, preset, onFraction) => {
    const text = textDecoder.decode(file.data);
    const matches = Array.from(text.matchAll(EMBEDDED_PNG_PATTERN));
    if (!matches.length) return null;
    const parts = [];
    let position = 0;
    let changed = false;
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        parts.push(text.slice(position, match.index));
        position = match.index + match[0].length;
        let replacement = match[0];
        try {
            const png = base64ToBytes(match[1]);
            const size = readPngSize(png);
            const target = size && getTargetSize(text, match.index, preset, size);
            const webp = await encodeCanvas((await drawImage(png, target)).canvas, 'image/webp',
                preset.imageQuality);
            if (webp && webp.length <= png.length * MAX_SIZE_RATIO) {
                replacement = `data:image/webp;base64,${bytesToBase64(webp)}`;
                changed = true;
            }
        } catch (error) {
            // Keep images the browser cannot decode.
        }
        parts.push(replacement);
        onFraction((i + 1) / matches.length);
    }
    parts.push(text.slice(position));
    return changed ? {data: textEncoder.encode(parts.join('')), extension: 'svg', mimeType: null} : null;
};

// ---- Videos ---------------------------------------------------------------------------------------------------

const recompressVideo = async (file, preset, onFraction) => {
    const mediabunny = await import(/* webpackChunkName: "mediabunny" */ 'mediabunny');
    const webm = WEBM_VIDEO_EXTENSIONS.has(getExtension(file.name));
    const input = new mediabunny.Input({
        source: new mediabunny.BufferSource(file.data),
        formats: mediabunny.ALL_FORMATS
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;
    // MP4 output cannot carry transparency.
    if (!webm && await videoTrack.canBeTransparent()) return null;
    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;
    const stats = await videoTrack.computePacketStats();
    const frameRate = stats.averagePacketRate || 30;
    const bitrate = Math.max(MIN_VIDEO_BITRATE, Math.round(width * height * frameRate * preset.videoBitsPerPixel));
    if (!(bitrate < stats.averageBitrate * MAX_SIZE_RATIO)) return null;

    // H.264 plays everywhere; WebM keeps VP9/VP8 so transparency survives.
    let codec = null;
    for (const candidate of webm ? ['vp9', 'vp8'] : ['avc']) {
        const options = {width, height, quality: new mediabunny.Quality({bitrate}), hardwareAcceleration};
        if (await mediabunny.canEncodeVideo(candidate, options)) {
            codec = candidate;
            break;
        }
    }
    if (!codec) return null;
    const output = new mediabunny.Output({
        format: webm ? new mediabunny.WebMOutputFormat() : new mediabunny.Mp4OutputFormat(),
        target: new mediabunny.BufferTarget()
    });
    const conversion = await mediabunny.Conversion.init({
        input,
        output,
        video: {
            codec,
            quality: new mediabunny.Quality({bitrate}),
            alpha: webm ? 'keep' : 'discard',
            hardwareAcceleration,
            forceTranscode: true
        },
        showWarnings: false
    });
    // Never drop a track the original had.
    if (!conversion.isValid || conversion.discardedTracks.length) return null;
    let lastProgress = Date.now();
    conversion.onProgress = progress => {
        lastProgress = Date.now();
        onFraction(progress);
    };
    let watchdog = null;
    const stalled = new Promise((resolve, reject) => {
        const check = () => {
            if (Date.now() - lastProgress < VIDEO_STALL_MS) {
                watchdog = setTimeout(check, 1000);
                return;
            }
            conversion.cancel().catch(() => {});
            reject(new Error('Video conversion stopped making progress.'));
        };
        watchdog = setTimeout(check, 1000);
    });
    try {
        await Promise.race([conversion.execute(), stalled]);
    } finally {
        clearTimeout(watchdog);
    }
    return {
        data: new Uint8Array(output.target.buffer),
        extension: webm ? 'webm' : 'mp4',
        mimeType: webm ? 'video/webm' : 'video/mp4'
    };
};

// ---- Projects -------------------------------------------------------------------------------------------------

const RECOMPRESSORS = {
    bitmap: recompressBitmap,
    sound: recompressSound,
    vector: recompressVector,
    video: recompressVideo
};

// Results of the last run, so changing another share option does not re-encode every file again.
const cache = new Map();

/**
 * Re-encodes the project's sounds and videos at the given quality.
 * @param {Array<{name: string, data: Uint8Array}>} files Project files.
 * @param {string} quality One of MEDIA_QUALITIES.
 * @param {function({stage: string, done: number, total: number})} [onProgress] Progress callback.
 * @returns {Promise<{files: Array<{name: string, data: Uint8Array}>,
 *   media: Array<{name: string, originalBytes: number, optimizedBytes: number}>}>} Files and what changed.
 */
const recompressProjectMedia = async (files, quality, onProgress) => {
    const preset = MEDIA_QUALITIES[quality];
    const candidates = preset ? getRecompressibleMedia(files) : [];
    if (!candidates.length) return {files, media: []};
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    const byName = new Map(files.map(file => [file.name, file]));
    const total = candidates.reduce((sum, item) => sum + byName.get(item.name).data.length, 0);
    let done = 0;
    report({stage: 'media', done, total});

    const nextCache = new Map();
    const replacements = new Map();
    const media = [];
    for (const item of candidates) {
        const file = byName.get(item.name);
        const key = `${quality}:${item.name}`;
        let result = cache.get(key);
        if (typeof result === 'undefined') {
            const start = done;
            const onFraction = fraction => report({
                stage: 'media',
                done: start + Math.floor(file.data.length * Math.min(1, Math.max(0, fraction))),
                total
            });
            try {
                const encoded = await RECOMPRESSORS[item.kind](file, preset, onFraction);
                result = encoded && encoded.data.length <= file.data.length * MAX_SIZE_RATIO ?
                    {
                        name: `${md5(encoded.data)}.${encoded.extension}`,
                        data: encoded.data,
                        mimeType: encoded.mimeType
                    } :
                    null;
            } catch (error) {
                // Unsupported codecs and damaged media are shared as they are.
                result = null;
            }
        }
        nextCache.set(key, result);
        done += file.data.length;
        report({stage: 'media', done, total});
        if (!result) continue;
        replacements.set(item.name, result);
        media.push({name: item.name, originalBytes: file.data.length, optimizedBytes: result.data.length});
    }
    cache.clear();
    nextCache.forEach((value, key) => cache.set(key, value));
    if (!replacements.size) return {files, media};

    return {
        files: files.map(file => {
            if (file.name === PROJECT_JSON) return {name: file.name, data: updateProjectMedia(file.data, replacements)};
            const replacement = replacements.get(file.name);
            return replacement ? {name: replacement.name, data: replacement.data} : file;
        }),
        media
    };
};

export {
    DEFAULT_MEDIA_QUALITY,
    MEDIA_QUALITIES,
    getRecompressibleMedia,
    recompressProjectMedia,
    updateProjectMedia
};
