import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';

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
    manager.buildingMaterials = new Map();
    manager.buildingTextures = new Map();
    manager.fontFaces = new Map();
    manager.lights = null;
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

const makePatchableTarget = manager => {
    const target = makeTarget();
    manager.runtime.stageHeight = 360;
    manager.runtime.stageWidth = 480;
    manager.runtime.renderer.getCurrentSkinSize = jest.fn(() => [100, 100]);
    target.renderer = manager.runtime.renderer;
    target.runtime = manager.runtime;
    target.setCostume = jest.fn();
    target.setXY = jest.fn();
    target.setDirection = jest.fn();
    target.setVisible = jest.fn();
    target.updateAllDrawableProperties = jest.fn();
    target._getRenderedDirectionAndScale = jest.fn(() => ({direction: 90, scale: [target.size, target.size]}));
    target.setSize = RenderedTarget.prototype.setSize;
    return target;
};

const makeTimelineManager = () => {
    const manager = makeManager();
    manager.vm = {
        setFramerate: jest.fn(),
        setStageSize: jest.fn()
    };
    manager.runtime.currentMSecs = 10000;
    manager.runtime.updateCurrentMSecs = jest.fn();
    manager.runtime.stopAll = jest.fn();
    manager.runtime.startHats = jest.fn();
    manager.runtime.threads = [];
    manager.runtime.emitProjectChanged = jest.fn();
    manager.runtime.targets = [];
    manager.runtime.ioDevices = {
        clock: {
            _paused: true,
            _pausedTime: 0,
            _projectTimer: {startTime: 10000},
            projectTimer: jest.fn(() => 2.5)
        }
    };
    manager.timeline = {
        currentTime: 0,
        duration: 10,
        framerate: 30,
        height: 360,
        pendingFrame: false,
        playing: false,
        recording: false,
        sound: '',
        width: 480
    };
    manager.timelineSoundSources = new Set();
    manager.playedTimelineSoundBlocks = new Set();
    manager.blockingVideoRenders = new Set();
    manager.renderingSoundEvents = [];
    manager.renderingFrames = [];
    manager.emit = jest.fn();
    return manager;
};

