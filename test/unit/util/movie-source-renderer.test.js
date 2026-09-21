import MovieSourceRenderer from 'scratch-render/src/MovieSourceRenderer';
import RenderWebGL from 'scratch-render/src/RenderWebGL';

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
});
