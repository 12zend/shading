/**
 * Share link codec: packs every file of a saved project (project.json and all assets) into one
 * compact binary container, compresses it and encodes it as URL-safe text.
 *
 * Wire format (version 1), before base64url:
 *   u8      FORMAT_VERSION
 *   varint  segment count
 *   per segment: u8 method (METHOD_*), varint byte length, bytes
 *
 * Segment 0 decompresses to the manifest followed by the stored bytes of every inline file:
 *   string  project title
 *   varint  file count
 *   per file: string name, u8 transform (TRANSFORM_*), varint segment (0 = inline), varint stored length
 *   u32     CRC-32 of the original bytes of every file, in manifest order
 * Every other segment holds exactly one large, already-compressed media file.
 *
 * The codec never changes a file: transforms are lossless and verified before they are used, so
 * a decoded project is byte-identical to the saved one.
 */

const FORMAT_VERSION = 1;

const METHOD_STORED = 0;
const METHOD_BROTLI = 1;

const TRANSFORM_NONE = 0;
const TRANSFORM_PCM = 1;

const BEST_QUALITY = 11;
const FAST_QUALITY = 9;
// Formats that are already entropy coded: Brotli barely shrinks them, so large ones are compressed
// on their own at a cheaper quality instead of slowing down the main segment.
const COMPRESSED_MEDIA_EXTENSIONS = new Set([
    'aac', 'avif', 'flac', 'gif', 'jpeg', 'jpg', 'm4a', 'm4v', 'mkv', 'mov', 'mp3', 'mp4', 'oga', 'ogg',
    'opus', 'png', 'webm', 'webp', 'woff', 'woff2', 'zip'
]);
const LARGE_MEDIA_BYTES = 1024 * 1024;
// Past this size quality 11 takes minutes; quality 9 keeps sharing responsive.
const BEST_QUALITY_MAX_BYTES = 32 * 1024 * 1024;

// Text-like files first so Brotli sees similar content next to each other.
const EXTENSION_GROUPS = {
    json: 0,
    svg: 1,
    xml: 1,
    obj: 2,
    mtl: 2,
    gltf: 2,
    txt: 2,
    csv: 2,
    js: 2,
    glsl: 2,
    frag: 2,
    vert: 2,
    md: 2,
    css: 2,
    html: 2,
    ttf: 3,
    otf: 3,
    wav: 4
};
const OTHER_GROUP = 5;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', {fatal: true});

// ---- Byte helpers ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32Update = (crc, bytes) => {
    let c = crc;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return c;
};

