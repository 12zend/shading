import {
    base64ToUint8Array,
    createProjectBundle,
    decodeProjectJSON,
    encodeProjectJSON,
    uint8ArrayToBase64
} from '../../../src/lib/collaboration-project';

describe('collaboration project files', () => {
    test('round trips binary assets without a zip or Worker-side conversion', () => {
        const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
        expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes);
    });

    test('omits content-addressed assets already stored by the room', async () => {
        const bundle = await createProjectBundle({
            'already.png': new Uint8Array([1]),
            'new.wav': new Uint8Array([2]),
            'project.json': new TextEncoder().encode('{"projectVersion":3}')
        }, ['already.png']);

        expect(bundle.assetNames).toEqual(['already.png', 'new.wav']);
        expect(bundle.assets).toEqual({'new.wav': 'Ag=='});
        expect(await decodeProjectJSON(bundle.project)).toBe('{"projectVersion":3}');
    });

    test('falls back to plain project.json when native gzip is unavailable', async () => {
        const original = global.CompressionStream;
        global.CompressionStream = undefined;
        const payload = await encodeProjectJSON('{"projectVersion":3}');
        global.CompressionStream = original;

        expect(payload).toEqual({data: '{"projectVersion":3}', encoding: 'plain'});
    });
});