describe('MovieAssetManager rendering performance', () => {
    test('routes unified imports by file extension', async () => {
        const manager = makeManager();
        manager.addModelsFromFiles = jest.fn(async () => [{name: 'scene'}]);
        manager.addCostumesFromFile = jest.fn(async () => [{name: 'image'}]);
        manager.addSoundFromFile = jest.fn(async () => ({name: 'audio'}));
        manager.addVideoFromFile = jest.fn(async () => ({name: 'clip'}));
        manager.addFontFromFile = jest.fn(async () => 'typeface');

        const modelFiles = [
            {name: 'scene.obj'},
            {name: 'scene.mtl'},
            {name: 'texture.png'}
        ];
        await manager.importFiles('target', modelFiles);
        expect(manager.addModelsFromFiles).toHaveBeenCalledWith('target', modelFiles);
        expect(manager.addCostumesFromFile).not.toHaveBeenCalled();

        await manager.importFiles('target', [
            {name: 'image.svg'},
            {name: 'audio.wav'},
            {name: 'clip.webm'},
            {name: 'typeface.woff2'}
        ]);
        expect(manager.addCostumesFromFile).toHaveBeenCalledWith('target', {name: 'image.svg'});
        expect(manager.addSoundFromFile).toHaveBeenCalledWith('target', {name: 'audio.wav'});
        expect(manager.addVideoFromFile).toHaveBeenCalledWith('target', {name: 'clip.webm'});
        expect(manager.addFontFromFile).toHaveBeenCalledWith({name: 'typeface.woff2'});
    });

    test('sets exact sprite sizes and restores position fencing', () => {
        const manager = makeManager();
        manager.runtime.runtimeOptions = {fencing: true};
        manager.applyProjection = jest.fn();
        manager.rerenderTargetModel = jest.fn();
        const target = makePatchableTarget(manager);

        manager.patchTarget(target);
        target.setSize(0);
        expect(target.size).toBe(0);
        expect(manager.runtime.runtimeOptions.fencing).toBe(true);

        target.setSize(10000);
        expect(target.size).toBe(10000);
        expect(manager.runtime.runtimeOptions.fencing).toBe(true);
    });

    test('uses current advanced settings for a project without saved timeline settings', () => {
        const manager = makeTimelineManager();
        manager.runtime.frameLoop = {framerate: 60};

        manager.restoreTimeline();

        expect(manager.timeline.framerate).toBe(60);
        expect(manager.timeline.width).toBe(480);
        expect(manager.timeline.height).toBe(360);
        expect(manager.vm.setFramerate).not.toHaveBeenCalled();
        expect(manager.vm.setStageSize).not.toHaveBeenCalled();
    });

    test('keeps hidden legacy timeline audio when applying the new settings form', () => {
        const manager = makeTimelineManager();
        manager.timeline.sound = 'Legacy music';

        manager.updateTimelineSettings({
            duration: 12,
            framerate: 24,
            height: 1080,
            width: 1920
        });

        expect(manager.timeline.sound).toBe('Legacy music');
        expect(manager.vm.setStageSize).not.toHaveBeenCalled();
    });

    test('announces the project rendering settings without returning asynchronous work', () => {
        const manager = makeTimelineManager();

        const result = manager.updateTimelineSettings({
            duration: 20,
            framerate: 60,
            height: 1080,
            width: 1920
        });

        expect(result).toBeUndefined();
        expect(manager.emit).toHaveBeenCalledWith('timelineSettingsChanged', {
            duration: 20,
            framerate: 60,
            height: 1080,
            width: 1920
        }, {
            previousSettings: {
                duration: 10,
                framerate: 30,
                height: 360,
                width: 480
            },
            remote: false
        });
    });

    test('uses output resolution for render pixels without changing the logical stage size', () => {
        const manager = makeTimelineManager();
        const canvas = {height: 360, width: 640};
        manager.runtime.renderer.canvas = canvas;
        manager.runtime.renderer.resize = jest.fn((width, height) => {
            canvas.width = width;
            canvas.height = height;
        });
        manager.timeline.height = 1080;
        manager.timeline.width = 1920;

        manager.renderTimeline();

        expect(manager.runtime.renderer.resize).toHaveBeenCalledWith(1920, 1080);
        expect(manager.vm.setStageSize).not.toHaveBeenCalled();

        manager.stopTimeline();

        expect(manager.runtime.renderer.resize).toHaveBeenLastCalledWith(640, 360);
    });

    test('starts render frame hats from the selected timeline time', () => {
        const manager = makeTimelineManager();
        manager.seekTimeline(2.5);
        manager.playTimeline();
        manager.handleTimelineBeforeExecute();

        expect(manager.runtime.ioDevices.clock._projectTimer.startTime).toBe(7500);
        expect(manager.runtime.ioDevices.clock._paused).toBe(false);
        expect(manager.runtime.startHats).toHaveBeenCalledWith('event_renderframe');
    });

    test('refreshes a paused timeline preview at its current time', () => {
        jest.useFakeTimers();
        const manager = makeTimelineManager();
        manager.timeline.currentTime = 2.5;

        manager.requestTimelinePreviewRefresh();
        jest.runOnlyPendingTimers();

        expect(manager.runtime.stopAll).toHaveBeenCalledTimes(1);
        expect(manager.timeline.currentTime).toBe(2.5);
        expect(manager.timeline.pendingFrame).toBe(true);
        expect(manager.runtime.ioDevices.clock._paused).toBe(true);
        jest.useRealTimers();
    });

    test('does not interrupt timeline playback to refresh a preview', () => {
        jest.useFakeTimers();
        const manager = makeTimelineManager();
        manager.timeline.playing = true;

        manager.requestTimelinePreviewRefresh();
        jest.runOnlyPendingTimers();

        expect(manager.runtime.stopAll).not.toHaveBeenCalled();
        expect(manager.timeline.pendingFrame).toBe(false);
        jest.useRealTimers();
    });

    test('coalesces repeated timeline preview refresh requests', () => {
        jest.useFakeTimers();
        const manager = makeTimelineManager();

        manager.requestTimelinePreviewRefresh();
        manager.requestTimelinePreviewRefresh();
        manager.requestTimelinePreviewRefresh();
        jest.runOnlyPendingTimers();

        expect(manager.runtime.stopAll).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test('starts the render frame sound at the selected timeline time', () => {
        const manager = makeTimelineManager();
        const source = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            playbackRate: {value: 1},
            start: jest.fn(),
            stop: jest.fn()
        };
        const gain = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            gain: {value: 1}
        };
        const input = {};
        const soundPlayer = {buffer: {duration: 8}};
        const target = {
            blocks: {
                getBlock: jest.fn(() => ({
                    fields: {SOUND_MENU: {value: 'Music'}},
                    opcode: 'event_renderframe'
                })),
                getScripts: jest.fn(() => ['render'])
            },
            id: 'main',
            isOriginal: true,
            soundEffects: {pan: 0, pitch: 0},
            sprite: {
                soundBank: {getSoundPlayer: jest.fn(() => soundPlayer)},
                sounds: [{name: 'Music', soundId: 'music'}]
            },
            volume: 75
        };
        manager.runtime.targets = [target];
        manager.runtime.audioEngine = {
            audioContext: {
                createBufferSource: jest.fn(() => source),
                createGain: jest.fn(() => gain)
            },
            getInputNode: jest.fn(() => input)
        };

        manager.seekTimeline(2.5);
        manager.playTimeline();

        expect(source.buffer).toBe(soundPlayer.buffer);
        expect(source.start).toHaveBeenCalledWith(0, 2.5);
        expect(gain.gain.value).toBe(0.75);
        expect(gain.connect).toHaveBeenCalledWith(input);
    });

    test('keeps the legacy sound block playing only at its selected frame', () => {
        const manager = makeTimelineManager();
        const playSound = jest.fn();
        const sound = {name: 'Beat'};
        const target = {
            id: 'main',
            soundEffects: {pan: 0, pitch: 0},
            sprite: {sounds: [sound]},
            volume: 100
        };
        const util = {
            target,
            thread: {peekStack: () => 'play-at-frame'}
        };
        manager.runtime._primitives.sound_play = playSound;
        manager.timeline.playing = true;
        manager.timeline.currentTime = 10 / 30;

        manager.playSoundAtFrame({FRAME: 10, SOUND_MENU: 'Beat'}, util);
        manager.playSoundAtFrame({FRAME: 10, SOUND_MENU: 'Beat'}, util);

        expect(playSound).toHaveBeenCalledTimes(1);
        expect(playSound).toHaveBeenCalledWith({SOUND_MENU: 'Beat'}, util);
    });

    test('plays the time-based sound immediately from the selected time', () => {
        const manager = makeTimelineManager();
        const source = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            playbackRate: {value: 1},
            start: jest.fn(),
            stop: jest.fn()
        };
        const gain = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            gain: {value: 1}
        };
        const input = {};
        const sound = {name: 'Beat', soundId: 'beat'};
        const target = {
            id: 'main',
            soundEffects: {pan: 0, pitch: 120},
            sprite: {
                soundBank: {getSoundPlayer: jest.fn(() => ({buffer: {duration: 8}}))},
                sounds: [sound]
            },
            volume: 75
        };
        manager.runtime.audioEngine = {
            audioContext: {
                createBufferSource: jest.fn(() => source),
                createGain: jest.fn(() => gain)
            },
            getInputNode: jest.fn(() => input)
        };

        manager.playSoundAtTime({SOUND_MENU: 'Beat', TIME: 1.25}, {target});

        expect(source.playbackRate.value).toBe(2);
        expect(source.start).toHaveBeenCalledWith(0, 1.25);
        expect(gain.gain.value).toBe(0.75);
        expect(gain.connect).toHaveBeenCalledWith(input);
    });

    test('keeps paused timeline scrubbing silent', () => {
        const manager = makeTimelineManager();
        manager.startSoundAtTime = jest.fn();
        const target = {
            blocks: {
                getBlock: jest.fn(() => ({opcode: 'event_renderframe'}))
            },
            id: 'main',
            sprite: {sounds: [{name: 'Beat'}]}
        };

        manager.playSoundAtTime({SOUND_MENU: 'Beat', TIME: 0.5}, {
            target,
            thread: {
                peekStack: () => 'play-at-time',
                topBlock: 'render-frame-script'
            }
        });

        expect(manager.startSoundAtTime).not.toHaveBeenCalled();
    });

    test('does not restart a time-based sound on every render-frame step', () => {
        const manager = makeTimelineManager();
        manager.timeline.playing = true;
        manager.startSoundAtTime = jest.fn();
        const target = {
            id: 'main',
            sprite: {sounds: [{name: 'Beat'}]}
        };
        const util = {
            target,
            thread: {peekStack: () => 'play-at-time'}
        };

        manager.playSoundAtTime({SOUND_MENU: 'Beat', TIME: 0.5}, util);
        manager.playSoundAtTime({SOUND_MENU: 'Beat', TIME: 0.5}, util);

        expect(manager.startSoundAtTime).toHaveBeenCalledTimes(1);
        expect(manager.startSoundAtTime).toHaveBeenCalledWith(target, target.sprite.sounds[0], 0.5);
    });

    test('records the sound offset when rendering a time-based sound', () => {
        const manager = makeTimelineManager();
        const sound = {name: 'Beat'};
        const target = {
            id: 'main',
            soundEffects: {pan: -25, pitch: 120},
            sprite: {sounds: [sound]},
            volume: 75
        };
        manager.timeline.playing = true;
        manager.timeline.recording = true;
        manager.timeline.renderFrameIndex = 12;

        manager.playSoundAtTime({SOUND_MENU: 'Beat', TIME: 0.25}, {
            target,
            thread: {peekStack: () => 'play-at-time'}
        });

        expect(manager.renderingSoundEvents).toEqual([{
            frame: 12,
            offset: 0.25,
            pan: -25,
            pitch: 120,
            sound,
            target,
            volume: 75
        }]);
    });

    test('records frame-based sounds for deterministic export without playing them', () => {
        const manager = makeTimelineManager();
        const playSound = jest.fn();
        const sound = {name: 'Beat'};
        const target = {
            id: 'main',
            soundEffects: {pan: -25, pitch: 120},
            sprite: {sounds: [sound]},
            volume: 75
        };
        manager.runtime._primitives.sound_play = playSound;
        manager.timeline.playing = true;
        manager.timeline.recording = true;
        manager.timeline.renderFrameIndex = 12;

        manager.playSoundAtFrame({FRAME: 12, SOUND_MENU: 'Beat'}, {
            target,
            thread: {peekStack: () => 'play-at-frame'}
        });

        expect(playSound).not.toHaveBeenCalled();
        expect(manager.renderingSoundEvents).toEqual([{
            frame: 12,
            pan: -25,
            pitch: 120,
            sound,
            target,
            volume: 75
        }]);
    });

    test('turns recorded sound frames into timed export clips', async () => {
        const manager = makeTimelineManager();
        const sound = {name: 'Beat'};
        const buffer = {duration: 2};
        manager.renderingSoundEvents = [{
            frame: 12,
            pan: -25,
            pitch: 120,
            sound,
            volume: 75
        }];
        manager.decodeRenderingSound = jest.fn(() => Promise.resolve({
            buffer,
            context: {},
            ownsContext: false
        }));

        const audio = await manager.decodeRenderingAudio(null, '', 24);

        expect(audio.clips).toEqual([{
            buffer,
            offset: 0,
            pan: -0.25,
            playbackRate: 2,
            startTime: 0.5,
            volume: 0.75
        }]);
    });

    test('turns down the entire rendering mix when audio clips overlap', () => {
        const manager = makeTimelineManager();
        const destination = {};
        const gain = {
            connect: jest.fn(),
            gain: {value: 1}
        };
        const context = {
            createGain: jest.fn(() => gain)
        };

        const clips = [
            {buffer: {duration: 2}, offset: 0, playbackRate: 1, startTime: 0},
            {buffer: {duration: 2}, offset: 0, playbackRate: 1, startTime: 1}
        ];
        const master = manager.createRenderingAudioMaster(context, destination, clips);

        expect(master.input).toBe(gain);
        expect(master.nodes).toEqual([gain]);
        expect(gain.gain.value).toBeCloseTo(0.445625);
        expect(gain.connect).toHaveBeenCalledWith(destination);
    });

    test('does not alter rendering audio when clips do not overlap', () => {
        const manager = makeTimelineManager();
        const destination = {};
        const context = {
            createGain: jest.fn()
        };
        const clips = [
            {buffer: {duration: 1}, offset: 0, playbackRate: 1, startTime: 0},
            {buffer: {duration: 1}, offset: 0, playbackRate: 1, startTime: 1}
        ];

        const master = manager.createRenderingAudioMaster(context, destination, clips);

        expect(master).toEqual({input: destination, nodes: []});
        expect(context.createGain).not.toHaveBeenCalled();
    });

    test('restarts and stops the selected sound when seeking and pausing', () => {
        const manager = makeTimelineManager();
        manager.timeline.playing = true;
        manager.playTimelineSounds = jest.fn();
        manager.stopTimelineSounds = jest.fn();

        manager.seekTimeline(4);
        expect(manager.stopTimelineSounds).toHaveBeenCalledTimes(1);
        expect(manager.playTimelineSounds).toHaveBeenCalledWith(4);

        manager.pauseTimeline();
        expect(manager.stopTimelineSounds).toHaveBeenCalledTimes(2);
        expect(manager.timeline.playing).toBe(false);
    });

    test('pauses the timeline timer without capturing preview playback', () => {
        const manager = makeTimelineManager();
        manager.addRenderingFrame = jest.fn();
        manager.timeline.playing = true;
        manager.timeline.renderedThisStep = true;

        manager.handleTimelineAfterExecute();
        expect(manager.addRenderingFrame).not.toHaveBeenCalled();
        expect(manager.timeline.currentTime).toBe(2.5);

        manager.pauseTimeline();
        expect(manager.timeline.playing).toBe(false);
        expect(manager.runtime.ioDevices.clock._paused).toBe(true);
        expect(manager.runtime.stopAll).toHaveBeenCalled();
    });

    test('captures rendering frames at deterministic frame times', () => {
        const manager = makeTimelineManager();
        manager.timeline.framerate = 10;
        manager.addRenderingFrame = jest.fn();

        manager.renderTimeline();
        manager.handleTimelineBeforeExecute();
        manager.handleTimelineAfterExecute();
        manager.handleTimelineBeforeExecute();

        expect(manager.addRenderingFrame).toHaveBeenCalledTimes(1);
        expect(manager.timeline.currentTime).toBe(0.1);
        expect(manager.runtime.ioDevices.clock._projectTimer.startTime).toBe(9900);
    });

    test('waits for every render-frame thread to finish before capturing', () => {
        const manager = makeTimelineManager();
        const slowThread = {};
        manager.runtime.startHats.mockReturnValue([slowThread]);
        manager.runtime.threads = [slowThread];
        manager.addRenderingFrame = jest.fn();

        manager.renderTimeline();
        manager.handleTimelineBeforeExecute();
        manager.handleTimelineAfterExecute();

        expect(manager.addRenderingFrame).not.toHaveBeenCalled();
        expect(manager.timeline.renderFrameIndex).toBe(0);
        expect(manager.timeline.waitingForFrame).toBe(true);

        manager.handleTimelineBeforeExecute();
        expect(manager.runtime.startHats).toHaveBeenCalledTimes(1);
        manager.runtime.threads = [];
        manager.handleTimelineAfterExecute();

        expect(manager.addRenderingFrame).toHaveBeenCalledTimes(1);
        expect(manager.timeline.renderFrameIndex).toBe(1);
    });

    test('waits for asynchronous visual rendering after the frame script finishes', () => {
        const manager = makeTimelineManager();
        const target = makeTarget();
        const visualRender = deferred();
        const state = manager.getTargetState(target);
        state.requestedMode = 'model';
        state.modelRenderPromise = visualRender.promise;
        manager.addRenderingFrame = jest.fn();

        manager.renderTimeline();
        manager.handleTimelineBeforeExecute();
        manager.handleTimelineAfterExecute();

        expect(manager.addRenderingFrame).not.toHaveBeenCalled();
        expect(manager.timeline.waitingForFrame).toBe(true);

        state.modelRenderPromise = null;
        manager.handleTimelineBeforeExecute();
        manager.handleTimelineAfterExecute();

        expect(manager.addRenderingFrame).toHaveBeenCalledTimes(1);
    });

    test('renders fresh frames before exporting the timeline', async () => {
        const manager = makeTimelineManager();
        delete manager.emit;
        manager.renderingFrames = [{old: true}];
        manager.exportTimeline = jest.fn(() => Promise.resolve('exported'));

        const exportPromise = manager.renderAndExportTimeline();

        expect(manager.renderingFrames).toEqual([]);
        expect(manager.timeline.recording).toBe(true);
        expect(manager.exportTimeline).not.toHaveBeenCalled();

        manager.emit('timelineRenderComplete');

        await expect(exportPromise).resolves.toBe('exported');
        expect(manager.exportTimeline).toHaveBeenCalledTimes(1);
    });

    test('does not export when timeline rendering is stopped', async () => {
        const manager = makeTimelineManager();
        delete manager.emit;
        manager.exportTimeline = jest.fn(() => Promise.resolve());

        const exportPromise = manager.renderAndExportTimeline();
        manager.stopTimeline();

        await expect(exportPromise).rejects.toThrow('Rendering was stopped');
        expect(manager.exportTimeline).not.toHaveBeenCalled();
    });

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

    test('applies set camera z rotation to a projected sprite', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.runtime.emitProjectChanged = jest.fn();
        manager.runtime.targets = [target];
        manager.emit = jest.fn();
        manager.camera = {
            focalLength: 480,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        manager.installPrimitives();

        manager.runtime._primitives.motion_setcamerarotation({X: 0, Y: 0, Z: 35});

        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenCalledWith(1, 125, [100, 100]);
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

    test('keeps per-axis sprite dimensions when a text or costume skin is applied', () => {
        const manager = makeManager();
        const target = makeTarget();
        target._getRenderedDirectionAndScale = jest.fn(() => ({
            direction: 90,
            scale: [160, 45]
        }));
        target.currentCostume = 0;
        target.getCostumes = jest.fn(() => [{skinId: 2}]);

        manager.applyBitmap(target, {}, 'text');
        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenLastCalledWith(1, 90, [160, 45]);

        manager.showCostume(target);
        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenLastCalledWith(1, 90, [160, 45]);
    });

    test('renders a model scene without putting timeline playback into promise-wait mode', () => {
        const manager = makeManager();
        const target = makeTarget();
        const modelRender = deferred();
        manager.renderModelToScene = jest.fn(() => modelRender.promise);
        manager.installPrimitives();

        const renderResult = manager.runtime._primitives.looks_rendermodel({MODEL: 'Cube'}, {target});

        expect(renderResult).toBeUndefined();
        expect(manager.renderModelToScene).toHaveBeenCalledWith(target, 'Cube');
    });

    test('renders wall geometry with the current Motion position, rotation, and scale', () => {
        const manager = makeManager();
        const target = makeTarget();
        manager.queueModelSceneRender = jest.fn();

        manager.addBuildingMaterial('brick');
        const record = manager.buildingMaterials.get('brick');
        expect(record.material.color.getHexString()).toBe('ff00ff');
        expect(record.material.emissive.getHexString()).toBe('000000');
        expect(record.material.roughness).toBe(1);
        expect(record.material.ior).toBe(1.45);

        manager.setBuildingMaterialColor('brick', 'albedo', '#804020');
        manager.setTargetPosition(target, 12, -8, 720);
        manager.setTargetRotation(target, 10, 20, 30);
        manager.setTargetScale(target, 2, 0.5, 3);
        manager.renderBuildingPrimitive('wall', {
            MATERIAL: 'brick',
            U1: 0,
            U2: 10,
            V1: 0,
            V2: 1,
            X1: 0,
            X2: 100,
            Y1: 0,
            Y2: 100,
            Z1: 0,
            Z2: 100
        }, target);

        const state = manager.getTargetState(target);
        expect(record.material.color.getHexString()).toBe('804020');
        expect(state.modelScene).toHaveLength(1);
        expect(state.modelScene[0].sourceObject.isMesh).toBe(true);
        expect(state.modelScene[0].sourceObject.material).toBe(record.material);
        expect(state.modelScene[0].transform).toEqual({
            rotation: {x: 10, y: 20, z: 30},
            rotationOrder: 'XYZ',
            scale: {x: 2, y: 0.5, z: 3},
            size: 100,
            worldX: 12,
            worldY: -8,
            worldZ: 720
        });
        expect(manager.queueModelSceneRender).toHaveBeenCalledWith(target);
    });

    test('registers building and material primitives', () => {
        const manager = makeManager();
        manager.installPrimitives();

        expect(typeof manager.runtime._primitives.looks_renderwall).toBe('function');
        expect(typeof manager.runtime._primitives.looks_renderfloor).toBe('function');
        expect(typeof manager.runtime._primitives.looks_renderbox).toBe('function');
        expect(typeof manager.runtime._primitives.looks_clearmaterial).toBe('function');
        expect(typeof manager.runtime._primitives.looks_addmaterial).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setalbedofromcolor).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setalbedofromtexture).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setemissionfromcolor).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setemissionfromtexture).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setdisplacementmap).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setnormalmap).toBe('function');
        expect(typeof manager.runtime._primitives.looks_setroughmap).toBe('function');
    });

    test('does not put building or texture blocks into VM promise-wait mode', () => {
        const manager = makeManager();
        const target = makeTarget();
        const backgroundRender = Promise.resolve();
        const backgroundTexture = Promise.resolve();
        manager.renderBuildingPrimitive = jest.fn(() => backgroundRender);
        manager.setBuildingMaterialTexture = jest.fn(() => backgroundTexture);
        manager.runWithoutWaiting = jest.fn();
        manager.installPrimitives();

        const renderArgs = {MATERIAL: 'brick'};
        expect(manager.runtime._primitives.looks_renderwall(renderArgs, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_renderfloor(renderArgs, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_renderbox(renderArgs, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_setalbedofromtexture({
            MATERIAL: 'brick',
            TEXTURE: 'costume1'
        }, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_setemissionfromtexture({
            MATERIAL: 'brick',
            TEXTURE: 'costume1'
        }, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_setdisplacementmap({
            MATERIAL: 'brick',
            TEXTURE: 'costume1'
        }, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_setnormalmap({
            MATERIAL: 'brick',
            TEXTURE: 'costume1'
        }, {target})).toBeUndefined();
        expect(manager.runtime._primitives.looks_setroughmap({
            MATERIAL: 'brick',
            TEXTURE: 'costume1'
        }, {target})).toBeUndefined();

        expect(manager.runWithoutWaiting).toHaveBeenCalledTimes(8);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(backgroundRender);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(backgroundTexture);
    });

    test('clears all building materials back to the invalid defaults', () => {
        const manager = makeManager();
        const albedoTexture = {dispose: jest.fn()};
        const emissionTexture = {dispose: jest.fn()};
        const brick = manager.getBuildingMaterialRecord('brick');
        const glass = manager.getBuildingMaterialRecord('glass');
        brick.albedo = '#804020';
        brick.albedoTexture = albedoTexture;
        glass.emission = '#ffffff';
        glass.emissionTexture = emissionTexture;

        manager.clearBuildingMaterials();

        expect(brick.albedo).toBe('#ff00ff');
        expect(brick.albedoTexture).toBeNull();
        expect(glass.emission).toBe('#000000');
        expect(glass.emissionTexture).toBeNull();
        expect(brick.material.color.getHexString()).toBe('ff00ff');
        expect(glass.material.emissive.getHexString()).toBe('000000');
        expect(albedoTexture.dispose).not.toHaveBeenCalled();
        expect(emissionTexture.dispose).not.toHaveBeenCalled();
        expect(manager.buildingMaterials.get('brick')).toBe(brick);
    });

    test('reuses decoded textures synchronously across clear-render-stamp loops', () => {
        const manager = makeManager();
        const texture = {dispose: jest.fn()};
        const asset = {encodeDataURI: jest.fn(() => 'data:image/png;base64,unused')};
        const target = makeTarget();
        target.getCostumes = jest.fn(() => [{asset, name: 'brick'}]);
        manager.buildingTextures.set(asset, {
            color: {
                promise: Promise.resolve(texture),
                texture
            }
        });

        manager.addBuildingMaterial('wall');
        expect(manager.setBuildingMaterialTexture('wall', 'albedo', 'brick', target)).toBeUndefined();
        const record = manager.buildingMaterials.get('wall');
        expect(record.material.map).toBe(texture);

        manager.clearBuildingMaterials();
        manager.addBuildingMaterial('wall');
        expect(manager.setBuildingMaterialTexture('wall', 'albedo', 'brick', target)).toBeUndefined();

        expect(record.material.map).toBe(texture);
        expect(record.material.color.getHexString()).toBe('ffffff');
        expect(texture.dispose).not.toHaveBeenCalled();
        expect(asset.encodeDataURI).not.toHaveBeenCalled();
    });

    test('sets cached data-map textures synchronously after a material clear', () => {
        const manager = makeManager();
        const texture = {dispose: jest.fn()};
        const asset = {encodeDataURI: jest.fn(() => 'data:image/png;base64,unused')};
        const target = makeTarget();
        target.getCostumes = jest.fn(() => [{asset, name: 'surface'}]);
        manager.buildingTextures.set(asset, {
            data: {
                promise: Promise.resolve(texture),
                texture
            }
        });

        manager.addBuildingMaterial('wall');
        expect(manager.setBuildingMaterialTexture('wall', 'displacement', 'surface', target)).toBeUndefined();
        expect(manager.setBuildingMaterialTexture('wall', 'normal', 'surface', target)).toBeUndefined();
        expect(manager.setBuildingMaterialTexture('wall', 'roughness', 'surface', target)).toBeUndefined();
        const record = manager.buildingMaterials.get('wall');
        expect(record.material.displacementMap).toBe(texture);
        expect(record.material.normalMap).toBe(texture);
        expect(record.material.roughnessMap).toBe(texture);

        manager.clearBuildingMaterials();
        manager.addBuildingMaterial('wall');
        expect(manager.setBuildingMaterialTexture('wall', 'normal', 'surface', target)).toBeUndefined();

        expect(record.material.displacementMap).toBeNull();
        expect(record.material.normalMap).toBe(texture);
        expect(record.material.roughnessMap).toBeNull();
        expect(texture.dispose).not.toHaveBeenCalled();
        expect(asset.encodeDataURI).not.toHaveBeenCalled();
    });

    test('does not reset an existing material when add material runs again in a loop', () => {
        const manager = makeManager();
        manager.addBuildingMaterial('wall');
        manager.setBuildingMaterialColor('wall', 'albedo', '#804020');

        manager.addBuildingMaterial('wall');

        expect(manager.buildingMaterials.get('wall').material.color.getHexString()).toBe('804020');
    });

    test('sets a one-based model animation frame without putting the VM into promise-wait mode', () => {
        const manager = makeManager();
        const target = makeTarget();
        const modelRender = deferred();
        const state = manager.getTargetState(target);
        state.requestedMode = 'model';
        state.modelScene = [{assetId: 'cube'}];
        manager.queueModelSceneRender = jest.fn(() => modelRender.promise);
        manager.installPrimitives();

        const renderResult = manager.runtime._primitives.looks_setmodelframeto({FRAME: 18}, {target});

        expect(renderResult).toBeUndefined();
        expect(state.modelFrame).toBe(18);
        expect(manager.queueModelSceneRender).toHaveBeenCalledWith(target);
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

    test('registers accumulating point and spot lights and clears the authored light scene', () => {
        const manager = makeManager();
        manager.runtime.targets = [];
        manager.installPrimitives();

        manager.runtime._primitives.looks_addpointlight({
            COLOR: '#ff8040',
            INTENSITY: 3,
            RADIUS: 800,
            SHADOW: 0.25,
            X: 10,
            Y: 20,
            Z: 30
        });
        manager.runtime._primitives.looks_addlight({
            ANGLE: 35,
            COLOR: '#ffffff',
            INTENSITY: 2,
            RADIUS: 1200,
            SHADOW: 1,
            X: -10,
            Y: 40,
            Z: 100
        });

        expect(manager.lights).toEqual([
            expect.objectContaining({
                color: '#ff8040',
                shadow: 0.25,
                type: 'point'
            }),
            expect.objectContaining({
                angle: 35,
                shadow: 1,
                type: 'spot'
            })
        ]);

        manager.runtime._primitives.looks_clearlight();
        expect(manager.lights).toEqual([]);
    });

    test('rerenders only targets currently displaying a 3D model when lights change', () => {
        const manager = makeManager();
        const target = makeTarget();
        const otherTarget = {...makeTarget(), id: 'other'};
        manager.runtime.targets = [target, otherTarget];
        manager.getTargetState(target).requestedMode = 'model';
        manager.getTargetState(target).modelScene = [{assetId: 'cube'}];
        manager.getTargetState(otherTarget).requestedMode = 'video';
        manager.queueModelSceneRender = jest.fn();

        manager.clearLights();

        expect(manager.queueModelSceneRender).toHaveBeenCalledTimes(1);
        expect(manager.queueModelSceneRender).toHaveBeenCalledWith(target);
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

    test('publishes the rendered 3D zBuffer for Pen FX', () => {
        const manager = makeManager();
        const target = makeTarget();
        const depthBuffer = {canvas: {name: 'depth'}, near: 4, far: 900, version: 7};
        manager.modelRenderer = {getDepthBuffer: jest.fn(() => depthBuffer)};
        manager.getTargetState(target);

        manager.publishModelZBuffer(target);

        expect(manager.runtime.movieZBuffer).toEqual({...depthBuffer, targetId: target.id});
        expect(manager.getTargetState(target).zBuffer).toBe(manager.runtime.movieZBuffer);
    });

    test('renders cached models synchronously after project loading', () => {
        const manager = makeManager();
        const target = makeTarget();
        const canvas = {name: 'scene canvas'};
        const modelObject = {name: 'cube object'};
        manager.camera = {name: 'camera'};
        manager.models.set(target.id, [{activeMotion: 'Walk', assetId: 'cube', name: 'Cube'}]);
        manager.modelObjects.set('cube', {object: modelObject});
        manager.getStageSize = jest.fn(() => [480, 360]);
        manager.modelRenderer = {
            renderWorldScene: jest.fn(() => canvas)
        };
        manager.applyBitmap = jest.fn();
        manager.applyProjection = jest.fn();

        manager.setModelFrame(target, 18);
        const renderPromise = manager.renderModelToScene(target, 'Cube');

        expect(manager.modelRenderer.renderWorldScene).toHaveBeenCalledWith([
            expect.objectContaining({
                animationName: 'Walk',
                frame: 18,
                sourceObject: modelObject
            })
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
        expect(manager.runtime._primitives.motion_setrotation({X: 10, Y: 20, Z: 30}, {target}))
            .toBeUndefined();
        expect(manager.runtime._primitives.motion_setscale({X: 2, Y: 0.5, Z: 3}, {target}))
            .toBeUndefined();
        manager.runtime._primitives.motion_setcamerato({X: 1, Y: 2, Z: 3});
        manager.runtime._primitives.motion_setfov({FOV: 60});

        expect(manager.setTargetPosition).toHaveBeenCalledWith(target, 12, -8, 720);
        expect(manager.setTargetPositionWithoutCamera).toHaveBeenCalledWith(target, 20, -10, 300);
        expect(manager.setTargetRotation).toHaveBeenCalledWith(target, 10, 20, 30);
        expect(manager.setTargetScale).toHaveBeenCalledWith(target, 2, 0.5, 3);
        expect(manager.setCameraPosition).toHaveBeenCalledWith(1, 2, 3);
        expect(manager.setFOV).toHaveBeenCalledWith(60);
    });

    test('projects costume, text, and video skins with rotation X/Y and scale X/Y/Z', () => {
        const manager = makeManager();
        const target = makeTarget();
        target.visible = true;
        target._getRenderedDirectionAndScale = jest.fn(() => ({direction: 90, scale: [100, 100]}));
        const modelMatrix = new Float32Array(16);
        const drawable = {
            _inverseTransformDirty: false,
            _transformedHullDirty: false,
            getUniforms: jest.fn(() => ({u_modelMatrix: modelMatrix})),
            skin: {
                rotationCenter: [100, 50],
                size: [200, 100]
            }
        };
        manager.runtime.renderer._allDrawables = [];
        manager.runtime.renderer._allDrawables[target.drawableID] = drawable;
        manager.camera = {
            focalLength: 480,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };

        manager.setTargetScale(target, 2, 0.5, 3);
        manager.setTargetRotation(target, 60, 30, 0);

        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenLastCalledWith(
            target.drawableID,
            90,
            [200, 50]
        );
        // X/Y rotation puts local plane axes into depth, producing perspective W terms.
        expect(Math.abs(modelMatrix[3])).toBeGreaterThan(0);
        expect(Math.abs(modelMatrix[7])).toBeGreaterThan(0);
        // Z scale is retained in the third 3D basis even though the current sprite quad is flat.
        expect(Math.hypot(modelMatrix[8], modelMatrix[9], modelMatrix[11])).toBeGreaterThan(0);
        expect(drawable._inverseTransformDirty).toBe(true);
        expect(drawable._transformedHullDirty).toBe(true);
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

    test('draws and stamps a costume with the complete object transform', () => {
        const manager = makeManager();
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.applyProjection = jest.fn();
        manager.runtime.graphicEffectsManager = {setScale: jest.fn()};
        manager.runtime._primitives.pen_stamp = jest.fn();
        const target = {
            getCostumeIndexByName: jest.fn(() => 2),
            isStage: false,
            setCostume: jest.fn(),
            setSize: jest.fn()
        };
        const configuration = {
            asset: 'costume1',
            height: 80,
            position: {x: 10, y: 20, z: 30},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            size: 75,
            source: 'costume',
            width: 125
        };

        expect(manager.drawObject(target, configuration)).toBeUndefined();
        expect(manager.setTargetPosition).toHaveBeenCalledWith(target, 10, 20, 30);
        expect(manager.setTargetRotation).toHaveBeenCalledWith(target, 1, 2, 3);
        expect(manager.setTargetScale).toHaveBeenCalledWith(target, 2, 3, 4);
        expect(target.setSize).toHaveBeenCalledWith(75);
        expect(manager.runtime.graphicEffectsManager.setScale).toHaveBeenCalledWith(target, 'width', 125);
        expect(manager.runtime.graphicEffectsManager.setScale).toHaveBeenCalledWith(target, 'height', 80);
        expect(target.setCostume).toHaveBeenCalledWith(2);
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledWith({}, {target});
        expect(manager.setTargetPosition.mock.invocationCallOrder[0])
            .toBeLessThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(manager.setTargetRotation.mock.invocationCallOrder[0])
            .toBeLessThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(manager.setTargetScale.mock.invocationCallOrder[0])
            .toBeLessThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(target.setSize.mock.invocationCallOrder[0])
            .toBeLessThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(manager.runtime.graphicEffectsManager.setScale.mock.invocationCallOrder[1])
            .toBeLessThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(target.setCostume.mock.invocationCallOrder[0])
            .toBeLessThan(manager.runtime._primitives.pen_stamp.mock.invocationCallOrder[0]);
        expect(manager.applyProjection).toHaveBeenCalledWith(target);
        expect(manager.applyProjection.mock.invocationCallOrder[0])
            .toBeGreaterThan(target.setCostume.mock.invocationCallOrder[0]);
        expect(manager.applyProjection.mock.invocationCallOrder[0])
            .toBeLessThan(manager.runtime._primitives.pen_stamp.mock.invocationCallOrder[0]);
    });

    test.each(['polygon', 'star', 'flower'])('renders the %s shape directly into the Pen layer', shape => {
        const manager = makeManager();
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.applyProjection = jest.fn();
        manager.runtime.graphicEffectsManager = {setScale: jest.fn()};
        manager.runtime._primitives.pen_stamp = jest.fn();
        const context = {
            beginPath: jest.fn(),
            clearRect: jest.fn(),
            closePath: jest.fn(),
            fill: jest.fn(),
            globalAlpha: 1,
            lineTo: jest.fn(),
            moveTo: jest.fn()
        };
        const canvas = {
            getContext: jest.fn(() => context)
        };
        const originalDocument = global.document;
        global.document = {createElement: jest.fn(() => canvas)};
        const target = {
            drawableID: 1,
            id: 'target',
            isStage: false,
            setSize: jest.fn(),
            visible: false
        };

        try {
            expect(manager.drawShape(target, {
                height: 80,
                n: 5,
                position: {x: 10, y: 20, z: 480},
                radius: {inner: 25, outer: 50},
                rotation: {x: 0, y: 0, z: 0},
                scale: {x: 1, y: 1, z: 1},
                shape,
                width: 120,
                color: '#ff0000',
                opacity: 65
            })).toBeUndefined();
        } finally {
            global.document = originalDocument;
        }

        expect(canvas.width).toBe(120);
        expect(canvas.height).toBe(80);
        expect(context.beginPath).toHaveBeenCalledTimes(1);
        expect(context.fill).toHaveBeenCalledWith('evenodd');
        expect(context.globalAlpha).toBe(0.65);
        expect(context.fillStyle).toBe('#ff0000');
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledWith({}, {target});
        expect(manager.getTargetState(target).penOnly).toBe(true);
    });

    test('keeps the inner radius hollow and lets the outer radius change the stamped size', () => {
        const manager = makeManager();
        manager.runtime._primitives.pen_stamp = jest.fn();
        const context = {
            beginPath: jest.fn(),
            clearRect: jest.fn(),
            closePath: jest.fn(),
            fill: jest.fn(),
            lineTo: jest.fn(),
            moveTo: jest.fn()
        };
        const canvas = {getContext: jest.fn(() => context)};
        const originalDocument = global.document;
        global.document = {createElement: jest.fn(() => canvas)};
        const target = {
            drawableID: 1,
            id: 'target',
            isStage: false,
            visible: false
        };

        try {
            manager.drawShape(target, {
                height: 100,
                n: 6,
                radius: {inner: 50, outer: 150},
                shape: 'polygon',
                width: 100
            });
        } finally {
            global.document = originalDocument;
        }

        expect(canvas.width).toBe(150);
        expect(canvas.height).toBe(150);
        expect(context.moveTo).toHaveBeenCalledTimes(2);
        expect(context.closePath).toHaveBeenCalledTimes(2);
        expect(context.fill).toHaveBeenCalledWith('evenodd');
    });

    test.each(['arc', 'circular segment'])('renders the %s angle range directly into the Pen layer', shape => {
        const manager = makeManager();
        manager.runtime._primitives.pen_stamp = jest.fn();
        const context = {
            arc: jest.fn(),
            beginPath: jest.fn(),
            clearRect: jest.fn(),
            closePath: jest.fn(),
            fill: jest.fn(),
            lineTo: jest.fn(),
            moveTo: jest.fn()
        };
        const canvas = {getContext: jest.fn(() => context)};
        const originalDocument = global.document;
        global.document = {createElement: jest.fn(() => canvas)};
        const target = {
            drawableID: 1,
            id: 'target',
            isStage: false,
            visible: false
        };

        try {
            manager.drawShape(target, {
                angle: {start: 30, end: 270},
                height: 100,
                radius: {inner: 20, outer: 80},
                shape,
                width: 100
            });
        } finally {
            global.document = originalDocument;
        }

        expect(context.arc).toHaveBeenCalled();
        expect(context.arc.mock.calls[0].slice(3)).toEqual([
            (30 - 90) * Math.PI / 180,
            (270 - 90) * Math.PI / 180,
            false
        ]);
        expect(context.fill).toHaveBeenCalledWith('evenodd');
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledWith({}, {target});
    });

    test('renders a line between its two positions with the requested thickness', () => {
        const manager = makeManager();
        manager.runtime._primitives.pen_stamp = jest.fn();
        const context = {
            beginPath: jest.fn(),
            clearRect: jest.fn(),
            lineTo: jest.fn(),
            moveTo: jest.fn(),
            stroke: jest.fn()
        };
        const canvas = {getContext: jest.fn(() => context)};
        const originalDocument = global.document;
        global.document = {createElement: jest.fn(() => canvas)};
        const target = {
            drawableID: 1,
            id: 'target',
            isStage: false,
            visible: false
        };

        try {
            manager.drawShape(target, {
                position1: {x: 10, y: 20, z: 30},
                position2: {x: 110, y: 80, z: 30},
                shape: 'line',
                thickness: 6
            });
        } finally {
            global.document = originalDocument;
        }

        expect(canvas.width).toBe(106);
        expect(canvas.height).toBe(66);
        expect(context.stroke).toHaveBeenCalledTimes(1);
        expect(context.lineWidth).toBe(6);
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledWith({}, {target});
    });

    test.each([
        [0.99, false],
        [1, true],
        [2, true],
        [4, true],
        [4.01, false]
    ])('draws only inside the inclusive object time range at %s seconds', (currentTime, expectedDraw) => {
        const manager = makeManager();
        manager.timeline = {currentTime};
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.applyProjection = jest.fn();
        manager.runtime._primitives.pen_stamp = jest.fn();
        const target = {
            getCostumeIndexByName: jest.fn(() => 0),
            isStage: false,
            setCostume: jest.fn(),
            setSize: jest.fn()
        };

        expect(manager.drawObject(target, {
            asset: 'costume1',
            source: 'costume',
            time: {start: 1, end: 4}
        })).toBeUndefined();

        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledTimes(expectedDraw ? 1 : 0);
        expect(manager.setTargetPosition).toHaveBeenCalledTimes(expectedDraw ? 1 : 0);
    });

    test('reapplies Z perspective after draw dimensions update the drawable scale', () => {
        const manager = makeManager();
        const target = makeTarget();
        target.x = 0;
        target.y = 0;
        target._getRenderedDirectionAndScale = jest.fn(() => ({
            direction: 90,
            scale: [target.size, target.size]
        }));
        target.getCostumeIndexByName = jest.fn(() => 0);
        target.setCostume = jest.fn();
        target.setSize = jest.fn(size => {
            target.size = size;
        });
        manager.runtime.graphicEffectsManager = {
            setScale: jest.fn(() => {
                // This is the normal 2D drawable update which used to be left in place by Objects.draw.
                manager.runtime.renderer.updateDrawableDirectionScale(target.drawableID, 90, [100, 100]);
            })
        };
        manager.runtime._primitives.pen_stamp = jest.fn();

        const configuration = {
            asset: 'costume1',
            height: 100,
            position: {x: 0, y: 0, z: 1000},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
            size: 100,
            source: 'costume',
            width: 100
        };

        manager.drawObject(target, configuration);

        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenLastCalledWith(
            target.drawableID,
            90,
            [48, 48]
        );
        expect(manager.runtime.renderer.updateDrawableDirectionScale.mock.invocationCallOrder.at(-1))
            .toBeLessThan(manager.runtime._primitives.pen_stamp.mock.invocationCallOrder[0]);
        expect(manager.runtime.movieZBuffer).toEqual({
            flatDepth: 1000,
            targetId: target.id,
            version: 1
        });
        expect(manager.getTargetState(target).zBuffer).toBe(manager.runtime.movieZBuffer);

        manager.drawObject(target, {
            ...configuration,
            position: {x: 0, y: 0, z: 10000}
        });

        expect(manager.runtime.renderer.updateDrawableDirectionScale).toHaveBeenLastCalledWith(
            target.drawableID,
            90,
            [4.8, 4.8]
        );
    });

    test('decodes and stamps every layered video draw with its own frame and size', async () => {
        const manager = makeManager();
        const target = makeTarget();
        target.visible = true;
        target.setSize = jest.fn();
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.applyProjection = jest.fn();
        manager.publishFlatZBuffer = jest.fn();
        manager.runtime.graphicEffectsManager = {setScale: jest.fn()};
        manager.runtime._primitives.pen_stamp = jest.fn();
        const video = {assetId: 'video', duration: 10, frameRate: 30, name: 'clip'};
        const frames = [{name: 'frame 4'}, {name: 'frame 8'}];
        manager.videos.set(target.id, [video]);
        manager.decodeObjectVideoFrame = jest.fn()
            .mockResolvedValueOnce(frames[0])
            .mockResolvedValueOnce(frames[1]);

        const first = manager.drawObject(target, {
            asset: 'clip',
            frame: 4,
            height: 100,
            position: {x: 0, y: 0, z: 480},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
            size: 100,
            source: 'video',
            width: 100
        });
        const second = manager.drawObject(target, {
            asset: 'clip',
            frame: 8,
            height: 50,
            position: {x: 20, y: 10, z: 480},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
            size: 50,
            source: 'video',
            width: 50
        });

        expect(second).toBe(first);
        await first;

        expect(manager.decodeObjectVideoFrame.mock.calls.map(call => call[2])).toEqual([4, 8]);
        expect(manager.runtime.renderer.createBitmapSkin).toHaveBeenNthCalledWith(1, frames[0], 2);
        expect(manager.runtime.renderer.updateBitmapSkin).toHaveBeenNthCalledWith(1, 1, frames[1], 2);
        expect(manager.runtime.graphicEffectsManager.setScale.mock.calls
            .filter(call => call[1] === 'width').map(call => call[2])).toEqual([100, 50]);
        expect(target.setSize.mock.calls.map(call => call[0])).toEqual([100, 50]);
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledTimes(2);
        expect(manager.getTargetState(target).penOnly).toBe(true);
    });

    test('hides an Objects video drawable and restores normal video visibility outside Objects draw', () => {
        const manager = makeManager();
        const target = makeTarget();
        target.visible = true;
        const state = manager.getTargetState(target);
        const video = {assetId: 'video', duration: 10, frameRate: 30};
        state.displayedFrame = 4;
        state.displayedVideoAssetId = video.assetId;
        state.mode = 'video';
        state.penOnly = true;

        manager.applyProjection(target);
        expect(manager.runtime.renderer.updateDrawableVisible).toHaveBeenLastCalledWith(target.drawableID, false);

        manager.queueVideoFrame(target, video, 4);

        expect(state.penOnly).toBe(false);
        expect(manager.runtime.renderer.updateDrawableVisible).toHaveBeenLastCalledWith(target.drawableID, true);
    });

    test('maps Objects video time to a speed-adjusted frame and maximum duration', () => {
        const manager = makeManager();
        const video = {duration: 6, frameRate: 30};
        const configuration = {
            speed: 2,
            time: {start: 1, end: 10},
            videoMode: 'video',
            volume: 60
        };

        expect(manager.getObjectVideoPlayback(video, configuration, 3)).toEqual({
            active: true,
            end: 4,
            frame: 121,
            mediaTime: 4,
            speed: 2,
            start: 1,
            volume: 60
        });
        expect(manager.getObjectVideoPlayback(video, configuration, 4).active).toBe(false);
        expect(manager.getObjectVideoPlayback(video, {
            ...configuration,
            speed: 0.5,
            time: {start: 1, end: 5}
        }, 4).end).toBe(5);
    });

    test('draws the timeline-derived Objects video frame and stops exactly at the playback end', () => {
        const manager = makeManager();
        const target = makeTarget();
        const video = {assetId: 'video', duration: 6, frameRate: 30, name: 'clip'};
        const pending = Promise.resolve();
        manager.timeline = {currentTime: 2, playing: true, recording: false};
        manager.videos.set(target.id, [video]);
        manager.queueObjectDraw = jest.fn(() => pending);
        manager.syncObjectVideoAudio = jest.fn();
        manager.stopObjectVideoAudio = jest.fn();
        const configuration = {
            asset: 'clip',
            playbackId: 'draw-video',
            source: 'video',
            speed: 2,
            time: {start: 1, end: 10},
            videoMode: 'video',
            volume: 60
        };

        expect(manager.drawObject(target, configuration)).toBe(pending);
        expect(manager.queueObjectDraw).toHaveBeenCalledWith(target, expect.objectContaining({frame: 61}));
        expect(manager.syncObjectVideoAudio).toHaveBeenCalledWith(
            target,
            video,
            configuration,
            expect.objectContaining({mediaTime: 2, speed: 2}),
            2
        );

        manager.timeline.currentTime = 4;
        expect(manager.drawObject(target, configuration)).toBeUndefined();
        expect(manager.queueObjectDraw).toHaveBeenCalledTimes(1);
        expect(manager.stopObjectVideoAudio).toHaveBeenCalledWith(target, configuration);
    });

    test('plays Objects video audio with speed-linked pitch, block volume, and addon project volume', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const element = {
            currentTime: 0,
            duration: 8,
            load: jest.fn(),
            muted: true,
            pause: jest.fn(),
            paused: true,
            play: jest.fn(() => {
                element.paused = false;
                return Promise.resolve();
            }),
            playbackRate: 1,
            preservesPitch: true,
            readyState: 1,
            removeAttribute: jest.fn(),
            volume: 1
        };
        const originalDocument = global.document;
        global.document = {createElement: jest.fn(() => element)};
        manager.runtime.audioEngine = {inputNode: {gain: {value: 0.5}}};
        manager.timeline = {playing: true, recording: false};
        try {
            manager.syncObjectVideoAudio(target, {
                assetId: 'video',
                url: 'blob:video'
            }, {
                asset: 'clip',
                playbackId: 'draw-video'
            }, {
                mediaTime: 2,
                speed: 2,
                volume: 60
            }, 2);
            await Promise.resolve();
            await Promise.resolve();

            expect(global.document.createElement).toHaveBeenCalledWith('audio');
            expect(element.currentTime).toBe(2);
            expect(element.playbackRate).toBe(2);
            expect(element.preservesPitch).toBe(false);
            expect(element.volume).toBe(0.3);
            expect(element.play).toHaveBeenCalledTimes(1);
        } finally {
            manager.stopAllObjectVideoAudio();
            global.document = originalDocument;
        }
    });

    test('records Objects video audio once with project volume and a forced export end', async () => {
        const manager = makeManager();
        const target = makeTarget();
        const video = {assetId: 'video', duration: 6};
        const buffer = {duration: 6};
        manager.timeline = {recording: true, renderFrameIndex: 30};
        manager.runtime.audioEngine = {inputNode: {gain: {value: 0.5}}};
        manager.renderingSoundEvents = [];
        manager.playedTimelineSoundBlocks = new Set();
        const configuration = {asset: 'clip', playbackId: 'draw-video'};
        const playback = {end: 2.5, mediaTime: 0, speed: 2, volume: 60};

        manager.recordObjectVideoAudio(target, video, configuration, playback, 1);
        manager.recordObjectVideoAudio(target, video, configuration, playback, 1);

        expect(manager.renderingSoundEvents).toEqual([{
            duration: 1.5,
            frame: 30,
            offset: 0,
            playbackRate: 2,
            video,
            volume: 30
        }]);

        manager.decodeRenderingVideoAudio = jest.fn(() => Promise.resolve({
            buffer,
            context: {},
            ownsContext: false
        }));
        const audio = await manager.decodeRenderingAudio(null, '', 30);
        expect(audio.clips).toEqual([{
            buffer,
            duration: 1.5,
            offset: 0,
            pan: 0,
            playbackRate: 2,
            startTime: 1,
            volume: 0.3
        }]);
    });

    test('uses the draw frame for an animated model', async () => {
        const manager = makeManager();
        const target = makeTarget();
        target.setSize = jest.fn();
        manager.setTargetPosition = jest.fn();
        manager.setTargetRotation = jest.fn();
        manager.setTargetScale = jest.fn();
        manager.applyProjection = jest.fn();
        manager.runtime._primitives.pen_stamp = jest.fn();
        manager.models.set(target.id, [{assetId: 'model', name: 'Hero'}]);
        manager.replaceModelScene = jest.fn(() => Promise.resolve());

        const draw = manager.drawObject(target, {
            asset: 'Hero',
            frame: 17,
            position: {},
            rotation: {},
            scale: {},
            source: 'model'
        });
        await draw;

        expect(manager.getTargetState(target).modelFrame).toBe(17);
        expect(manager.replaceModelScene).toHaveBeenCalledWith(target, 'Hero');
        expect(manager.runtime._primitives.pen_stamp).toHaveBeenCalledTimes(1);
    });

    test('waits for an exact video frame before a following stamp can run', () => {
        const manager = makeManager();
        const target = makeTarget();
        const videoRender = deferred();
        manager.renderVideo = jest.fn(() => videoRender.promise);
        manager.installPrimitives();

        const renderResult = manager.runtime._primitives.looks_rendervideo({
            FRAME: 18,
            VIDEO: 'clip'
        }, {target});

        expect(renderResult).toBe(videoRender.promise);
        expect(manager.renderVideo).toHaveBeenCalledWith(target, 'clip', 18);
    });

    test('captures a timeline frame only after video decoding and the following stamp resume', async () => {
        const manager = makeTimelineManager();
        const videoRender = deferred();
        manager.addRenderingFrame = jest.fn();
        manager.timeline.playing = true;
        manager.timeline.recording = true;
        manager.timeline.renderFrameIndex = 0;
        manager.timeline.renderedThisStep = true;
        manager.trackBlockingVideoRender(videoRender.promise);

        manager.handleTimelineAfterExecute();

        expect(manager.addRenderingFrame).not.toHaveBeenCalled();
        expect(manager.timeline.waitingForVideo).toBe(true);
        expect(manager.timeline.renderFrameIndex).toBe(0);

        videoRender.resolve();
        await Promise.resolve();
        manager.handleTimelineBeforeExecute();
        manager.handleTimelineAfterExecute();

        expect(manager.runtime.startHats).not.toHaveBeenCalled();
        expect(manager.addRenderingFrame).toHaveBeenCalledTimes(1);
        expect(manager.timeline.renderFrameIndex).toBe(1);
    });

    test.each(['interpreter', 'compiled'])(
        'commits an atomic Pen frame after %s erase-all execution',
        executionPath => {
            const manager = makeTimelineManager();
            const penFX = {
                beginFrame: jest.fn(() => true),
                cancelFrame: jest.fn(),
                commitFrame: jest.fn()
            };
            manager.runtime.ext_pen = {clear: jest.fn()};
            manager.runtime._primitives.pen_clear = jest.fn();
            manager.attachPenFrameTransactions(penFX);
            manager.timeline.renderedThisStep = true;

            const result = executionPath === 'interpreter' ?
                manager.runtime._primitives.pen_clear({}, {}) : manager.runtime.ext_pen.clear();

            expect(result).toBeUndefined();
            expect(penFX.beginFrame).toHaveBeenCalledTimes(1);
            expect(penFX.commitFrame).not.toHaveBeenCalled();

            manager.handleTimelineAfterExecute();

            expect(penFX.commitFrame).toHaveBeenCalledTimes(1);
            expect(penFX.cancelFrame).not.toHaveBeenCalled();
        }
    );

    test.each(['interpreter', 'compiled'])(
        'redraws the default backdrop as Pen without yielding after %s erase-all execution',
        executionPath => {
            const manager = makeTimelineManager();
            manager.runtime.targets = [{
                currentCostume: 0,
                isStage: true,
                sprite: {
                    costumes: [{assetId: 'cd21514d0531fdffb22204e0ec5ed84a'}]
                }
            }];
            manager.runtime.renderer._backgroundColor4f = [1, 1, 1, 1];
            manager.runtime.renderer.setBackgroundColor = jest.fn();
            manager.runtime.ext_pen = {clear: jest.fn()};
            manager.runtime._primitives.pen_clear = jest.fn();
            const penFX = {
                beginFrame: jest.fn(() => true),
                drawDefaultBackground: jest.fn()
            };
            manager.attachPenFrameTransactions(penFX);
            penFX.drawDefaultBackground.mockClear();
            manager.runtime.renderer.setBackgroundColor.mockClear();
            manager.timeline.renderedThisStep = true;

            const result = executionPath === 'interpreter' ?
                manager.runtime._primitives.pen_clear({}, {}) : manager.runtime.ext_pen.clear();

            expect(result).toBeUndefined();
            expect(penFX.beginFrame).toHaveBeenCalledTimes(1);
            expect(manager.runtime.renderer.setBackgroundColor).toHaveBeenCalledWith(0, 0, 0, 0);
            expect(penFX.drawDefaultBackground).toHaveBeenCalledWith([1, 1, 1, 1]);
        }
    );

    test('renders the requested video and frame as one operation', () => {
        const manager = makeManager();
        const target = makeTarget();
        const video = {assetId: 'video', name: 'clip'};
        const videoRender = Promise.resolve();
        manager.videos.set(target.id, [video]);
        manager.queueVideoFrame = jest.fn(() => videoRender);

        expect(manager.renderVideo(target, 'clip', 24)).toBe(videoRender);
        expect(manager.queueVideoFrame).toHaveBeenCalledWith(target, video, 24);
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
