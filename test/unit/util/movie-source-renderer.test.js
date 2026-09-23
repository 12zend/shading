import MovieSourceRenderer from 'scratch-render/src/MovieSourceRenderer';
import RenderWebGL from 'scratch-render/src/RenderWebGL';
import MovieTextSource from 'scratch-render/src/MovieTextSource';

const makeRenderer = () => {
    let nextId = 0;
    return {
        _allDrawables: [],
        createBitmapSkin: jest.fn(() => ++nextId),
        updateBitmapSkin: jest.fn(),
        updateDrawableSkinId: jest.fn(),
        destroySkin: jest.fn(),
        penStamp: jest.fn(),
        renderMovieSource: RenderWebGL.prototype.renderMovieSource
    };
};

describe('renderer-owned Movie sources', () => {
    test('text generation, upload, binding and stamp execute synchronously through one submission', () => {
        const renderer = makeRenderer();
        const source = MovieSourceRenderer.forRenderer(renderer);
        const bitmap = {width: 16, height: 12, movieBitmapResolution: 4};
        const order = [];
        source.text.createTextCanvas = jest.fn(() => { order.push('rasterize'); return bitmap; });
        renderer.createBitmapSkin.mockImplementation(() => { order.push('upload'); return 7; });
        renderer.updateDrawableSkinId.mockImplementation(() => order.push('bind'));
        renderer.penStamp.mockImplementation(() => order.push('stamp'));
        const request = {kind: 'text', font: {name: 'sans', family: 'sans-serif'}, text: 'hello',
            drawableId: 3, penSkinId: 4};
        const entry = renderer.renderMovieSource(request);
        expect(entry.skinId).toBe(7);
        expect(entry.then).toBeUndefined();
        expect(order).toEqual(['rasterize', 'upload', 'bind']);
        renderer.renderMovieSource(request);
        expect(source.text.createTextCanvas).toHaveBeenCalledTimes(1);
        expect(renderer.createBitmapSkin).toHaveBeenCalledTimes(1);
        expect(renderer.penStamp).not.toHaveBeenCalled();
    });

    test('video submissions reuse a mutable texture and preserve block order', () => {
        const renderer = makeRenderer();
        const first = {width: 40, height: 30};
        const second = {width: 40, height: 30};
        const entry = renderer.renderMovieSource({kind: 'video', bitmap: first, resolution: 1});
        renderer.renderMovieSource({kind: 'video', bitmap: second, skinId: entry.skinId,
            resolution: 1, drawableId: 2, penSkinId: 3});
        expect(renderer.createBitmapSkin).toHaveBeenCalledTimes(1);
        expect(renderer.updateBitmapSkin).toHaveBeenCalledWith(entry.skinId, second, 1);
        expect(renderer.updateBitmapSkin.mock.invocationCallOrder[0]).toBeLessThan(
            renderer.updateDrawableSkinId.mock.invocationCallOrder[0]);
    });

    test('a model submission renders and uploads exactly once', () => {
        const renderer = makeRenderer();
        const source = MovieSourceRenderer.forRenderer(renderer);
        const bitmap = {width: 40, height: 30};
        source.model = {renderWorldScene: jest.fn(() => bitmap)};
        const args = [[], {focalLength: 480}, [480, 360], 2];
        const entry = renderer.renderMovieSource({kind: 'model', arguments: args});
        expect(source.model.renderWorldScene).toHaveBeenCalledWith(...args);
        expect(renderer.createBitmapSkin).toHaveBeenCalledTimes(1);
        expect(renderer.updateBitmapSkin).not.toHaveBeenCalled();
        expect(entry.bitmap).toBe(bitmap);
    });

    test('cache eviction retains bound skins while releasing inactive GPU resources', () => {
        const renderer = makeRenderer();
        const source = MovieSourceRenderer.forRenderer(renderer);
        const cache = new Map([
            ['bound', {skinId: 1, pixels: 32}],
            ['old', {skinId: 2, pixels: 32}],
            ['new', {skinId: 3, pixels: 32}]
        ]);
        source.trimCache(cache, new Set([1]), 2, 64);
        expect([...cache.keys()]).toEqual(['bound', 'new']);
        expect(renderer.destroySkin).toHaveBeenCalledWith(2);
        expect(MovieSourceRenderer.forRenderer(renderer)).toBe(source);
        expect(MovieSourceRenderer.forRenderer(makeRenderer())).not.toBe(source);
    });

    test('italic text shears each pixel by italic times its height above the text bottom', () => {
        const originalDocument = global.document;
        const contexts = [];
        global.document = {createElement: () => {
            const context = {
                fillText: jest.fn(),
                measureText: () => ({width: 100}),
                setTransform: jest.fn()
            };
            contexts.push(context);
            return {getContext: () => context, width: 0, height: 0};
        }};
        try {
            const font = {name: 'sans', family: 'sans-serif'};
            const textSource = new MovieTextSource();
            const upright = textSource.createTextCanvas(font, 'Hi');
            const italic = textSource.createTextCanvas(font, 'Hi', null, 0.25);
            const reverse = textSource.createTextCanvas(font, 'Hi', null, -0.25);

            expect(contexts[0].setTransform).not.toHaveBeenCalled();
            // Line height is 96 * 1.2 at a 2x render scale, so the slant adds 0.25 * 230 pixels.
            expect(italic.width - upright.width).toBe(58);
            expect(reverse.width).toBe(italic.width);
            const padding = 32;
            const textBottom = padding + 230;
            expect(contexts[1].setTransform).toHaveBeenCalledWith(1, 0, -0.25, 1, 0.25 * textBottom, 0);
            expect(contexts[2].setTransform).toHaveBeenCalledWith(1, 0, 0.25, 1, 57.5 - (0.25 * textBottom), 0);
            expect(textSource.createTextCanvas(font, 'Hi', null, 0.25)).toBe(italic);
            expect(MovieTextSource.getTextCacheKey(font, 'Hi')).toBe('sans\0sans-serif\0Hi');
            expect(MovieTextSource.getTextCacheKey(font, 'Hi', 0.25)).not.toBe(MovieTextSource.getTextCacheKey(font, 'Hi'));
            expect(MovieTextSource.normalizeTextItalic('abc')).toBe(0);
            expect(MovieTextSource.normalizeTextItalic(100)).toBe(4);
        } finally {
            global.document = originalDocument;
        }
    });
});
