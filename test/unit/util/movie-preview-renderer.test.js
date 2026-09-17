import installMoviePreviewRenderer from '../../../scratch-vm/src/lib/movie-preview-renderer';
import methods from '../../../src/lib/movie-asset-manager-timeline';

const setup = (pixelRatio = 1) => {
    const skin = {setRenderQuality: jest.fn()};
    const drawable = {setHighQuality: jest.fn()};
    const renderer = {
        canvas: {width: 960, height: 540, style: {width: '480px', height: '270px'}},
        _allSkins: [skin], _penSkinId: 0, _allDrawables: [drawable],
        getNativeSize: () => [480, 270],
        useHighQualityRender: false,
        _updateRenderQuality: jest.fn()
    };
    renderer.resize = jest.fn((width, height) => {
        renderer.canvas.width = Math.round(width * pixelRatio);
        renderer.canvas.height = Math.round(height * pixelRatio);
        renderer._updateRenderQuality();
    });
    const resize = renderer.resize;
    const manager = Object.assign({}, methods, {
        runtime: {renderer},
        timeline: {previewScale: 1, width: 1920, height: 1080},
        getStageSize: renderer.getNativeSize,
        getRendererPixelRatio: () => pixelRatio
    });
    installMoviePreviewRenderer(renderer, manager);
    return {manager, renderer, skin, drawable, resize};
};

describe('Movie preview rendering buffer', () => {
    test.each([1, 2])('keeps CSS and logical size fixed at pixel ratio %s', pixelRatio => {
        const {manager, renderer, skin, drawable} = setup(pixelRatio);
        expect([renderer.canvas.width, renderer.canvas.height]).toEqual([480, 270]);
        manager.timeline.previewScale = 0.5;
        expect(manager.refreshPreviewResolution()).toBeUndefined();
        expect([renderer.canvas.width, renderer.canvas.height]).toEqual([240, 135]);
        expect(renderer.canvas.style).toEqual({width: '480px', height: '270px'});
        expect(skin.setRenderQuality).toHaveBeenLastCalledWith(0.5);
        expect(drawable.setHighQuality).toHaveBeenLastCalledWith(false);
        // Fullscreen and editor layout changes must not silently change preview detail.
        renderer.resize(1600, 900);
        expect([renderer.canvas.width, renderer.canvas.height]).toEqual([240, 135]);
    });

    test('exports at output resolution and restores the selected preview', () => {
        const {manager, renderer, skin} = setup(2);
        manager.timeline.previewScale = 0.5;
        manager.refreshPreviewResolution();
        manager.resizeRendererForTimeline();
        expect([renderer.canvas.width, renderer.canvas.height]).toEqual([1920, 1080]);
        expect(skin.setRenderQuality).toHaveBeenLastCalledWith(4);
        renderer.resize(300, 200);
        expect(renderer.canvas.width).toBe(1920);
        manager.restorePreviewRendererSize();
        expect([renderer.canvas.width, renderer.canvas.height]).toEqual([240, 135]);
        expect(skin.setRenderQuality).toHaveBeenLastCalledWith(0.5);
    });

    test.each([undefined, NaN, Infinity, 0, -1])('defaults invalid preview scale %s to project resolution', value => {
        expect(methods.normalizePreviewScale(value)).toBe(1);
    });
});
