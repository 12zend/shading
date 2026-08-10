import {exrPixelsToRgba} from '../../../src/lib/exr-converter';
import {COSTUME_FILE_ACCEPT, getFileType} from '../../../src/lib/costume-upload-formats';

describe('EXR costume upload', () => {
    test('offers EXR files and detects their type from a case-insensitive extension', () => {
        expect(COSTUME_FILE_ACCEPT).toContain('.exr');
        expect(getFileType({name: 'height.EXR', type: ''})).toBe('image/x-exr');
        expect(getFileType({name: 'costume.png', type: 'image/png'})).toBe('image/png');
    });

    test('converts float RGBA pixels to PNG-compatible bytes without changing map values', () => {
        expect(Array.from(exrPixelsToRgba({
            data: new Float32Array([0, 0.5, 1, 1, -1, 2, Number.NaN, 0.25]),
            width: 2,
            height: 1
        }))).toEqual([
            0, 128, 255, 255,
            0, 255, 0, 64
        ]);
    });

    test('expands single-channel EXR pixels into opaque grayscale pixels', () => {
        expect(Array.from(exrPixelsToRgba({
            data: new Float32Array([0.25, 0.75]),
            width: 2,
            height: 1
        }))).toEqual([
            64, 64, 64, 255,
            191, 191, 191, 255
        ]);
    });
});
