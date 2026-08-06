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
    manager.models = new Map();
    manager.modelObjects = new Map();
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

    test('waits for a model scene before following blocks run', () => {
        const manager = makeManager();
        const target = makeTarget();
        const modelRender = deferred();
        manager.renderModelToScene = jest.fn(() => modelRender.promise);
        manager.installPrimitives();

        const renderResult = manager.runtime._primitives.looks_rendermodel({MODEL: 'Cube'}, {target});

        expect(renderResult).toBe(modelRender.promise);
        expect(manager.renderModelToScene).toHaveBeenCalledWith(target, 'Cube');
    });

    test('registers rendering frame primitives and clears the accumulated frames', () => {
        const manager = makeManager();
        manager.renderingFrames = [{}];
        manager.emit = jest.fn();
        manager.installPrimitives();

        expect(typeof manager.runtime._primitives.looks_addrenderingframe).toBe('function');
        expect(typeof manager.runtime._primitives.looks_exportrenderingmp4).toBe('function');
        manager.runtime._primitives.looks_clearrenderingframe();

        expect(manager.renderingFrames).toEqual([]);
        expect(manager.emit).toHaveBeenCalledWith('renderingFramesChanged', 0);
    });

    test('does not display an empty scene before a following model render', () => {
        const manager = makeManager();
        const target = makeTarget();
        const clearRender = deferred();
        manager.clearModelScene = jest.fn(() => clearRender.promise);
        manager.installPrimitives();

        const clearResult = manager.runtime._primitives.looks_clearscene({}, {target});

        expect(clearResult).toBeUndefined();
        expect(manager.clearModelScene).toHaveBeenCalledWith(target);
    });

    test('accumulates model snapshots in one sprite scene until clear scene', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.models.set(target.id, [
            {assetId: 'cube', name: 'Cube'},
            {assetId: 'sphere', name: 'Sphere'}
        ]);
        manager.queueModelSceneRender = jest.fn(() => Promise.resolve());

        manager.setTargetPosition(target, -60, 0, 480);
        manager.renderModelToScene(target, 'Cube');
        manager.setTargetPosition(target, 80, 20, 600);
        manager.renderModelToScene(target, 'Sphere');

        expect(manager.getTargetState(target).modelScene).toEqual([
            expect.objectContaining({
                assetId: 'cube',
                transform: expect.objectContaining({worldX: -60, worldY: 0, worldZ: 480})
            }),
            expect.objectContaining({
                assetId: 'sphere',
                transform: expect.objectContaining({worldX: 80, worldY: 20, worldZ: 600})
            })
        ]);

        manager.clearModelScene(target);

        expect(manager.getTargetState(target).modelScene).toEqual([]);
        expect(manager.getTargetState(target).modelAssetId).toBeNull();
    });

    test('renders every accumulated model through one shared 3D scene', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const cubeObject = {name: 'cube object'};
        const sphereObject = {name: 'sphere object'};
        const canvas = {name: 'scene canvas'};
        manager.camera = {name: 'camera'};
        manager.models.set(target.id, [
            {assetId: 'cube', name: 'Cube'},
            {assetId: 'sphere', name: 'Sphere'}
        ]);
        manager.getModelObject = jest.fn(model => Promise.resolve(
            model.assetId === 'cube' ? cubeObject : sphereObject
        ));
        manager.getStageSize = jest.fn(() => [480, 360]);
        manager.modelRenderer = {
            renderWorldScene: jest.fn(() => canvas)
        };
        manager.applyBitmap = jest.fn();
        manager.applyProjection = jest.fn();

        manager.renderModelToScene(target, 'Cube');
        const completedScene = manager.renderModelToScene(target, 'Sphere');
        await completedScene;

        expect(manager.modelRenderer.renderWorldScene).toHaveBeenCalledWith([
            expect.objectContaining({sourceObject: cubeObject}),
            expect.objectContaining({sourceObject: sphereObject})
        ], manager.camera, [480, 360], 2);
        expect(manager.applyBitmap).toHaveBeenCalledWith(target, canvas, 'model');

        await manager.clearModelScene(target);

        expect(manager.modelRenderer.renderWorldScene).toHaveBeenLastCalledWith([], manager.camera, [480, 360], 2);
    });

    test('renders cached models synchronously after project loading', () => {
        const manager = makeManager();
        const target = makeTarget();
        const canvas = {name: 'scene canvas'};
        const modelObject = {name: 'cube object'};
        manager.camera = {name: 'camera'};
        manager.models.set(target.id, [{assetId: 'cube', name: 'Cube'}]);
        manager.modelObjects.set('cube', {object: modelObject});
        manager.getStageSize = jest.fn(() => [480, 360]);
        manager.modelRenderer = {
            renderWorldScene: jest.fn(() => canvas)
        };
        manager.applyBitmap = jest.fn();
        manager.applyProjection = jest.fn();

        const renderPromise = manager.renderModelToScene(target, 'Cube');

        expect(manager.modelRenderer.renderWorldScene).toHaveBeenCalledWith([
            expect.objectContaining({sourceObject: modelObject})
        ], manager.camera, [480, 360], 2);
        expect(manager.applyBitmap).toHaveBeenCalledWith(target, canvas, 'model');
        return renderPromise;
    });

    test('coalesces scene renders while a model is loading', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const modelObject = {name: 'cube object'};
        const modelLoad = deferred();
        const canvas = {name: 'scene canvas'};
        manager.camera = {name: 'camera'};
        manager.models.set(target.id, [{assetId: 'cube', name: 'Cube'}]);
        manager.getModelObject = jest.fn(() => modelLoad.promise);
        manager.getStageSize = jest.fn(() => [480, 360]);
        manager.modelRenderer = {
            renderWorldScene: jest.fn(() => canvas)
        };
        manager.applyBitmap = jest.fn();
        manager.applyProjection = jest.fn();

        const firstRender = manager.renderModelToScene(target, 'Cube');
        await Promise.resolve();
        const secondRender = manager.renderModelToScene(target, 'Cube');

        expect(secondRender).toBe(firstRender);
        modelLoad.resolve(modelObject);
        await firstRender;

        expect(manager.modelRenderer.renderWorldScene).toHaveBeenCalledWith([
            expect.objectContaining({sourceObject: modelObject}),
            expect.objectContaining({sourceObject: modelObject})
        ], manager.camera, [480, 360], 2);
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
        manager.setTargetPositionWithoutCamera = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.setCameraPosition = jest.fn();
        manager.setFOV = jest.fn();
        manager.installPrimitives();

        manager.runtime._primitives.motion_gotoxyz({X: 12, Y: -8, Z: 720}, {target});
        manager.runtime._primitives.motion_gotoxyz_nocamera({X: 20, Y: -10, Z: 300}, {target});
        manager.runtime._primitives.motion_setrotation({X: 10, Y: 20, Z: 30}, {target});
        manager.runtime._primitives.motion_setscale({X: 2, Y: 0.5, Z: 3}, {target});
        manager.runtime._primitives.motion_setcamerato({X: 1, Y: 2, Z: 3});
        manager.runtime._primitives.motion_setfov({FOV: 60});

        expect(manager.setTargetPosition).toHaveBeenCalledWith(target, 12, -8, 720);
        expect(manager.setTargetPositionWithoutCamera).toHaveBeenCalledWith(target, 20, -10, 300);
        expect(manager.setTargetRotation).toHaveBeenCalledWith(target, 10, 20, 30);
        expect(manager.setTargetScale).toHaveBeenCalledWith(target, 2, 0.5, 3);
        expect(manager.setCameraPosition).toHaveBeenCalledWith(1, 2, 3);
        expect(manager.setFOV).toHaveBeenCalledWith(60);
    });

    test('captures per-axis scale in a model scene snapshot', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.models.set(target.id, [{assetId: 'cube', name: 'Cube'}]);
        manager.queueModelSceneRender = jest.fn(() => Promise.resolve());

        manager.setTargetScale(target, 2, 0.5, 3);
        manager.renderModelToScene(target, 'Cube');

        expect(manager.getTargetState(target)).toMatchObject({
            scale: {x: 2, y: 0.5, z: 3}
        });
        expect(manager.getTargetState(target).modelScene[0].transform.scale).toEqual({
            x: 2,
            y: 0.5,
            z: 3
        });
    });

    test('serializes and restores the current per-axis scale', () => {
        const manager = makeManager();
        const target = {
            ...makeTarget(),
            getName: () => 'Sprite',
            isStage: false,
            x: 0,
            y: 0
        };
        manager.runtime.targets = [target];
        manager.setTargetScale(target, 2, 0.5, 3);

        const json = {targets: [{}]};
        manager.serializeTransforms(json);
        expect(json.targets[0].movie3D.scale).toEqual({x: 2, y: 0.5, z: 3});

        const restoredManager = makeManager();
        const restoredTarget = {
            ...target,
            emitVisualChange: jest.fn()
        };
        restoredManager.runtime.targets = [restoredTarget];
        restoredManager.restoreTransforms([{
            isStage: false,
            targetIndex: 0,
            targetName: 'Sprite',
            transform: json.targets[0].movie3D
        }]);

        expect(restoredManager.getTargetState(restoredTarget).scale).toEqual({
            x: 2,
            y: 0.5,
            z: 3
        });
    });

    test('keeps a no-camera position independent from camera projection', () => {
        const manager = makeManager();
        const target = makeTarget();
        target.visible = true;
        manager.camera = {
            focalLength: 480,
            position: {x: 100, y: 50, z: 100},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };

        manager.setTargetPositionWithoutCamera(target, 120, -60, 240);

        expect(manager.getTargetState(target)).toMatchObject({
            ignoreCamera: true,
            worldX: 120,
            worldY: -60,
            worldZ: 240
        });
        expect(manager.runtime.renderer.updateDrawablePosition).toHaveBeenCalledWith(1, [120, -60]);
        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenCalledWith(1, 90, [100, 100]);
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
