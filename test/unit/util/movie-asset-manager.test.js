import {MovieAssetManager} from '../../../src/lib/movie-asset-manager';

const makeManager = () => {
    const manager = Object.create(MovieAssetManager.prototype);
    manager.runtime = {
        _primitives: {},
        fontManager: {
            getFonts: () => []
        },
        renderer: {
            createBitmapSkin: jest.fn(() => 1),
            updateBitmapSkin: jest.fn(),
            updateDrawableDirectionScale: jest.fn(),
            updateDrawablePosition: jest.fn(),
            updateDrawableSkinId: jest.fn(),
            updateDrawableVisible: jest.fn()
        },
        requestRedraw: jest.fn(),
        requestTargetsUpdate: jest.fn()
    };
    manager.targetStates = new Map();
    manager.videos = new Map();
    manager.fontFaces = new Map();
    return manager;
};

const makeTarget = () => ({
    direction: 90,
    drawableID: 1,
    emitVisualChange: jest.fn(),
    id: 'target',
    isOriginal: true,
    size: 100,
    visible: false
});

const deferred = () => {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
};

describe('MovieAssetManager rendering performance', () => {
    test('keeps a world-rendered model fixed to the stage instead of projecting a flat sprite', () => {
        const manager = makeManager();
        const target = makeTarget();
        target.visible = true;
        const state = manager.getTargetState(target);
        state.mode = 'model';

        manager.applyProjection(target);

        expect(manager.runtime.renderer.updateDrawablePosition).toHaveBeenCalledWith(1, [0, 0]);
        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenCalledWith(1, 90, [100, 100]);
        expect(manager.runtime.renderer.updateDrawableVisible).toHaveBeenCalledWith(1, true);
    });

    test('uses the sprite drawable for a model skin and obeys sprite visibility', () => {
        const manager = makeManager();
        const target = makeTarget();
        const bitmap = {};

        manager.applyBitmap(target, bitmap, 'model');

        expect(manager.runtime.renderer.createBitmapSkin).toHaveBeenCalledWith(bitmap, 2);
        expect(manager.runtime.renderer.updateDrawableSkinId).toHaveBeenCalledWith(target.drawableID, 1);
        expect(manager.runtime.renderer.updateDrawableVisible).toHaveBeenCalledWith(target.drawableID, false);
        expect(manager.getTargetState(target).mode).toBe('model');
    });

    test('waits for the model skin before the next block can stamp the sprite', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const modelRender = deferred();
        manager.switchModel = jest.fn(() => modelRender.promise);
        manager.installPrimitives();

        const blockResult = manager.runtime._primitives.looks_switchmodelto({MODEL: 'Cube'}, {target});

        expect(blockResult).toBe(modelRender.promise);
        expect(manager.switchModel).toHaveBeenCalledWith(target, 'Cube');

        modelRender.resolve();
        await blockResult;
    });

    test('rerenders model geometry when its world z position changes', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.rerenderTargetModel = jest.fn();

        manager.setTargetPosition(target, 12, -8, 240);

        expect(manager.getTargetState(target)).toMatchObject({worldX: 12, worldY: -8, worldZ: 240});
        expect(manager.rerenderTargetModel).toHaveBeenCalledWith(target);
    });

    test('set FOV automatically assigns focal length for a 480 by 360 stage', () => {
        const manager = makeManager();
        manager.camera = {};
        manager.cameraChanged = jest.fn();

        manager.setFOV(60);

        expect(manager.camera.fov).toBe(60);
        expect(manager.camera.focalLength).toBeCloseTo(240 / Math.tan(Math.PI / 6));
        expect(manager.cameraChanged).toHaveBeenCalledTimes(1);
    });

    test('registers 3D motion primitives with every coordinate argument', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setCameraPosition = jest.fn();
        manager.setFOV = jest.fn();
        manager.installPrimitives();

        manager.runtime._primitives.motion_gotoxyz({X: 12, Y: -8, Z: 720}, {target});
        manager.runtime._primitives.motion_setrotation({X: 10, Y: 20, Z: 30}, {target});
        manager.runtime._primitives.motion_setcamerato({X: 1, Y: 2, Z: 3});
        manager.runtime._primitives.motion_setfov({FOV: 60});

        expect(manager.setTargetPosition).toHaveBeenCalledWith(target, 12, -8, 720);
        expect(manager.setTargetRotation).toHaveBeenCalledWith(target, 10, 20, 30);
        expect(manager.setCameraPosition).toHaveBeenCalledWith(1, 2, 3);
        expect(manager.setFOV).toHaveBeenCalledWith(60);
    });

    test('media primitives never put the VM into promise-wait mode', () => {
        const manager = makeManager();
        const pending = new Promise(() => {});
        manager.switchVideo = jest.fn(() => pending);
        manager.setVideoFrame = jest.fn(() => pending);
        manager.changeVideoFrame = jest.fn(() => pending);
        manager.setText = jest.fn(() => pending);
        manager.installPrimitives();
        const util = {target: makeTarget()};

        expect(manager.runtime._primitives.looks_switchvideoto({VIDEO: 'clip'}, util)).toBeUndefined();
        expect(manager.runtime._primitives.looks_setvideoframeto({FRAME: 2}, util)).toBeUndefined();
        expect(manager.runtime._primitives.looks_changevideoframeby({FRAME: 1}, util)).toBeUndefined();
        expect(manager.runtime._primitives.looks_settextfont({FONT: 'sans-serif', TEXT: 'hello'}, util))
            .toBeUndefined();
    });

    test('collapses queued video seeks to the latest requested frame', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const video = {
            assetId: 'video',
            duration: 10,
            frameRate: 30
        };
        const firstDecode = deferred();
        const firstElement = {name: 'frame 1'};
        const latestElement = {name: 'frame 3'};
        manager.decodeVideoFrame = jest.fn()
            .mockImplementationOnce(() => firstDecode.promise)
            .mockResolvedValueOnce(latestElement);

        const renderPromise = manager.queueVideoFrame(target, video, 1);
        await Promise.resolve();
        expect(manager.decodeVideoFrame).toHaveBeenCalledWith(expect.any(Object), video, 1);

        expect(manager.queueVideoFrame(target, video, 2)).toBe(renderPromise);
        expect(manager.queueVideoFrame(target, video, 3)).toBe(renderPromise);
        firstDecode.resolve(firstElement);
        await renderPromise;

        expect(manager.decodeVideoFrame.mock.calls.map(call => call[2])).toEqual([1, 3]);
        expect(manager.runtime.renderer.createBitmapSkin).toHaveBeenCalledTimes(1);
        expect(manager.runtime.renderer.createBitmapSkin).toHaveBeenCalledWith(latestElement, 2);
        expect(manager.getTargetState(target)).toMatchObject({
            currentFrame: 3,
            displayedFrame: 3,
            displayedVideoAssetId: 'video'
        });
    });

    test('renders every loaded-font text request synchronously and in order', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.ensureFontLoaded = jest.fn(() => null);
        manager.renderText = jest.fn();

        expect(manager.setText(target, 'sans-serif', 'first')).toBeUndefined();
        expect(manager.setText(target, 'sans-serif', 'latest')).toBeUndefined();

        expect(manager.renderText.mock.calls.map(call => call[2])).toEqual(['first', 'latest']);
        expect(manager.getTargetState(target).textRenderPromise).toBeNull();
    });

    test('does not discard text requests while a font is loading', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const fontLoad = deferred();
        manager.ensureFontLoaded = jest.fn(() => fontLoad.promise);
        manager.renderText = jest.fn();

        manager.setText(target, 'custom', 'first');
        manager.setText(target, 'custom', 'latest');
        const renderPromise = manager.getTargetState(target).textRenderPromise;
        fontLoad.resolve();
        await renderPromise;

        expect(manager.renderText.mock.calls.map(call => call[2])).toEqual(['first', 'latest']);
    });
});
