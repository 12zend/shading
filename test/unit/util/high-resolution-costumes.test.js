/**
 * @jest-environment jsdom
 */
import {importBitmapCostume} from '../../../src/lib/file-uploader';
import {getArtBoardScale, scaleSvg} from '../../../src/lib/paint-editor-resolution';
const {loadCostumeFromAsset} = require('scratch-vm/src/import/load-costume');

const withImageSize = (width, height, callback) => {
    const OriginalImage = global.Image;
    global.Image = class {
        set src (value) {
            this.width = width;
            this.height = height;
            setTimeout(() => this.onload());
        }
    };
    return Promise.resolve()
        .then(callback)
        .finally(() => {
            global.Image = OriginalImage;
        });
};

const makeAdapter = () => ({
    convertBinaryToDataURI: jest.fn(() => 'data:image/png;base64,'),
    convertDataURIToBinary: jest.fn(() => new Uint8Array([9])),
    importBitmap: jest.fn(() => Promise.resolve(new Uint8Array([2])))
});

describe('high-resolution bitmap costumes', () => {
    test('keeps the pixels of an image larger than twice the stage and fits it with its resolution', () =>
        withImageSize(1920, 1080, async () => {
            const adapter = makeAdapter();
            const data = new Uint8Array([1, 2, 3]).buffer;
            const result = await importBitmapCostume(adapter, data, 'image/png', 640, 360);

            expect(adapter.importBitmap).not.toHaveBeenCalled();
            expect(Array.from(result.data)).toEqual([1, 2, 3]);
            expect(result.bitmapResolution).toBe(3);
            expect(result.isPNG).toBe(true);
        }));

    test('keeps a large JPEG as it was uploaded', () =>
        withImageSize(2560, 1440, async () => {
            const result = await importBitmapCostume(makeAdapter(), new ArrayBuffer(4), 'image/jpeg', 640, 360);

            expect(result.bitmapResolution).toBe(4);
            expect(result.isPNG).toBe(false);
        }));

    test('imports images up to twice the stage as standard resolution 2 bitmaps', () =>
        withImageSize(1280, 720, async () => {
            const adapter = makeAdapter();
            const data = new ArrayBuffer(4);
            const result = await importBitmapCostume(adapter, data, 'image/png', 640, 360);

            expect(adapter.importBitmap).toHaveBeenCalledWith(data, 'image/png');
            expect(result).toEqual({data: new Uint8Array([2]), bitmapResolution: 2, isPNG: true});
        }));

    test('scales very large images down smoothly to the maximum edge', () =>
        withImageSize(8192, 4608, async () => {
            const context = {drawImage: jest.fn()};
            const canvas = {getContext: () => context, toDataURL: () => 'data:image/png;base64,'};
            const createElement = jest.spyOn(document, 'createElement').mockReturnValue(canvas);
            try {
                const result = await importBitmapCostume(makeAdapter(), new ArrayBuffer(4), 'image/jpeg', 640, 360);

                expect([canvas.width, canvas.height]).toEqual([4096, 2304]);
                expect(context.imageSmoothingQuality).toBe('high');
                expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4096, 2304);
                expect(result.bitmapResolution).toBeCloseTo(6.4);
                expect(result.isPNG).toBe(true);
            } finally {
                createElement.mockRestore();
            }
        }));

    test('loads a bitmap costume with its high resolution instead of forcing resolution 2', async () => {
        const originalCreateImageBitmap = global.createImageBitmap;
        global.createImageBitmap = jest.fn(() => Promise.resolve({width: 1920, height: 1080}));
        const renderer = {
            createBitmapSkin: jest.fn(() => 5),
            getSkinSize: jest.fn(() => [640, 360]),
            getSkinRotationCenter: jest.fn(() => [320, 180])
        };
        const runtime = {
            renderer,
            storage: {AssetType: {ImageVector: {runtimeFormat: 'svg'}}},
            v2BitmapAdapter: {}
        };
        const costume = {
            asset: {assetId: 'a', assetType: {runtimeFormat: 'png', contentType: 'image/png'}, data: new Uint8Array()},
            bitmapResolution: 3
        };
        try {
            await loadCostumeFromAsset(costume, runtime);
        } finally {
            global.createImageBitmap = originalCreateImageBitmap;
        }

        expect(renderer.createBitmapSkin).toHaveBeenCalledWith(expect.anything(), 3, undefined);
        expect(costume.bitmapResolution).toBe(3);
        expect(costume.size).toEqual([1920, 1080]);
        expect([costume.rotationCenterX, costume.rotationCenterY]).toEqual([960, 540]);
    });

    test('enlarges the paint editor art board only for high-resolution bitmaps', () => {
        expect(getArtBoardScale('png', 2)).toBe(1);
        expect(getArtBoardScale('png', 6)).toBe(3);
        expect(getArtBoardScale('jpg', 3)).toBe(1.5);
        expect(getArtBoardScale('svg', 6)).toBe(1);
        expect(getArtBoardScale('png', undefined)).toBe(1);
    });

    test('scales a vector exported from an enlarged art board back to stage units', () => {
        const scaled = scaleSvg(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0,0,300,150">' +
            '<rect width="300" height="150"/></svg>',
            1 / 3
        );
        const svg = new DOMParser().parseFromString(scaled, 'image/svg+xml').documentElement;

        expect(svg.getAttribute('width')).toBe('100');
        expect(svg.getAttribute('height')).toBe('50');
        expect(svg.getAttribute('viewBox')).toBe('0 0 100 50');
        expect(svg.children).toHaveLength(1);
        expect(svg.children[0].getAttribute('transform')).toBe(`scale(${1 / 3})`);
        expect(svg.children[0].children[0].tagName).toBe('rect');
    });
});