const crc32 = bytes => (crc32Update(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;

class ByteWriter {
    constructor (initialSize = 1024) {
        this.buffer = new Uint8Array(initialSize);
        this.length = 0;
    }
    ensure (extra) {
        const needed = this.length + extra;
        if (needed <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < needed) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buffer.subarray(0, this.length));
        this.buffer = next;
    }
    byte (value) {
        this.ensure(1);
        this.buffer[this.length++] = value;
    }
    varint (value) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid varint: ${value}`);
        let rest = value;
        while (rest >= 0x80) {
            this.byte((rest % 0x80) | 0x80);
            rest = Math.floor(rest / 0x80);
        }
        this.byte(rest);
    }
    uint32 (value) {
        this.byte(value & 0xFF);
        this.byte((value >>> 8) & 0xFF);
        this.byte((value >>> 16) & 0xFF);
        this.byte((value >>> 24) & 0xFF);
    }
    bytes (bytes) {
        this.ensure(bytes.length);
        this.buffer.set(bytes, this.length);
        this.length += bytes.length;
    }
    string (value) {
        const bytes = textEncoder.encode(value);
        this.varint(bytes.length);
        this.bytes(bytes);
    }
    finish () {
        return this.buffer.slice(0, this.length);
    }
}

class ByteReader {
    constructor (bytes) {
        this.bytes = bytes;
        this.offset = 0;
    }
    need (count) {
        if (this.offset + count > this.bytes.length) throw new Error('Share link data is truncated.');
    }
    byte () {
        this.need(1);
        return this.bytes[this.offset++];
    }
    varint () {
        let result = 0;
        let scale = 1;
        for (;;) {
            const value = this.byte();
            result += (value & 0x7F) * scale;
            if (!Number.isSafeInteger(result)) throw new Error('Share link data is invalid.');
            if (value < 0x80) return result;
            scale *= 0x80;
        }
    }
    uint32 () {
        this.need(4);
        const b = this.bytes;
        const o = this.offset;
        this.offset += 4;
        return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    }
    take (count) {
        this.need(count);
        const result = this.bytes.subarray(this.offset, this.offset + count);
        this.offset += count;
        return result;
    }
    string () {
        return textDecoder.decode(this.take(this.varint()));
    }
}

// ---- Base64url ------------------------------------------------------------------------------------------------

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_LOOKUP = (() => {
    const lookup = new Int16Array(128).fill(-1);
    for (let i = 0; i < BASE64URL_ALPHABET.length; i++) lookup[BASE64URL_ALPHABET.charCodeAt(i)] = i;
    // Accept standard base64 too, in case a link was re-encoded by another tool.
    lookup['+'.charCodeAt(0)] = 62;
    lookup['/'.charCodeAt(0)] = 63;
    return lookup;
})();

const bytesToBase64Url = bytes => {
    const chunks = [];
    const CHUNK = 3 * 16384;
    for (let start = 0; start < bytes.length; start += CHUNK) {
        const end = Math.min(bytes.length, start + CHUNK);
        let out = '';
        let i = start;
        for (; i + 2 < end; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            out += BASE64URL_ALPHABET[n >> 18] + BASE64URL_ALPHABET[(n >> 12) & 63] +
                BASE64URL_ALPHABET[(n >> 6) & 63] + BASE64URL_ALPHABET[n & 63];
        }
        if (i < end) {
            const n = (bytes[i] << 16) | (i + 1 < end ? bytes[i + 1] << 8 : 0);
            out += BASE64URL_ALPHABET[n >> 18] + BASE64URL_ALPHABET[(n >> 12) & 63];
            if (i + 1 < end) out += BASE64URL_ALPHABET[(n >> 6) & 63];
        }
        chunks.push(out);
    }
    return chunks.join('');
};

const base64UrlToBytes = text => {
    const clean = String(text).replace(/[\s=]+/g, '');
    if (clean.length % 4 === 1) throw new Error('Share link data is truncated.');
    const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let buffer = 0;
    let bits = 0;
    let offset = 0;
    for (let i = 0; i < clean.length; i++) {
        const code = clean.charCodeAt(i);
        const value = code < 128 ? BASE64URL_LOOKUP[code] : -1;
        if (value < 0) throw new Error('Share link contains invalid characters.');
        buffer = ((buffer << 6) | value) & 0xFFFFFF;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output[offset++] = (buffer >> bits) & 0xFF;
        }
    }
    return output.subarray(0, offset);
};

const getExtension = name => {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
};

// ---- Lossless PCM WAV transform -------------------------------------------------------------------------------
// Audio samples are replaced by the residual of a fixed polynomial predictor (as in FLAC), zigzag
// coded and split into byte planes. Brotli compresses those far better than interleaved samples.

const parseWav = bytes => {
    if (bytes.length < 44) return null;
    const ascii = (offset, length) => String.fromCharCode.apply(null, bytes.subarray(offset, offset + length));
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let format = null;
    while (offset + 8 <= bytes.length) {
        const id = ascii(offset, 4);
        const size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
            let tag = view.getUint16(body, true);
            if (tag === 0xFFFE && size >= 26 && body + 26 <= bytes.length) tag = view.getUint16(body + 24, true);
            format = {
                tag,
                channels: view.getUint16(body + 2, true),
                blockAlign: view.getUint16(body + 12, true),
                bitsPerSample: view.getUint16(body + 14, true)
            };
        } else if (id === 'data') {
            if (!format || format.tag !== 1) return null;
            const bytesPerSample = format.bitsPerSample / 8;
            if (![1, 2, 3, 4].includes(bytesPerSample)) return null;
            if (format.channels < 1 || format.channels > 255) return null;
            if (format.blockAlign !== format.channels * bytesPerSample) return null;
            const dataLength = Math.min(size, bytes.length - body);
            const frames = Math.floor(dataLength / format.blockAlign);
            if (frames < 16) return null;
            return {
                dataOffset: body,
                pcmLength: frames * format.blockAlign,
                channels: format.channels,
                bytesPerSample,
                frames
            };
        }
        offset = body + size + (size & 1);
    }
    return null;
};

const makeSampleCodec = bytesPerSample => {
    const modulus = 2 ** (8 * bytesPerSample);
    const half = modulus / 2;
    // 8-bit PCM is unsigned; wider PCM is two's complement.
    const signed = bytesPerSample > 1;
    const wrapSigned = value => {
        let wrapped = value % modulus;
        if (wrapped < 0) wrapped += modulus;
        return wrapped >= half ? wrapped - modulus : wrapped;
    };
    const wrapSample = value => {
        let wrapped = value % modulus;
        if (wrapped < 0) wrapped += modulus;
        return signed && wrapped >= half ? wrapped - modulus : wrapped;
    };
    return {modulus, signed, wrapSigned, wrapSample};
};

const readSample = (bytes, offset, bytesPerSample, signed) => {
    let value = 0;
    let scale = 1;
    for (let k = 0; k < bytesPerSample; k++) {
        value += bytes[offset + k] * scale;
        scale *= 256;
    }
    if (signed && value >= scale / 2) value -= scale;
    return value;
};

const predict = (order, a, b, c) => {
    if (order === 1) return a;
    if (order === 2) return (2 * a) - b;
    return (3 * a) - (3 * b) + c;
};

const chooseOrder = (bytes, wav, codec) => {
    const {dataOffset, channels, bytesPerSample, frames} = wav;
    const totals = [0, 0, 0];
    const step = Math.max(1, Math.floor(frames / 262144));
    for (let channel = 0; channel < channels; channel++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let frame = 0; frame < frames; frame += step) {
            const offset = dataOffset + (((frame * channels) + channel) * bytesPerSample);
            const value = readSample(bytes, offset, bytesPerSample, codec.signed);
            if (step === 1 || frame > 0) {
                for (let order = 1; order <= 3; order++) {
                    totals[order - 1] += Math.abs(codec.wrapSigned(value - predict(order, a, b, c)));
                }
            }
            c = b;
            b = a;
            a = value;
        }
    }
    let best = 1;
    for (let order = 2; order <= 3; order++) {
        if (totals[order - 1] < totals[best - 1]) best = order;
    }
    return best;
};

const encodePcm = bytes => {
    const wav = parseWav(bytes);
    if (!wav) return null;
    const {dataOffset, pcmLength, channels, bytesPerSample, frames} = wav;
    const codec = makeSampleCodec(bytesPerSample);
    const order = chooseOrder(bytes, wav, codec);
    const header = bytes.subarray(0, dataOffset);
    const trailer = bytes.subarray(dataOffset + pcmLength);

    const writer = new ByteWriter(pcmLength + header.length + trailer.length + 32);
    writer.varint(header.length);
    writer.bytes(header);
    writer.varint(trailer.length);
    writer.bytes(trailer);
    writer.byte(channels);
    writer.byte(bytesPerSample);
    writer.byte(order);
    writer.varint(frames);

    const samples = frames * channels;
    writer.ensure(pcmLength);
    const planes = writer.buffer;
    const planeStart = writer.length;
    for (let channel = 0; channel < channels; channel++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let frame = 0; frame < frames; frame++) {
            const offset = dataOffset + (((frame * channels) + channel) * bytesPerSample);
            const value = readSample(bytes, offset, bytesPerSample, codec.signed);
            const residual = codec.wrapSigned(value - predict(order, a, b, c));
            let zigzag = residual >= 0 ? residual * 2 : (-residual * 2) - 1;
            const index = planeStart + (channel * frames) + frame;
            for (let k = 0; k < bytesPerSample; k++) {
                planes[index + (k * samples)] = zigzag % 256;
                zigzag = Math.floor(zigzag / 256);
            }
            c = b;
            b = a;
            a = value;
        }
    }
    writer.length += pcmLength;
    return writer.finish();
};

const decodePcm = encoded => {
    const reader = new ByteReader(encoded);
    const header = reader.take(reader.varint());
    const trailer = reader.take(reader.varint());
    const channels = reader.byte();
    const bytesPerSample = reader.byte();
    const order = reader.byte();
    const frames = reader.varint();
    if (channels < 1 || bytesPerSample < 1 || bytesPerSample > 4 || order < 1 || order > 3) {
        throw new Error('Share link audio data is invalid.');
    }
    const samples = frames * channels;
    const pcmLength = samples * bytesPerSample;
    const planes = reader.take(pcmLength);
    const codec = makeSampleCodec(bytesPerSample);

    const output = new Uint8Array(header.length + pcmLength + trailer.length);
    output.set(header, 0);
    output.set(trailer, header.length + pcmLength);
    const dataOffset = header.length;
    for (let channel = 0; channel < channels; channel++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let frame = 0; frame < frames; frame++) {
            const index = (channel * frames) + frame;
            let zigzag = 0;
            let scale = 1;
            for (let k = 0; k < bytesPerSample; k++) {
                zigzag += planes[index + (k * samples)] * scale;
                scale *= 256;
            }
            const residual = zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
            const value = codec.wrapSample(predict(order, a, b, c) + residual);
            let raw = value < 0 ? value + codec.modulus : value;
            const offset = dataOffset + (((frame * channels) + channel) * bytesPerSample);
            for (let k = 0; k < bytesPerSample; k++) {
                output[offset + k] = raw % 256;
                raw = Math.floor(raw / 256);
            }
            c = b;
            b = a;
            a = value;
        }
    }
    return output;
};

const bytesEqual = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const applyTransform = (name, bytes) => {
    if (getExtension(name) !== 'wav') return {transform: TRANSFORM_NONE, stored: bytes};
    let encoded = null;
    try {
        encoded = encodePcm(bytes);
    } catch (error) {
        encoded = null;
    }
    // Only keep the transform when it provably restores the exact original file.
    if (encoded && bytesEqual(decodePcm(encoded), bytes)) {
        return {transform: TRANSFORM_PCM, stored: encoded};
    }
    return {transform: TRANSFORM_NONE, stored: bytes};
};

const reverseTransform = (transform, stored) => {
    if (transform === TRANSFORM_NONE) return stored;
    if (transform === TRANSFORM_PCM) return decodePcm(stored);
    throw new Error('This share link needs a newer version of Shading.');
};

// ---- Container ------------------------------------------------------------------------------------------------

const fileRank = name => {
    if (name === 'project.json') return -1;
    const group = EXTENSION_GROUPS[getExtension(name)];
    return typeof group === 'number' ? group : OTHER_GROUP;
};

const orderFiles = files => files.slice().sort((a, b) => (
    (fileRank(a.name) - fileRank(b.name)) ||
    getExtension(a.name).localeCompare(getExtension(b.name)) ||
    (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0))
));

const toUint8Array = data => {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return textEncoder.encode(data);
    throw new TypeError('Unsupported file data.');
};

const qualityFor = size => (size > BEST_QUALITY_MAX_BYTES ? FAST_QUALITY : BEST_QUALITY);

const compressSegment = (brotli, bytes, quality, onProgress) => {
    if (bytes.length === 0) return {method: METHOD_STORED, bytes};
    const compressed = toUint8Array(brotli.compress(bytes, quality, onProgress));
    if (compressed.length < bytes.length) return {method: METHOD_BROTLI, bytes: compressed};
    return {method: METHOD_STORED, bytes};
};

/**
 * @param {object} project {files, title}: files is an array of {name, data} or a map of name to bytes.
 * @param {object} brotli Brotli implementation: compress(bytes, quality, onProgress) may call onProgress with the
 *   number of input bytes consumed so far.
 * @param {function({stage: string, done: number, total: number})} [onProgress] Progress callback.
 * @returns {Uint8Array} Encoded share data.
 */
const encodeShareData = (project, brotli, onProgress) => {
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    const input = Array.isArray(project.files) ?
        project.files :
        Object.keys(project.files).map(name => ({name, data: project.files[name]}));
    const seen = new Set();
    const files = orderFiles(input.map(file => ({name: String(file.name), data: toUint8Array(file.data)})))
        .filter(file => {
            if (seen.has(file.name)) return false;
            seen.add(file.name);
            return true;
        });
    if (!seen.has('project.json')) throw new Error('The project has no project.json.');

    const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0);
    let doneBytes = 0;
    report({stage: 'prepare', done: 0, total: totalBytes});

    let crc = 0xFFFFFFFF;
    const entries = [];
    const separate = [];
    for (const file of files) {
        crc = crc32Update(crc, file.data);
        const {transform, stored} = applyTransform(file.name, file.data);
        const isLargeMedia = COMPRESSED_MEDIA_EXTENSIONS.has(getExtension(file.name)) &&
            stored.length >= LARGE_MEDIA_BYTES;
        const segment = isLargeMedia ? separate.length + 1 : 0;
        if (isLargeMedia) separate.push({stored, original: file.data.length});
        entries.push({name: file.name, transform, segment, stored});
    }

    const main = new ByteWriter();
    main.string(String(project.title || ''));
    main.varint(entries.length);
    for (const entry of entries) {
        main.string(entry.name);
        main.byte(entry.transform);
        main.varint(entry.segment);
        main.varint(entry.stored.length);
    }
    main.uint32((crc ^ 0xFFFFFFFF) >>> 0);
    let inlineOriginal = 0;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].segment !== 0) continue;
        main.bytes(entries[i].stored);
        inlineOriginal += files[i].data.length;
    }
    const mainBytes = main.finish();

    // Progress is measured in original file bytes; a segment's consumed input is scaled accordingly.
    const compressWithProgress = (bytes, quality, originalBytes) => {
        const start = doneBytes;
        const segment = compressSegment(brotli, bytes, quality, consumed => {
            const fraction = bytes.length ? Math.min(1, consumed / bytes.length) : 1;
            report({stage: 'compress', done: start + Math.floor(originalBytes * fraction), total: totalBytes});
        });
        doneBytes = start + originalBytes;
        report({stage: 'compress', done: doneBytes, total: totalBytes});
        return segment;
    };
    report({stage: 'compress', done: doneBytes, total: totalBytes});
    const segments = [compressWithProgress(mainBytes, qualityFor(mainBytes.length), inlineOriginal)];
    for (const media of separate) {
        segments.push(compressWithProgress(media.stored, FAST_QUALITY, media.original));
    }

    const out = new ByteWriter(segments.reduce((sum, segment) => sum + segment.bytes.length + 12, 8));
    out.byte(FORMAT_VERSION);
    out.varint(segments.length);
    for (const segment of segments) {
        out.byte(segment.method);
        out.varint(segment.bytes.length);
        out.bytes(segment.bytes);
    }
    return out.finish();
};

const expandSegment = (brotli, method, bytes) => {
    if (method === METHOD_STORED) return bytes;
    if (method === METHOD_BROTLI) {
        try {
            return toUint8Array(brotli.decompress(bytes));
        } catch (error) {
            throw new Error('Share link data is damaged or incomplete.');
        }
    }
    throw new Error('This share link needs a newer version of Shading.');
};

/**
 * @param {Uint8Array} data Encoded share data.
 * @param {{decompress: function(Uint8Array): Uint8Array}} brotli Brotli implementation.
 * @returns {{title: string, files: Array<{name: string, data: Uint8Array}>}} Decoded project files.
 */
const decodeShareData = (data, brotli) => {
    const reader = new ByteReader(toUint8Array(data));
    const version = reader.byte();
    if (version !== FORMAT_VERSION) {
        throw new Error(version > FORMAT_VERSION ?
            'This share link needs a newer version of Shading.' :
            'This is not a Shading share link.');
    }
    const segmentCount = reader.varint();
    if (segmentCount < 1) throw new Error('Share link data is invalid.');
    const rawSegments = [];
    for (let i = 0; i < segmentCount; i++) {
        const method = reader.byte();
        rawSegments.push({method, bytes: reader.take(reader.varint())});
    }
    if (reader.offset !== reader.bytes.length) throw new Error('Share link data is invalid.');

    const main = new ByteReader(expandSegment(brotli, rawSegments[0].method, rawSegments[0].bytes));
    const title = main.string();
    const count = main.varint();
    const entries = [];
    for (let i = 0; i < count; i++) {
        const name = main.string();
        const transform = main.byte();
        const segment = main.varint();
        const length = main.varint();
        if (segment >= segmentCount) throw new Error('Share link data is invalid.');
        entries.push({name, transform, segment, length});
    }
    const expectedCrc = main.uint32();

    let crc = 0xFFFFFFFF;
    const files = [];
    for (const entry of entries) {
        let stored;
        if (entry.segment === 0) {
            stored = main.take(entry.length);
        } else {
            const raw = rawSegments[entry.segment];
            stored = expandSegment(brotli, raw.method, raw.bytes);
            if (stored.length !== entry.length) throw new Error('Share link data is damaged or incomplete.');
        }
        const original = reverseTransform(entry.transform, stored);
        crc = crc32Update(crc, original);
        files.push({name: entry.name, data: original});
    }
    if (main.offset !== main.bytes.length || ((crc ^ 0xFFFFFFFF) >>> 0) !== expectedCrc) {
        throw new Error('Share link data is damaged or incomplete.');
    }
    if (!files.some(file => file.name === 'project.json')) throw new Error('Share link data is invalid.');
    return {title, files};
};

export {
    FORMAT_VERSION,
    base64UrlToBytes,
    bytesToBase64Url,
    crc32,
    decodePcm,
    decodeShareData,
    encodePcm,
    encodeShareData
};
