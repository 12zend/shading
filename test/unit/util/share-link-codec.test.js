import zlib from 'zlib';
import {
    base64UrlToBytes,
    bytesToBase64Url,
    crc32,
    decodePcm,
    decodeShareData,
    encodePcm,
    encodeShareData
} from '../../../src/lib/share-link/share-link-codec';

const nodeBrotli = {
    compress: (bytes, quality) => new Uint8Array(zlib.brotliCompressSync(bytes, {
        params: {[zlib.constants.BROTLI_PARAM_QUALITY]: quality}
    })),
    decompress: bytes => new Uint8Array(zlib.brotliDecompressSync(bytes))
};

const makeWav = ({channels, bytesPerSample, frames, formatTag = 1, extraTail = 0, signal}) => {
    const blockAlign = channels * bytesPerSample;
    const dataLength = frames * blockAlign;
    const fmtLength = formatTag === 0xFFFE ? 40 : 16;
    const bytes = new Uint8Array(12 + 8 + fmtLength + 8 + dataLength + extraTail);
    const view = new DataView(bytes.buffer);
    const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
    };
    ascii(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, fmtLength, true);
    view.setUint16(20, formatTag, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    if (formatTag === 0xFFFE) {
        view.setUint16(36, 22, true);
        view.setUint16(44, 1, true);
    }
    const dataHeader = 20 + fmtLength;
    ascii(dataHeader, 'data');
    view.setUint32(dataHeader + 4, dataLength, true);
    const modulus = 2 ** (8 * bytesPerSample);
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            let value = Math.round(signal(frame, channel, modulus));
            value = ((value % modulus) + modulus) % modulus;
            const offset = dataHeader + 8 + (((frame * channels) + channel) * bytesPerSample);
            for (let k = 0; k < bytesPerSample; k++) {
                bytes[offset + k] = value % 256;
                value = Math.floor(value / 256);
            }
        }
    }
    for (let i = 0; i < extraTail; i++) bytes[bytes.length - extraTail + i] = (i * 37) & 0xFF;
    return bytes;
};

const sine = (frame, channel, modulus) => (
    Math.sin((frame + (channel * 7)) / 9) * (modulus / 3)) + (Math.sin(frame * 1.7) * modulus / 200
);

const randomBytes = (length, seed) => {
    const bytes = new Uint8Array(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        bytes[i] = state >>> 24;
    }
    return bytes;
};

const text = value => new TextEncoder().encode(value);

