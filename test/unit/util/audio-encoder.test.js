const mockEncodeBuffer = jest.fn(() => new Uint8Array([1, 2]));

jest.mock('@breezystack/lamejs', () => ({
    Mp3Encoder: class MockMp3Encoder {
        constructor (channels) {
            this.channels = channels;
            MockMp3Encoder.instance = this;
        }
        encodeBuffer (left, right) {
            return mockEncodeBuffer(left, right);
        }
        flush () {
            return new Uint8Array([3]);
        }
    }
}));

import {encodeAudio, floatToInt16} from '../../../src/lib/audio/audio-encoder';

describe('audio encoder', () => {
    test('converts normalized floating point samples to signed 16-bit PCM', () => {
        expect(floatToInt16(new Float32Array([-2, -1, 0, 1, 2])))
            .toEqual(new Int16Array([-32768, -32768, 0, 32767, 32767]));
    });

    test('encodes MP3 using both stereo channels', async () => {
        const encoded = await encodeAudio([
            new Float32Array([0, 0.5]),
            new Float32Array([0, -0.5])
        ], 44100, 'mp3');

        expect(encoded).toEqual(new Uint8Array([1, 2, 3]));
        expect(mockEncodeBuffer.mock.calls[0][0]).toEqual(new Int16Array([0, 16383]));
        expect(mockEncodeBuffer.mock.calls[0][1]).toEqual(new Int16Array([0, -16384]));
    });

    test('writes both stereo channels to a WAV file', async () => {
        const encoded = await encodeAudio([
            new Float32Array([0, 0.5]),
            new Float32Array([0, -0.5])
        ], 44100, 'wav');
        const header = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

        expect(header.getUint16(22, true)).toEqual(2);
    });
});