describe('share link codec', () => {
    test('base64url round-trips every length without padding or unsafe characters', () => {
        for (let length = 0; length < 70; length++) {
            const bytes = randomBytes(length, length + 1);
            const encoded = bytesToBase64Url(bytes);
            expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
            expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
        }
    });

    test('base64url decoding tolerates whitespace and rejects foreign characters', () => {
        const bytes = randomBytes(100, 3);
        const encoded = bytesToBase64Url(bytes);
        const wrapped = `${encoded.slice(0, 40)}\n  ${encoded.slice(40)}`;
        expect(Array.from(base64UrlToBytes(wrapped))).toEqual(Array.from(bytes));
        expect(() => base64UrlToBytes(`${encoded}%`)).toThrow();
    });

    test('crc32 matches the standard check value', () => {
        expect(crc32(text('123456789'))).toBe(0xCBF43926);
    });

    test.each([
        ['8-bit mono', {channels: 1, bytesPerSample: 1}],
        ['16-bit stereo', {channels: 2, bytesPerSample: 2}],
        ['24-bit stereo', {channels: 2, bytesPerSample: 3}],
        ['32-bit mono', {channels: 1, bytesPerSample: 4}],
        ['16-bit extensible with trailing chunk', {channels: 2, bytesPerSample: 2, formatTag: 0xFFFE, extraTail: 13}]
    ])('PCM transform restores %s WAV byte for byte', (label, options) => {
        const wav = makeWav({frames: 3001, signal: sine, ...options});
        const encoded = encodePcm(wav);
        expect(encoded).not.toBeNull();
        expect(Array.from(decodePcm(encoded))).toEqual(Array.from(wav));
    });

    test('PCM transform survives full-scale noise that wraps the predictor', () => {
        const wav = makeWav({
            channels: 2,
            bytesPerSample: 2,
            frames: 2000,
            signal: (frame, channel, modulus) => ((frame * 7919) + (channel * 104729)) % modulus
        });
        expect(Array.from(decodePcm(encodePcm(wav)))).toEqual(Array.from(wav));
    });

    test('PCM transform makes WAV audio smaller than plain Brotli', () => {
        const wav = makeWav({channels: 2, bytesPerSample: 2, frames: 44100, signal: sine});
        const plain = nodeBrotli.compress(wav, 11).length;
        const transformed = nodeBrotli.compress(encodePcm(wav), 11).length;
        expect(transformed).toBeLessThan(plain);
    });

    test('non-PCM or malformed WAV data is left untouched', () => {
        expect(encodePcm(text('not a wav file at all, just some text padding padding'))).toBeNull();
        const float = makeWav({channels: 1, bytesPerSample: 4, frames: 100, formatTag: 3, signal: sine});
        expect(encodePcm(float)).toBeNull();
    });

    test('round-trips project.json and every asset type exactly', () => {
        const files = {
            'project.json': text(JSON.stringify({targets: [{name: 'Stage', blocks: {}}], meta: {semver: '3.0.0'}})),
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg': text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png': randomBytes(3000, 1),
            'cccccccccccccccccccccccccccccccc.wav': makeWav({channels: 1, bytesPerSample: 2, frames: 5000, signal: sine}),
            'dddddddddddddddddddddddddddddddd.mp3': randomBytes(2000, 2),
            'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.glb': randomBytes(1500, 3),
            'ffffffffffffffffffffffffffffffff.mp4': randomBytes(1200, 4),
            'gggggggggggggggggggggggggggggggg.ttf': randomBytes(800, 5),
            '11111111111111111111111111111111.jpg': new Uint8Array(0),
            '22222222222222222222222222222222.unknownext': randomBytes(10, 6)
        };
        const encoded = encodeShareData({files, title: 'ぼくの作品 🎬'}, nodeBrotli);
        const decoded = decodeShareData(encoded, nodeBrotli);
        expect(decoded.title).toBe('ぼくの作品 🎬');
        const map = Object.fromEntries(decoded.files.map(file => [file.name, Array.from(file.data)]));
        expect(Object.keys(map).sort()).toEqual(Object.keys(files).sort());
        for (const name of Object.keys(files)) expect(map[name]).toEqual(Array.from(files[name]));
        expect(decoded.files[0].name).toBe('project.json');
    });

    test('large already-compressed media is stored in its own segment and still round-trips', () => {
        const big = randomBytes((1024 * 1024) + 5, 9);
        const files = [
            {name: 'project.json', data: text('{"targets":[]}')},
            {name: 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh.mp4', data: big}
        ];
        const encoded = encodeShareData({files}, nodeBrotli);
        // Version byte, then the segment count.
        expect(encoded[1]).toBe(2);
        const decoded = decodeShareData(encoded, nodeBrotli);
        expect(decoded.title).toBe('');
        expect(Buffer.compare(Buffer.from(decoded.files[1].data), Buffer.from(big))).toBe(0);
    });

    test('compresses repetitive project JSON far below its original size', () => {
        const blocks = {};
        for (let i = 0; i < 400; i++) {
            blocks[`block${i}`] = {opcode: 'motion_movesteps', next: null, parent: null, inputs: {}, fields: {}};
        }
        const json = text(JSON.stringify({targets: [{blocks}]}));
        const encoded = encodeShareData({files: {'project.json': json}}, nodeBrotli);
        expect(encoded.length * 10).toBeLessThan(json.length);
    });

    test('reports progress up to the total size', () => {
        const events = [];
        encodeShareData({files: {'project.json': text('{}'), 'a.png': randomBytes(10, 1)}}, nodeBrotli,
            event => events.push(event));
        const last = events[events.length - 1];
        expect(last.done).toBe(last.total);
        expect(last.total).toBe(12);
    });

    test('rejects truncated, corrupted and foreign data', () => {
        const encoded = encodeShareData({files: {'project.json': text('{"targets":[]}'), 'x.svg': text('<svg/>')}},
            nodeBrotli);
        expect(() => decodeShareData(encoded.subarray(0, encoded.length - 3), nodeBrotli)).toThrow();
        const corrupted = encoded.slice();
        corrupted[corrupted.length - 2] ^= 0x55;
        expect(() => decodeShareData(corrupted, nodeBrotli)).toThrow();
        const future = encoded.slice();
        future[0] = 99;
        expect(() => decodeShareData(future, nodeBrotli)).toThrow(/newer version/);
    });

    test('requires project.json', () => {
        expect(() => encodeShareData({files: {'a.svg': text('<svg/>')}}, nodeBrotli)).toThrow();
    });

    test('is compatible with the brotli-wasm build used in the browser', () => {
        const brotliWasm = require('brotli-wasm');
        const wasmBrotli = {
            compress: (bytes, quality) => brotliWasm.compress(bytes, {quality}),
            decompress: bytes => brotliWasm.decompress(bytes)
        };
        const files = {
            'project.json': text(JSON.stringify({targets: [{name: 'Stage'}]})),
            'cccccccccccccccccccccccccccccccc.wav': makeWav({channels: 2, bytesPerSample: 2, frames: 800, signal: sine})
        };
        const fromWasm = encodeShareData({files, title: 't'}, wasmBrotli);
        const decoded = decodeShareData(fromWasm, nodeBrotli);
        expect(Array.from(decoded.files[1].data)).toEqual(Array.from(files['cccccccccccccccccccccccccccccccc.wav']));
        const fromNode = encodeShareData({files, title: 't'}, nodeBrotli);
        expect(decodeShareData(fromNode, wasmBrotli).title).toBe('t');
    });
});
