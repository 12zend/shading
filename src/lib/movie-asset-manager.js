import EventEmitter from 'events';
import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';

import {
    MOVIE_3D_BLOCKS,
    MOVIE_3D_REPORTER_BLOCKS,
    MOVIE_ASSET_BLOCKS,
    markMovieProject
} from './project-format';
import {
    DEFAULT_DEPTH,
    DEFAULT_FOV,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    ROTATION_ORDERS,
    ModelRenderer,
    attachMotionToGLB,
    cameraLookAt,
    convertModelToGLB,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    normalizeFOV,
    projectPosition
} from './model-runtime';
import downloadBlob from './download-blob';

const VIDEO_FRAME_RATE = 30;
const BITMAP_RESOLUTION = 2;
const RENDERING_DEFAULT_FRAME_RATE = 30;
const RENDERING_MAX_FRAME_RATE = 120;
const RENDERING_FILE_NAME = 'rendering.mp4';
const TIMELINE_DEFAULT_DURATION = 10;
const TIMELINE_MAX_DURATION = 3600;
const VIDEO_PROJECT_KEY = 'movieVideos';
const MODEL_PROJECT_KEY = 'movieModels';
const CAMERA_PROJECT_KEY = 'movieCamera';
const TRANSFORM_PROJECT_KEY = 'movie3D';
const TIMELINE_PROJECT_KEY = 'movieTimeline';
const MIME_TYPES = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    webm: 'video/webm'
};

const MP4_VIDEO_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1.4D401E',
    'video/mp4'
];

const MP4_AUDIO_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4'
];

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const now = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() : Date.now()
);

const copyArrayBuffer = data => {
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return data;
};

const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
});

const once = (element, successEvent, errorEvent = 'error') => new Promise((resolve, reject) => {
    const cleanup = () => {
        // eslint-disable-next-line no-use-before-define
        element.removeEventListener(successEvent, handleSuccess);
        // eslint-disable-next-line no-use-before-define
        element.removeEventListener(errorEvent, handleError);
    };
    const handleSuccess = () => {
        cleanup();
        resolve();
    };
    const handleError = () => {
        cleanup();
        reject(element.error || new Error('Could not decode the media file.'));
    };
    element.addEventListener(successEvent, handleSuccess);
    element.addEventListener(errorEvent, handleError);
});

const getVideoMetadata = async url => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    await once(video, 'loadedmetadata');
    const metadata = {
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight
    };
    video.removeAttribute('src');
    video.load();
    return metadata;
};

const getExtension = fileName => {
    const parts = fileName.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
};

const getName = fileName => fileName.replace(/\.[^.]+$/, '') || 'video';

const MODEL_TEXTURE_FORMATS = ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'spa', 'sph', 'tga', 'webp'];

const getUploadPath = file => String(file.webkitRelativePath || file.name).replace(/\\/g, '/');

const getModelResourcePath = (file, modelFile) => {
    const path = getUploadPath(file);
    const modelPath = getUploadPath(modelFile);
    const separator = modelPath.lastIndexOf('/');
    if (separator < 0) return path;
    const modelDirectory = modelPath.slice(0, separator + 1);
    return path.toLowerCase().startsWith(modelDirectory.toLowerCase()) ?
        path.slice(modelDirectory.length) : path;
};

const unusedName = (requestedName, usedNames) => {
    const base = requestedName || 'video';
    const lowerNames = usedNames.map(name => name.toLowerCase());
    if (!lowerNames.includes(base.toLowerCase())) return base;
    let index = 2;
    while (lowerNames.includes(`${base}${index}`.toLowerCase())) index++;
    return `${base}${index}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getOriginalTarget = target => {
    if (!target || target.isOriginal || !target.sprite || !target.sprite.clones) return target;
    return target.sprite.clones.find(clone => clone.isOriginal) || target;
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const normalizeRotationOrder = value => {
    const order = String(value || '').toUpperCase();
    return ROTATION_ORDERS.includes(order) ? order : 'XYZ';
};

const normalizeScale = (value, fallback = 1) => Math.max(0, toNumber(value, fallback));

const cloneScale = scale => ({
    x: normalizeScale(scale && scale.x),
    y: normalizeScale(scale && scale.y),
    z: normalizeScale(scale && scale.z)
});

const cloneCamera = camera => ({
    fov: camera.fov,
    focalLength: camera.focalLength,
    position: {...camera.position},
    rotation: {...camera.rotation},
    rotationOrder: camera.rotationOrder
});

class MovieAssetManager extends EventEmitter {
    constructor (vm) {
        super();
        this.vm = vm;
        this.runtime = vm.runtime;
        this.videos = new Map();
        this.models = new Map();
        this.targetStates = new Map();
        this.fontFaces = new Map();
        this.modelObjects = new Map();
        this.renderingFrames = [];
        this.renderingSoundEvents = [];
        this.playedTimelineSoundBlocks = new Set();
        this.timelineSoundSources = new Set();
        this.previewRendererSize = null;
        this.modelRenderer = null;
        const [stageWidth, stageHeight] = this.getStageSize();
        this.timeline = {
            currentTime: 0,
            duration: TIMELINE_DEFAULT_DURATION,
            framerate: RENDERING_DEFAULT_FRAME_RATE,
            height: stageHeight,
            pendingFrame: true,
            playing: false,
            recording: false,
            sound: '',
            width: stageWidth
        };
        this.camera = {
            fov: DEFAULT_FOV,
            focalLength: focalLengthFromFOV(DEFAULT_FOV, stageWidth, stageHeight),
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };

        this.handleTargetCreated = this.handleTargetCreated.bind(this);
        this.handleTargetRemoved = this.handleTargetRemoved.bind(this);
        this.handleFontsChanged = this.handleFontsChanged.bind(this);
        this.handleNativeSizeChanged = this.handleNativeSizeChanged.bind(this);
        this.handleTimelineBeforeExecute = this.handleTimelineBeforeExecute.bind(this);
        this.handleTimelineAfterExecute = this.handleTimelineAfterExecute.bind(this);
        this.ensureMainTarget = this.ensureMainTarget.bind(this);

        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.fontManager.on('change', this.handleFontsChanged);
        this.runtime.on('BEFORE_EXECUTE', this.handleTimelineBeforeExecute);
        this.runtime.on('AFTER_EXECUTE', this.handleTimelineAfterExecute);
        this.runtime.on('PROJECT_LOADED', this.ensureMainTarget);
        if (this.runtime.renderer && typeof this.runtime.renderer.on === 'function') {
            this.runtime.renderer.on('NativeSizeChanged', this.handleNativeSizeChanged);
        }
        this.runtime.targets.forEach(target => this.patchTarget(target));

        this.installPrimitives();
        this.installSerializationHooks();
        this.syncFontFaces();
        this.installTimelineHat();
        this.ensureMainTarget();
    }

    installTimelineHat () {
        this.runtime._hats.event_renderframe = {
            restartExistingThreads: true
        };
    }

    ensureMainTarget () {
        const sprites = this.runtime.targets.filter(target => target.isOriginal && !target.isStage);
        if (!sprites.length) return;
        const target = sprites.find(sprite => sprite.getName() === 'main') || sprites[0];
        if (target.getName() !== 'main') this.vm.renameSprite(target.id, 'main');
        if (!this.vm.editingTarget || this.vm.editingTarget.isStage) this.vm.setEditingTarget(target.id);
    }

    installPrimitives () {
        const primitives = this.runtime._primitives;
        // Media decoding is asynchronous, but Looks blocks must not pause the VM while a frame is decoded.
        // Keep decoding in the background and coalesce rapid frame changes in queueVideoFrame().
        primitives.looks_switchvideoto = (args, util) => {
            this.runWithoutWaiting(this.switchVideo(util.target, args.VIDEO));
        };
        primitives.looks_setvideoframeto = (args, util) => {
            this.runWithoutWaiting(this.setVideoFrame(util.target, args.FRAME));
        };
        primitives.looks_changevideoframeby = (args, util) => {
            this.runWithoutWaiting(this.changeVideoFrame(util.target, args.FRAME));
        };
        primitives.looks_settextfont = (args, util) => {
            this.setText(util.target, args.FONT, args.TEXT);
        };
        // Queue the empty scene without displaying it before a following render model block.
        primitives.looks_clearscene = (args, util) => {
            this.runWithoutWaiting(this.clearModelScene(util.target));
        };
        // The next block may consume the rendered skin (for example, pen stamp), so wait for the model frame.
        primitives.looks_rendermodel = (args, util) => this.renderModelToScene(util.target, args.MODEL);
        // Frame selection itself is synchronous. Rendering can continue in the background so a render-frame hat
        // is not restarted before it reaches a following render-model block.
        primitives.looks_setmodelframeto = (args, util) => {
            this.runWithoutWaiting(this.setModelFrame(util.target, args.FRAME));
        };
        // Keep old projects working. The legacy switch block replaces the scene instead of accumulating into it.
        primitives.looks_switchmodelto = (args, util) => this.replaceModelScene(util.target, args.MODEL);
        primitives.looks_addrenderingframe = () => this.addRenderingFrame();
        primitives.looks_clearrenderingframe = () => this.clearRenderingFrames();
        primitives.looks_exportrenderingmp4 = (args, util) => this.exportRenderingMp4(
            util && util.target,
            args && args.SOUND,
            args && args.FRAMERATE
        );
        const stopAllSounds = primitives.sound_stopallsounds;
        primitives.sound_stopallsounds = (args, util) => {
            this.stopTimelineSounds();
            if (typeof stopAllSounds === 'function') return stopAllSounds(args, util);
        };
        // Keep the frame-based block loadable for projects created before the time-based block replaced it.
        primitives.sound_playatframe = (args, util) => this.playSoundAtFrame(args, util);
        primitives.sound_playattime = (args, util) => this.playSoundAtTime(args, util);

        const goToXYZ = (args, util) => this.setTargetPosition(
            util.target,
            args.X,
            args.Y,
            typeof args.Z === 'undefined' ? this.getTargetState(util.target).worldZ : args.Z
        );
        primitives.motion_gotoxy = goToXYZ;
        primitives.motion_gotoxyz = goToXYZ;
        primitives.motion_gotoxyz_nocamera = (args, util) => this.setTargetPositionWithoutCamera(
            util.target,
            args.X,
            args.Y,
            typeof args.Z === 'undefined' ? this.getTargetState(util.target).worldZ : args.Z
        );
        primitives.motion_changexby = (args, util) => this.changeTargetPosition(util.target, 'x', args.DX);
        primitives.motion_setx = (args, util) => this.setTargetAxis(util.target, 'x', args.X);
        primitives.motion_changeyby = (args, util) => this.changeTargetPosition(util.target, 'y', args.DY);
        primitives.motion_sety = (args, util) => this.setTargetAxis(util.target, 'y', args.Y);
        primitives.motion_changezby = (args, util) => this.changeTargetPosition(util.target, 'z', args.DZ);
        primitives.motion_setz = (args, util) => this.setTargetAxis(util.target, 'z', args.Z);
        primitives.motion_setrotation = (args, util) => this.setTargetRotation(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_setscale = (args, util) => this.setTargetScale(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_changerotationby = (args, util) => this.changeTargetRotation(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_setrotationorder = (args, util) => this.setTargetRotationOrder(util.target, args.ORDER);
        primitives.motion_setcamerato = args => this.setCameraPosition(args.X, args.Y, args.Z);
        primitives.motion_setcamerax = args => this.setCameraAxis('x', args.X);
        primitives.motion_changecameraxby = args => this.changeCameraAxis('x', args.X);
        primitives.motion_setcameray = args => this.setCameraAxis('y', args.Y);
        primitives.motion_changecamerayby = args => this.changeCameraAxis('y', args.Y);
        primitives.motion_setcameraz = args => this.setCameraAxis('z', args.Z);
        primitives.motion_changecamerazby = args => this.changeCameraAxis('z', args.Z);
        primitives.motion_setcamerarotation = args => this.setCameraRotation(args.X, args.Y, args.Z);
        primitives.motion_changecamerarotationby = args => this.changeCameraRotation(args.X, args.Y, args.Z);
        primitives.motion_setcamerarotationorder = args => this.setCameraRotationOrder(args.ORDER);
        primitives.motion_lookat = args => this.lookAt(args);
        primitives.motion_setfov = args => this.setFOV(args.FOV);

        primitives.motion_zposition = (args, util) => this.getTargetState(util.target).worldZ;
        primitives.motion_rotationx = (args, util) => this.getTargetState(util.target).rotation.x;
        primitives.motion_rotationy = (args, util) => this.getTargetState(util.target).rotation.y;
        primitives.motion_rotationz = (args, util) => this.getTargetState(util.target).rotation.z;
        primitives.motion_rotationorder = (args, util) => this.getTargetState(util.target).rotationOrder;
        primitives.motion_camerax = () => this.camera.position.x;
        primitives.motion_cameray = () => this.camera.position.y;
        primitives.motion_cameraz = () => this.camera.position.z;
        primitives.motion_camerarotationx = () => this.camera.rotation.x;
        primitives.motion_camerarotationy = () => this.camera.rotation.y;
        primitives.motion_camerarotationz = () => this.camera.rotation.z;
        primitives.motion_camerarotationorder = () => this.camera.rotationOrder;
        primitives.motion_fov = () => this.camera.fov;
        primitives.motion_focallength = () => this.camera.focalLength;

        for (const opcode of MOVIE_ASSET_BLOCKS.concat(MOVIE_3D_BLOCKS)) {
            if (!compatBlocks.stacked.includes(opcode)) compatBlocks.stacked.push(opcode);
        }
        for (const opcode of MOVIE_3D_REPORTER_BLOCKS) {
            if (!compatBlocks.inputs.includes(opcode)) compatBlocks.inputs.push(opcode);
        }
    }

    runWithoutWaiting (promise) {
        if (!promise || typeof promise.catch !== 'function') return;
        promise.catch(error => this.emit('renderError', error));
    }

    installSerializationHooks () {
        const originalToJSON = this.vm.toJSON.bind(this.vm);
        this.vm.toJSON = (targetId, serializationOptions) => {
            const json = JSON.parse(originalToJSON(targetId, serializationOptions));
            const videos = this.serializeJSON(targetId);
            if (videos.length) json[VIDEO_PROJECT_KEY] = videos;
            const models = this.serializeModelsJSON(targetId);
            if (models.length) json[MODEL_PROJECT_KEY] = models;
            if (!this.isDefaultCamera()) json[CAMERA_PROJECT_KEY] = cloneCamera(this.camera);
            json[TIMELINE_PROJECT_KEY] = this.serializeTimeline();
            this.serializeTransforms(json, targetId);
            return JSON.stringify(markMovieProject(json));
        };

        const originalSerializeAssets = this.vm.serializeAssets.bind(this.vm);
        this.vm.serializeAssets = targetId => originalSerializeAssets(targetId).concat(
            this.serializeAssets(targetId),
            this.serializeModelAssets(targetId)
        );

        const originalDeserializeProject = this.vm.deserializeProject.bind(this.vm);
        this.vm.deserializeProject = async (projectJSON, zip) => {
            this.clearRenderingFrames();
            const videoPromise = this.deserializeVideos(projectJSON[VIDEO_PROJECT_KEY], zip);
            const modelPromise = this.deserializeModels(projectJSON[MODEL_PROJECT_KEY], zip);
            const transformDescriptors = this.readTransformDescriptors(projectJSON);
            const cameraDescriptor = projectJSON[CAMERA_PROJECT_KEY];
            const timelineDescriptor = projectJSON[TIMELINE_PROJECT_KEY];
            const result = await originalDeserializeProject(projectJSON, zip);
            this.replaceVideos(await videoPromise);
            this.replaceModels(await modelPromise);
            await this.preloadModels();
            this.restoreCamera(cameraDescriptor);
            this.restoreTimeline(timelineDescriptor);
            this.runtime.targets.forEach(target => this.patchTarget(target));
            this.restoreTransforms(transformDescriptors);
            this.applyCamera();
            this.ensureMainTarget();
            return result;
        };
    }

    serializeTimeline () {
        return {
            duration: this.timeline.duration,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    }

    restoreTimeline (descriptor) {
        const [stageWidth, stageHeight] = this.getStageSize();
        const hasSettings = descriptor && typeof descriptor === 'object';
        const settings = hasSettings ? descriptor : {};
        const currentFramerate = this.runtime.frameLoop && this.runtime.frameLoop.framerate;
        this.timeline.currentTime = 0;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.framerate = this.normalizeRenderingFramerate(
            hasSettings ? settings.framerate : currentFramerate
        );
        this.timeline.height = Math.max(1, Math.round(toNumber(settings.height, stageHeight)));
        this.timeline.pendingFrame = true;
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.timeline.sound = String(settings.sound || '');
        this.timeline.width = Math.max(1, Math.round(toNumber(settings.width, stageWidth)));
        this.setTimelineClock(0, true);
        if (hasSettings) {
            this.vm.setFramerate(this.timeline.framerate);
        }
        this.emitTimelineChanged();
    }

    normalizeTimelineDuration (value) {
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0) return TIMELINE_DEFAULT_DURATION;
        return Math.min(TIMELINE_MAX_DURATION, Math.max(0.1, duration));
    }

    getTimelineState () {
        return {
            currentTime: this.timeline.currentTime,
            duration: this.timeline.duration,
            frameCount: Array.isArray(this.renderingFrames) ? this.renderingFrames.length : 0,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            playing: this.timeline.playing,
            recording: this.timeline.recording,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    }

    emitTimelineChanged () {
        this.emit('timelineChanged', this.getTimelineState());
    }

    setTimelineClock (seconds, paused) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        const clock = this.runtime.ioDevices.clock;
        this.runtime.updateCurrentMSecs();
        clock._projectTimer.startTime = this.runtime.currentMSecs - (time * 1000);
        clock._pausedTime = time * 1000;
        clock._paused = Boolean(paused);
        this.timeline.currentTime = time;
    }

    playTimeline () {
        if (this.timeline.currentTime >= this.timeline.duration) this.timeline.currentTime = 0;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(this.timeline.currentTime, false);
        this.timeline.pendingFrame = true;
        this.timeline.playing = true;
        this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    }

    pauseTimeline () {
        const clock = this.runtime.ioDevices.clock;
        if (this.timeline.playing) {
            this.timeline.currentTime = clamp(clock.projectTimer(), 0, this.timeline.duration);
        }
        this.timeline.playing = false;
        this.setTimelineClock(this.timeline.currentTime, true);
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.emitTimelineChanged();
    }

    stopTimeline () {
        const cancelledRendering = this.timeline.recording;
        this.playedTimelineSoundBlocks.clear();
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.setTimelineClock(0, true);
        this.timeline.pendingFrame = true;
        this.emitTimelineChanged();
        if (cancelledRendering) this.emit('timelineRenderCancelled');
    }

    seekTimeline (seconds) {
        const wasPlaying = this.timeline.playing;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(seconds, !wasPlaying);
        this.timeline.pendingFrame = true;
        if (wasPlaying) this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    }

    updateTimelineSettings (settings) {
        const previousDuration = this.timeline.duration;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.framerate = this.normalizeRenderingFramerate(settings.framerate);
        this.timeline.height = Math.max(1, Math.min(4096, Math.round(toNumber(settings.height, this.timeline.height))));
        if (Object.prototype.hasOwnProperty.call(settings, 'sound')) {
            this.timeline.sound = String(settings.sound || '');
        }
        this.timeline.width = Math.max(1, Math.min(4096, Math.round(toNumber(settings.width, this.timeline.width))));
        this.vm.setFramerate(this.timeline.framerate);
        if (this.timeline.currentTime > this.timeline.duration || previousDuration !== this.timeline.duration) {
            this.seekTimeline(Math.min(this.timeline.currentTime, this.timeline.duration));
        } else {
            this.timeline.pendingFrame = true;
            this.emitTimelineChanged();
        }
        this.runtime.emitProjectChanged();
    }

    renderTimeline () {
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.clearRenderingFrames();
        this.resizeRendererForTimeline();
        this.timeline.currentTime = 0;
        this.timeline.pendingFrame = true;
        this.timeline.playing = true;
        this.timeline.recording = true;
        this.timeline.renderFrameIndex = 0;
        this.setTimelineClock(0, false);
        this.emitTimelineChanged();
    }

    getRendererPixelRatio () {
        return typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0 ?
            Number(window.devicePixelRatio) : 1;
    }

    resizeRendererForTimeline () {
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas || typeof renderer.resize !== 'function') return;
        if (!this.previewRendererSize) {
            this.previewRendererSize = {
                height: renderer.canvas.height,
                width: renderer.canvas.width
            };
        }
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(this.timeline.width / pixelRatio, this.timeline.height / pixelRatio);
    }

    restorePreviewRendererSize () {
        const renderer = this.runtime.renderer;
        const size = this.previewRendererSize;
        this.previewRendererSize = null;
        if (!size || !renderer || typeof renderer.resize !== 'function') return;
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(size.width / pixelRatio, size.height / pixelRatio);
    }

    renderAndExportTimeline () {
        let cancelled = false;
        let renderErrorEmitted = false;
        const rendering = new Promise((resolve, reject) => {
            const cleanup = () => {
                // eslint-disable-next-line no-use-before-define
                this.removeListener('timelineRenderComplete', handleComplete);
                // eslint-disable-next-line no-use-before-define
                this.removeListener('timelineRenderCancelled', handleCancelled);
                // eslint-disable-next-line no-use-before-define
                this.removeListener('renderError', handleRenderError);
            };
            const handleComplete = () => {
                cleanup();
                resolve();
            };
            const handleCancelled = () => {
                cancelled = true;
                cleanup();
                reject(new Error('Rendering was stopped before the MP4 export completed.'));
            };
            const handleRenderError = error => {
                renderErrorEmitted = true;
                cleanup();
                reject(error);
            };

            this.once('timelineRenderComplete', handleComplete);
            this.once('timelineRenderCancelled', handleCancelled);
            this.once('renderError', handleRenderError);
            try {
                this.renderTimeline();
            } catch (error) {
                this.restorePreviewRendererSize();
                cleanup();
                reject(error);
            }
        });

        return rendering
            .then(() => this.exportTimeline())
            .catch(error => {
                if (!cancelled && !renderErrorEmitted) this.emit('renderError', error);
                throw error;
            });
    }

    getRenderFrameSounds () {
        const selections = [];
        const seen = new Set();
        for (const target of this.runtime.targets) {
            if (!target || !target.isOriginal || !target.blocks || !target.sprite) continue;
            const scriptIds = typeof target.blocks.getScripts === 'function' ? target.blocks.getScripts() : [];
            for (const scriptId of scriptIds) {
                const block = typeof target.blocks.getBlock === 'function' ? target.blocks.getBlock(scriptId) : null;
                if (!block || block.opcode !== 'event_renderframe') continue;
                const field = block.fields && block.fields.SOUND_MENU;
                const soundName = Array.isArray(field) ? field[0] :
                    (field && typeof field === 'object' ? field.value : field);
                const sound = this.getRenderingSound(target, soundName);
                if (!sound || !sound.soundId) continue;
                const key = `${target.id}:${sound.soundId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                selections.push({sound, target});
            }
        }
        return selections;
    }

    playSoundAtFrame (args, util) {
        if (!this.timeline.playing || !util || !util.target) return;
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        const requestedFrame = Math.max(0, Math.round(toNumber(args && args.FRAME)));
        const currentFrame = this.timeline.recording ?
            this.timeline.renderFrameIndex :
            Math.round(this.timeline.currentTime * this.timeline.framerate);
        if (currentFrame !== requestedFrame) return;

        const sound = this.getRenderingSound(util.target, args && args.SOUND_MENU);
        if (!sound) return;
        const blockId = util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : `${sound.name}:${requestedFrame}`;
        const key = `${util.target.id}:${blockId}:${requestedFrame}`;
        if (this.playedTimelineSoundBlocks.has(key)) return;
        this.playedTimelineSoundBlocks.add(key);

        if (this.timeline.recording) {
            this.renderingSoundEvents.push({
                frame: requestedFrame,
                pan: toNumber(util.target.soundEffects && util.target.soundEffects.pan),
                pitch: toNumber(util.target.soundEffects && util.target.soundEffects.pitch),
                sound,
                target: util.target,
                volume: clamp(toNumber(util.target.volume, 100), 0, 100)
            });
            return;
        }
        const playSound = this.runtime._primitives.sound_play;
        if (typeof playSound === 'function') playSound({SOUND_MENU: sound.name}, util);
    }

    playSoundAtTime (args, util) {
        if (!util || !util.target) return;
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();

        const thread = util.thread;
        const blocks = thread && (thread.blockContainer || util.target.blocks);
        const topBlock = blocks && typeof blocks.getBlock === 'function' ? blocks.getBlock(thread.topBlock) : null;
        // Scrubbing a paused timeline evaluates render-frame scripts to refresh the stage. Keep that visual
        // preview silent while still allowing this block to be clicked and auditioned directly.
        if (!this.timeline.playing && topBlock && topBlock.opcode === 'event_renderframe') return;

        const sound = this.getRenderingSound(util.target, args && args.SOUND_MENU);
        if (!sound) return;
        const requestedTime = Math.max(0, toNumber(args && args.TIME));
        const blockId = util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : `${sound.name}:${requestedTime}`;

        // A render-frame script runs again on every frame. During timeline playback, let each block start once
        // so the sound can continue in real time instead of being restarted on every VM step.
        if (this.timeline.playing) {
            const key = `${util.target.id}:${blockId}`;
            if (this.playedTimelineSoundBlocks.has(key)) return;
            this.playedTimelineSoundBlocks.add(key);
        }

        if (this.timeline.recording) {
            this.renderingSoundEvents.push({
                frame: this.timeline.renderFrameIndex,
                offset: requestedTime,
                pan: toNumber(util.target.soundEffects && util.target.soundEffects.pan),
                pitch: toNumber(util.target.soundEffects && util.target.soundEffects.pitch),
                sound,
                target: util.target,
                volume: clamp(toNumber(util.target.volume, 100), 0, 100)
            });
            return;
        }
        this.startSoundAtTime(util.target, sound, requestedTime);
    }

    startSoundAtTime (target, sound, seconds) {
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
            soundBank.getSoundPlayer(sound.soundId) : null;
        const buffer = player && player.buffer;
        if (!context || typeof context.createBufferSource !== 'function' || !buffer) return;

        const offset = Math.max(0, toNumber(seconds));
        if (Number.isFinite(buffer.duration) && offset >= buffer.duration) return;
        if (!(this.timelineSoundSources instanceof Set)) this.timelineSoundSources = new Set();

        const source = context.createBufferSource();
        const nodes = [source];
        source.buffer = buffer;
        source.playbackRate.value = Math.pow(2, toNumber(target.soundEffects && target.soundEffects.pitch) / 120);
        let output = source;

        if (typeof context.createStereoPanner === 'function') {
            const panNode = context.createStereoPanner();
            panNode.pan.value = clamp(toNumber(target.soundEffects && target.soundEffects.pan), -100, 100) / 100;
            output.connect(panNode);
            output = panNode;
            nodes.push(panNode);
        }
        if (typeof context.createGain === 'function') {
            const gainNode = context.createGain();
            gainNode.gain.value = clamp(toNumber(target.volume, 100), 0, 100) / 100;
            output.connect(gainNode);
            output = gainNode;
            nodes.push(gainNode);
        }
        output.connect(typeof audioEngine.getInputNode === 'function' ?
            audioEngine.getInputNode() : audioEngine.inputNode);

        const playback = {nodes, source};
        source.onended = () => {
            this.timelineSoundSources.delete(playback);
            nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        };
        this.timelineSoundSources.add(playback);
        source.start(0, offset);
    }

    playTimelineSounds (seconds) {
        if (this.timeline.recording) return;
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        if (!context || typeof context.createBufferSource !== 'function') return;
        if (!(this.timelineSoundSources instanceof Set)) this.timelineSoundSources = new Set();

        for (const {sound, target} of this.getRenderFrameSounds()) {
            const soundBank = target.sprite.soundBank;
            const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
                soundBank.getSoundPlayer(sound.soundId) : null;
            const buffer = player && player.buffer;
            if (!buffer) continue;

            const pitch = toNumber(target.soundEffects && target.soundEffects.pitch);
            const playbackRate = Math.pow(2, pitch / 120);
            const offset = Math.max(0, toNumber(seconds) * playbackRate);
            if (Number.isFinite(buffer.duration) && offset >= buffer.duration) continue;

            const source = context.createBufferSource();
            const nodes = [source];
            source.buffer = buffer;
            source.playbackRate.value = playbackRate;
            let output = source;

            if (typeof context.createStereoPanner === 'function') {
                const panNode = context.createStereoPanner();
                panNode.pan.value = clamp(toNumber(target.soundEffects && target.soundEffects.pan), -100, 100) / 100;
                output.connect(panNode);
                output = panNode;
                nodes.push(panNode);
            }
            if (typeof context.createGain === 'function') {
                const gainNode = context.createGain();
                gainNode.gain.value = clamp(toNumber(target.volume, 100), 0, 100) / 100;
                output.connect(gainNode);
                output = gainNode;
                nodes.push(gainNode);
            }
            output.connect(typeof audioEngine.getInputNode === 'function' ?
                audioEngine.getInputNode() : audioEngine.inputNode);

            const playback = {nodes, source};
            source.onended = () => {
                this.timelineSoundSources.delete(playback);
                nodes.forEach(node => {
                    if (typeof node.disconnect === 'function') node.disconnect();
                });
            };
            this.timelineSoundSources.add(playback);
            source.start(0, offset);
        }
    }

    stopTimelineSounds () {
        if (!(this.timelineSoundSources instanceof Set)) {
            this.timelineSoundSources = new Set();
            return;
        }
        for (const playback of this.timelineSoundSources) {
            playback.source.onended = null;
            try {
                playback.source.stop(0);
            } catch (error) {
                // The source may already have ended between timeline ticks.
            }
            playback.nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        }
        this.timelineSoundSources.clear();
    }

    getTimelineSounds () {
        const target = this.runtime.targets.find(item => item.isOriginal && !item.isStage);
        return target && target.sprite && Array.isArray(target.sprite.sounds) ?
            target.sprite.sounds.map(sound => sound.name) : [];
    }

    exportTimeline () {
        const target = this.runtime.targets.find(item => item.isOriginal && !item.isStage);
        return this.exportRenderingMp4(target, this.timeline.sound, this.timeline.framerate);
    }

    handleTimelineBeforeExecute () {
        if (!this.timeline.playing && !this.timeline.pendingFrame) return;
        if (this.timeline.recording) {
            this.setTimelineClock(
                Math.min(this.timeline.renderFrameIndex / this.timeline.framerate, this.timeline.duration),
                false
            );
        } else if (this.timeline.playing) {
            const time = this.runtime.ioDevices.clock.projectTimer();
            this.timeline.currentTime = clamp(time, 0, this.timeline.duration);
            if (time >= this.timeline.duration) this.setTimelineClock(this.timeline.duration, false);
        }
        this.timeline.pendingFrame = false;
        this.timeline.renderedThisStep = true;
        this.runtime.startHats('event_renderframe');
    }

    handleTimelineAfterExecute () {
        if (!this.timeline.renderedThisStep) return;
        this.timeline.renderedThisStep = false;
        if (this.timeline.recording) {
            try {
                this.addRenderingFrame();
            } catch (error) {
                this.timeline.recording = false;
                this.timeline.playing = false;
                this.restorePreviewRendererSize();
                this.setTimelineClock(this.timeline.currentTime, true);
                this.runtime.stopAll();
                this.emit('renderError', error);
            }
            if (this.timeline.recording && this.timeline.currentTime < this.timeline.duration) {
                this.timeline.renderFrameIndex++;
            }
        } else if (this.timeline.playing) {
            this.timeline.currentTime = clamp(
                this.runtime.ioDevices.clock.projectTimer(),
                0,
                this.timeline.duration
            );
        }
        this.emitTimelineChanged();
        if (this.timeline.playing && this.timeline.currentTime >= this.timeline.duration) {
            const completedRendering = this.timeline.recording;
            this.timeline.recording = false;
            this.pauseTimeline();
            if (completedRendering) this.emit('timelineRenderComplete', this.getTimelineState());
        }
    }

    patchTarget (target) {
        if (!target || target.__movieAssetsPatched) return;
        target.__movieAssetsPatched = true;

        const originalSetCostume = target.setCostume.bind(target);
        const originalSetSize = target.setSize.bind(target);
        const originalSetVisible = target.setVisible.bind(target);
        target.setCostume = index => {
            const result = originalSetCostume(index);
            this.showCostume(target, false);
            return result;
        };
        target.setXY = (x, y, force) => this.setTargetXY(target, x, y, force);
        target.setDirection = direction => this.setLegacyDirection(target, direction);
        target.setSize = size => {
            const result = originalSetSize(size);
            this.applyProjection(target);
            this.rerenderTargetModel(target);
            return result;
        };
        target.setVisible = visible => {
            const result = originalSetVisible(visible);
            this.applyProjection(target);
            return result;
        };

        const originalUpdateAll = target.updateAllDrawableProperties.bind(target);
        target.updateAllDrawableProperties = () => {
            const result = originalUpdateAll();
            this.restoreCustomSkin(target);
            this.applyProjection(target);
            return result;
        };
    }

    handleTargetCreated (target) {
        this.patchTarget(target);
        if (!target.isOriginal && target.sprite && target.sprite.clones) {
            const source = target.sprite.clones.find(clone => clone !== target && this.targetStates.has(clone.id));
            if (source) {
                const sourceState = this.getTargetState(source);
                const state = this.getTargetState(target);
                state.worldX = sourceState.worldX;
                state.worldY = sourceState.worldY;
                state.worldZ = sourceState.worldZ;
                state.rotation = {...sourceState.rotation};
                state.scale = cloneScale(sourceState.scale);
                state.rotationOrder = sourceState.rotationOrder;
                state.ignoreCamera = sourceState.ignoreCamera;
                state.modelAssetId = sourceState.modelAssetId;
                state.modelFrame = sourceState.modelFrame;
                state.modelScene = sourceState.modelScene.map(item => ({
                    assetId: item.assetId,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                }));
                if (sourceState.mode === 'model') {
                    state.requestedMode = 'model';
                    this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            }
        }
        this.applyProjection(target);
    }

    handleTargetRemoved (target) {
        this.destroyTargetState(target);
    }

    handleFontsChanged () {
        this.syncFontFaces();
        this.emit('fontsChanged');
    }

    getVideos (targetOrId) {
        const target = typeof targetOrId === 'string' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original ? original.id : targetOrId;
        return this.videos.get(targetId) || [];
    }

    getModels (targetOrId) {
        const target = typeof targetOrId === 'string' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original ? original.id : targetOrId;
        return this.models.get(targetId) || [];
    }

    async addModelsFromFiles (targetId, files) {
        const supportedFiles = files.filter(file => ['glb', 'pmx', 'fbx', 'obj', 'mtl'].includes(
            getExtension(file.name)
        ));
        const textureFiles = files.filter(file => MODEL_TEXTURE_FORMATS.includes(getExtension(file.name)));
        const textureData = new Map();
        const readTexture = file => {
            if (!textureData.has(file)) textureData.set(file, readFile(file));
            return textureData.get(file);
        };
        const materialFiles = supportedFiles.filter(file => getExtension(file.name) === 'mtl');
        const sourceFiles = supportedFiles.filter(file => getExtension(file.name) !== 'mtl');
        if (!sourceFiles.length) {
            throw new Error('Choose a GLB, PMX, FBX, or OBJ file. MTL files accompany OBJ files.');
        }

        const added = [];
        for (const file of sourceFiles) {
            const sourceFormat = getExtension(file.name);
            const data = await readFile(file);
            let mtlData = null;
            if (sourceFormat === 'obj') {
                const baseName = getName(file.name).toLowerCase();
                const materialFile = materialFiles.find(item => getName(item.name).toLowerCase() === baseName) ||
                    (materialFiles.length === 1 ? materialFiles[0] : null);
                if (materialFile) mtlData = await readFile(materialFile);
            }
            const textures = sourceFormat === 'pmx' ? await Promise.all(textureFiles.map(async textureFile => ({
                data: await readTexture(textureFile),
                path: getModelResourcePath(textureFile, file),
                type: textureFile.type
            }))) : [];
            const converted = await convertModelToGLB(sourceFormat, data, mtlData, textures);
            const storage = this.runtime.storage;
            const asset = storage.createAsset(
                storage.AssetType.Sound,
                'glb',
                converted.glb,
                null,
                true
            );
            const models = this.getModels(targetId).slice();
            const model = {
                activeMotion: converted.activeMotion,
                animationCount: converted.animationCount,
                asset,
                assetId: asset.assetId,
                dataFormat: 'glb',
                modelFormat: sourceFormat,
                motions: converted.motions,
                name: unusedName(getName(file.name), models.map(item => item.name)),
                originalSize: converted.originalSize,
                sourceFormat,
                triangles: converted.triangles,
                vertices: converted.vertices
            };
            models.push(model);
            this.models.set(targetId, models);
            this.changedModels(targetId);
            added.push(model);
        }
        return added;
    }

    async addModelMotionsFromFiles (targetId, modelIndex, files) {
        const models = this.getModels(targetId).slice();
        let model = models[modelIndex];
        if (!model) throw new Error('Select a model before importing a motion or pose.');
        const motionFiles = files.filter(file => ['vmd', 'vpd'].includes(getExtension(file.name)));
        if (!motionFiles.length) throw new Error('Choose a VMD motion or VPD pose file.');

        for (const file of motionFiles) {
            const format = getExtension(file.name);
            const motionData = await readFile(file);
            const converted = await attachMotionToGLB(model.asset.data, motionData, format, getName(file.name));
            const oldAssetId = model.assetId;
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                'glb',
                converted.glb,
                null,
                true
            );
            const cached = this.modelObjects.get(oldAssetId);
            if (cached && cached.object) disposeObject(cached.object);
            this.modelObjects.delete(oldAssetId);
            model = {
                ...model,
                activeMotion: converted.activeMotion,
                animationCount: converted.animationCount,
                asset,
                assetId: asset.assetId,
                motions: (model.motions || []).concat(converted.motion)
            };
            for (const target of this.runtime.targets) {
                const original = getOriginalTarget(target);
                const state = this.targetStates.get(target.id);
                if (!original || original.id !== targetId || !state) continue;
                state.modelScene.forEach(item => {
                    if (item.assetId === oldAssetId) item.assetId = asset.assetId;
                });
                if (state.modelAssetId === oldAssetId) state.modelAssetId = asset.assetId;
            }
            models[modelIndex] = model;
        }
        this.models.set(targetId, models);
        this.changedModels(targetId);
        this.rerenderModelTargets(targetId);
        return model;
    }

    selectModelMotion (targetId, modelIndex, requestedMotion) {
        const models = this.getModels(targetId).slice();
        const model = models[modelIndex];
        if (!model) return;
        const motions = model.motions || [];
        const motion = motions.find(item => item.name === requestedMotion);
        models[modelIndex] = {
            ...model,
            activeMotion: motion ? motion.name : ''
        };
        this.models.set(targetId, models);
        this.changedModels(targetId);
        this.rerenderModelTargets(targetId);
    }

    rerenderModelTargets (targetId) {
        for (const target of this.runtime.targets) {
            const original = getOriginalTarget(target);
            const state = this.targetStates.get(target.id);
            if (original && original.id === targetId && state && state.mode === 'model') {
                this.runWithoutWaiting(this.queueModelSceneRender(target));
            }
        }
    }

    deleteModel (targetId, index) {
        const models = this.getModels(targetId).slice();
        const [removed] = models.splice(index, 1);
        if (!removed) return;
        this.models.set(targetId, models);
        const cached = this.modelObjects.get(removed.assetId);
        if (cached && cached.object) disposeObject(cached.object);
        this.modelObjects.delete(removed.assetId);
        for (const target of this.runtime.targets) {
            const original = getOriginalTarget(target);
            const state = this.targetStates.get(target.id);
            if (original && original.id === targetId && state) {
                const nextScene = state.modelScene.filter(item => item.assetId !== removed.assetId);
                if (nextScene.length !== state.modelScene.length) {
                    state.modelScene = nextScene;
                    state.modelAssetId = nextScene.length ? nextScene[nextScene.length - 1].assetId : null;
                    if (state.mode === 'model') this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            }
        }
        this.changedModels(targetId);
    }

    renameModel (targetId, index, requestedName) {
        const models = this.getModels(targetId).slice();
        if (!models[index]) return '';
        const usedNames = models.filter((item, itemIndex) => itemIndex !== index).map(item => item.name);
        const newName = unusedName(requestedName.trim() || 'model', usedNames);
        models[index].name = newName;
        this.models.set(targetId, models);
        this.changedModels(targetId);
        return newName;
    }

    reorderModel (targetId, oldIndex, newIndex) {
        const models = this.getModels(targetId).slice();
        if (!models[oldIndex]) return;
        const [model] = models.splice(oldIndex, 1);
        models.splice(clamp(newIndex, 0, models.length), 0, model);
        this.models.set(targetId, models);
        this.changedModels(targetId);
    }

    changedModels (targetId) {
        this.emit('modelsChanged', targetId);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    }

    getModelByName (target, requestedModel) {
        const models = this.getModels(target);
        if (!models.length) return null;
        if (typeof requestedModel === 'number' || /^\s*\d+\s*$/.test(String(requestedModel))) {
            return models[clamp(Number(requestedModel) - 1, 0, models.length - 1)];
        }
        return models.find(model => model.name === String(requestedModel)) || models[0];
    }

    getModelObject (model) {
        const cached = this.modelObjects.get(model.assetId);
        if (cached) return cached.promise || cached.object;
        const record = {};
        record.promise = loadGLBObject(model.asset.data)
            .then(object => {
                record.object = object;
                record.promise = null;
                return object;
            })
            .catch(error => {
                this.modelObjects.delete(model.assetId);
                throw error;
            });
        this.modelObjects.set(model.assetId, record);
        return record.promise;
    }

    preloadModels () {
        const models = Array.from(this.models.values()).reduce((all, items) => all.concat(items), []);
        return Promise.all(models.map(model => this.getModelObject(model)));
    }

    captureRenderingFrame () {
        if (typeof document === 'undefined') {
            throw new Error('Rendering frames are only available in a browser.');
        }
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas) {
            throw new Error('The stage renderer is not ready.');
        }
        if (this.timeline.recording) this.resizeRendererForTimeline();
        if (typeof renderer.draw === 'function') renderer.draw();

        const [stageWidth, stageHeight] = this.getStageSize();
        const width = Math.max(1, Number(renderer.canvas.width) || stageWidth);
        const height = Math.max(1, Number(renderer.canvas.height) || stageHeight);
        const frame = document.createElement('canvas');
        frame.width = width;
        frame.height = height;
        const context = frame.getContext('2d');
        if (!context) throw new Error('Could not create a rendering frame.');
        context.drawImage(renderer.canvas, 0, 0, width, height);
        frame.reusable = false;
        return frame;
    }

    addRenderingFrame () {
        if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
        const frame = this.captureRenderingFrame();
        this.renderingFrames.push(frame);
        this.emit('renderingFramesChanged', this.renderingFrames.length);
        return frame;
    }

    clearRenderingFrames () {
        if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
        this.renderingFrames.length = 0;
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        this.renderingSoundEvents.length = 0;
        this.emit('renderingFramesChanged', 0);
    }

    getRenderingSound (target, requestedSound) {
        const name = String(requestedSound || '');
        if (!name) return null;
        const sounds = target && target.sprite && target.sprite.sounds;
        return Array.isArray(sounds) ? sounds.find(sound => sound && sound.name === name) || null : null;
    }

    async decodeRenderingSound (sound, preferredAudio) {
        const data = sound && sound.asset && sound.asset.data;
        if (!data) return null;

        const audioEngine = this.runtime.audioEngine;
        if (audioEngine && typeof audioEngine.decodeSoundPlayer === 'function') {
            const player = await audioEngine.decodeSoundPlayer({data: data});
            if (player && player.buffer) {
                return {
                    buffer: player.buffer,
                    context: audioEngine.audioContext,
                    ownsContext: false
                };
            }
        }

        let context = preferredAudio && preferredAudio.context;
        if (!context) context = audioEngine && audioEngine.audioContext;
        let ownsContext = false;
        if (!context && typeof window !== 'undefined') {
            const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
            if (AudioContextConstructor) {
                context = new AudioContextConstructor();
                ownsContext = true;
            }
        }
        if (!context || typeof context.decodeAudioData !== 'function') {
            throw new Error('Audio export is not supported in this browser.');
        }
        const buffer = await context.decodeAudioData(copyArrayBuffer(data));
        return {buffer, context, ownsContext};
    }

    async decodeRenderingAudio (target, requestedSound, framerate) {
        const clips = [];
        const legacySound = this.getRenderingSound(target, requestedSound);
        if (requestedSound && !legacySound) {
            throw new Error('The selected rendering sound could not be found.');
        }
        if (legacySound) {
            clips.push({
                frame: 0,
                pan: 0,
                pitch: 0,
                sound: legacySound,
                volume: 100
            });
        }
        for (const event of this.renderingSoundEvents || []) clips.push(event);
        if (!clips.length) return null;

        let sharedAudio = null;
        const decodedClips = [];
        for (const clip of clips) {
            const decoded = await this.decodeRenderingSound(clip.sound, sharedAudio);
            if (!decoded || !decoded.buffer) continue;
            if (!sharedAudio) sharedAudio = decoded;
            decodedClips.push({
                buffer: decoded.buffer,
                offset: Math.max(0, toNumber(clip.offset)),
                pan: clamp(toNumber(clip.pan), -100, 100) / 100,
                playbackRate: Math.pow(2, toNumber(clip.pitch) / 120),
                startTime: Math.max(0, toNumber(clip.frame) / framerate),
                volume: clamp(toNumber(clip.volume, 100), 0, 100) / 100
            });
        }
        if (!sharedAudio || !decodedClips.length) return null;
        return {
            clips: decodedClips,
            context: sharedAudio.context,
            ownsContext: sharedAudio.ownsContext
        };
    }

    normalizeRenderingFramerate (value) {
        const framerate = Number(value);
        if (!Number.isFinite(framerate) || framerate <= 0) return RENDERING_DEFAULT_FRAME_RATE;
        return Math.min(RENDERING_MAX_FRAME_RATE, Math.max(1, framerate));
    }

    getRenderingMp4MimeType (includeAudio) {
        if (typeof MediaRecorder === 'undefined') {
            throw new Error('This browser does not support MP4 rendering.');
        }
        const candidates = includeAudio ? MP4_AUDIO_MIME_TYPES : MP4_VIDEO_MIME_TYPES;
        if (typeof MediaRecorder.isTypeSupported !== 'function') return candidates[candidates.length - 1];
        for (const candidate of candidates) {
            try {
                if (MediaRecorder.isTypeSupported(candidate)) return candidate;
            } catch (error) {
                // Some browsers throw when they see a codec they do not recognize.
            }
        }
        throw new Error('This browser cannot encode MP4 with MediaRecorder.');
    }

    async encodeRenderingFrames (frames, framerate, audio) {
        if (typeof document === 'undefined' || typeof MediaStream === 'undefined') {
            throw new Error('Rendering export is only available in a browser.');
        }
        const firstFrame = frames[0];
        const [stageWidth, stageHeight] = this.getStageSize();
        const width = Math.max(1, Number(firstFrame.width) || stageWidth);
        const height = Math.max(1, Number(firstFrame.height) || stageHeight);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the rendering export canvas.');

        const drawFrame = frame => {
            context.clearRect(0, 0, width, height);
            context.drawImage(frame, 0, 0, width, height);
        };
        drawFrame(firstFrame);
        if (typeof canvas.captureStream !== 'function') {
            throw new Error('This browser cannot capture rendering frames.');
        }

        const videoStream = canvas.captureStream(framerate);
        const videoTrack = videoStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('Could not create a video stream for the rendering.');
        const recordingStream = new MediaStream();
        recordingStream.addTrack(videoTrack);

        const audioSources = [];
        let audioDestination = null;
        if (audio) {
            if (!audio.context || typeof audio.context.createMediaStreamDestination !== 'function') {
                throw new Error('This browser cannot add audio to the rendering.');
            }
            audioDestination = audio.context.createMediaStreamDestination();
            for (const clip of audio.clips) {
                const source = audio.context.createBufferSource();
                const nodes = [source];
                source.buffer = clip.buffer;
                source.playbackRate.value = clip.playbackRate;
                let output = source;
                if (typeof audio.context.createStereoPanner === 'function') {
                    const panNode = audio.context.createStereoPanner();
                    panNode.pan.value = clip.pan;
                    output.connect(panNode);
                    output = panNode;
                    nodes.push(panNode);
                }
                if (typeof audio.context.createGain === 'function') {
                    const gainNode = audio.context.createGain();
                    gainNode.gain.value = clip.volume;
                    output.connect(gainNode);
                    output = gainNode;
                    nodes.push(gainNode);
                }
                output.connect(audioDestination);
                audioSources.push({nodes, offset: clip.offset, source, startTime: clip.startTime});
            }
            const audioTrack = audioDestination.stream.getAudioTracks()[0];
            if (!audioTrack) throw new Error('Could not create an audio stream for the rendering.');
            recordingStream.addTrack(audioTrack);
        }

        const mimeType = this.getRenderingMp4MimeType(Boolean(audio));
        const recorder = new MediaRecorder(recordingStream, {mimeType});
        const chunks = [];
        let recordingError = null;
        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            for (const audioSource of audioSources) {
                try {
                    audioSource.source.stop();
                } catch (error) {
                    // The source may not have started if recording setup failed.
                }
                audioSource.nodes.forEach(node => {
                    if (typeof node.disconnect === 'function') node.disconnect();
                });
            }
            if (audioDestination && typeof audioDestination.disconnect === 'function') {
                audioDestination.disconnect();
            }
            recordingStream.getTracks().forEach(track => track.stop());
            if (audio && audio.ownsContext && audio.context && typeof audio.context.close === 'function') {
                const closePromise = audio.context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
        };

        let resolveRecording;
        let rejectRecording;
        const recordingPromise = new Promise((resolve, reject) => {
            resolveRecording = resolve;
            rejectRecording = reject;
        });
        const finishRecording = error => {
            if (finished) return;
            cleanup();
            if (error) {
                rejectRecording(error);
            } else {
                resolveRecording(new Blob(chunks, {type: mimeType}));
            }
        };
        const failRecording = error => {
            recordingError = error instanceof Error ? error : new Error(String(error));
            if (recorder.state === 'inactive') {
                finishRecording(recordingError);
                return;
            }
            try {
                recorder.stop();
            } catch (stopError) {
                finishRecording(recordingError);
            }
        };

        recorder.ondataavailable = event => {
            if (event.data && event.data.size !== 0) chunks.push(event.data);
        };
        recorder.onerror = event => failRecording(
            (event && event.error) || new Error('The MP4 renderer encountered an error.')
        );
        recorder.onstop = () => finishRecording(recordingError);

        try {
            if (audio && audio.context && typeof audio.context.resume === 'function') {
                await audio.context.resume();
            }
            recorder.start();
            const audioStartTime = audio && audio.context ? audio.context.currentTime : 0;
            for (const audioSource of audioSources) {
                audioSource.source.start(audioStartTime + audioSource.startTime, audioSource.offset);
            }

            const frameDuration = 1000 / framerate;
            const startTime = now();
            for (let index = 1; index < frames.length; index++) {
                await wait(Math.max(0, startTime + (index * frameDuration) - now()));
                drawFrame(frames[index]);
            }
            await wait(Math.max(0, startTime + (frames.length * frameDuration) - now()));
            if (recorder.state !== 'inactive') recorder.stop();
        } catch (error) {
            failRecording(error);
        }

        return recordingPromise;
    }

    async exportRenderingMp4 (target, requestedSound, requestedFramerate) {
        const frames = Array.isArray(this.renderingFrames) ? this.renderingFrames.slice() : [];
        if (frames.length === 0) {
            throw new Error('Add at least one rendering frame before exporting.');
        }

        const framerate = this.normalizeRenderingFramerate(requestedFramerate);
        const audio = await this.decodeRenderingAudio(target, requestedSound, framerate);
        const blob = await this.encodeRenderingFrames(frames, framerate, audio);
        downloadBlob(RENDERING_FILE_NAME, blob);
        this.emit('renderingExported', {
            blob,
            framerate,
            frameCount: frames.length,
            sound: requestedSound || '',
            soundCount: audio ? audio.clips.length : 0
        });
        return blob;
    }

    getModelTransform (target, state = this.getTargetState(target)) {
        return {
            rotation: {...state.rotation},
            rotationOrder: state.rotationOrder,
            scale: cloneScale(state.scale),
            size: target.size,
            worldX: state.worldX,
            worldY: state.worldY,
            worldZ: state.worldZ
        };
    }

    clearModelScene (target) {
        const state = this.getTargetState(target);
        state.modelAssetId = null;
        state.modelScene = [];
        state.requestedMode = 'model';
        state.pendingVideoFrame = null;
        state.textQueue.length = 0;
        return this.queueModelSceneRender(target);
    }

    renderModelToScene (target, requestedModel) {
        const model = this.getModelByName(target, requestedModel);
        if (!model) return Promise.resolve();
        const state = this.getTargetState(target);
        state.modelAssetId = model.assetId;
        state.modelScene.push({
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        });
        state.requestedMode = 'model';
        state.pendingVideoFrame = null;
        state.textQueue.length = 0;
        return this.queueModelSceneRender(target);
    }

    replaceModelScene (target, requestedModel) {
        const model = this.getModelByName(target, requestedModel);
        if (!model) return Promise.resolve();
        const state = this.getTargetState(target);
        state.modelAssetId = model.assetId;
        state.modelScene = [{
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        }];
        state.requestedMode = 'model';
        state.pendingVideoFrame = null;
        state.textQueue.length = 0;
        return this.queueModelSceneRender(target) || Promise.resolve();
    }

    setModelFrame (target, requestedFrame) {
        const state = this.getTargetState(target);
        const frame = Number(requestedFrame);
        state.modelFrame = Number.isFinite(frame) ? Math.max(1, frame) : 1;
        if (state.requestedMode !== 'model' || !state.modelScene.length) return Promise.resolve();
        return this.queueModelSceneRender(target) || Promise.resolve();
    }

    // Internal compatibility alias used by project restoration and older UI integrations.
    switchModel (target, requestedModel) {
        return this.replaceModelScene(target, requestedModel);
    }

    queueModelSceneRender (target) {
        const state = this.getTargetState(target);
        state.modelRenderVersion++;

        const cachedItems = state.modelScene.map(item => {
            const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
            const record = model && this.modelObjects.get(model.assetId);
            if (!record || !record.object) return null;
            return {
                animationName: model.activeMotion,
                frame: state.modelFrame,
                sourceObject: record.object,
                transform: {
                    ...item.transform,
                    rotation: {...item.transform.rotation},
                    scale: cloneScale(item.transform.scale)
                }
            };
        });
        if (cachedItems.length && cachedItems.every(Boolean) && state.requestedMode === 'model') {
            if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
            const canvas = this.modelRenderer.renderWorldScene(
                cachedItems,
                this.camera,
                this.getStageSize(),
                BITMAP_RESOLUTION
            );
            this.applyBitmap(target, canvas, 'model');
            // The scene is already installed. Do not wait for an older queued clear/render request here, or
            // consecutive render-model blocks would expose an empty pen frame between them.
            return;
        }
        if (state.modelRenderPromise) return state.modelRenderPromise;

        const renderPromise = Promise.resolve().then(async () => {
            while (this.targetStates.get(target.id) === state) {
                const version = state.modelRenderVersion;
                const sceneItems = state.modelScene.map(item => ({
                    assetId: item.assetId,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                }));
                const loadedItems = await Promise.all(sceneItems.map(async item => {
                    const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
                    if (!model) return null;
                    return {
                        animationName: model.activeMotion,
                        frame: state.modelFrame,
                        sourceObject: await this.getModelObject(model),
                        transform: item.transform
                    };
                }));
                if (this.targetStates.get(target.id) !== state || state.requestedMode !== 'model') return;
                if (state.modelRenderVersion !== version) continue;
                if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
                const canvas = this.modelRenderer.renderWorldScene(
                    loadedItems.filter(Boolean),
                    this.camera,
                    this.getStageSize(),
                    BITMAP_RESOLUTION
                );
                this.applyBitmap(target, canvas, 'model');
                return;
            }
        });
        state.modelRenderPromise = renderPromise;
        const finish = () => {
            if (state.modelRenderPromise === renderPromise) state.modelRenderPromise = null;
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    }

    queueModelRender (target, model) {
        const state = this.getTargetState(target);
        state.modelAssetId = model.assetId;
        state.modelScene = [{
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        }];
        state.requestedMode = 'model';
        return this.queueModelSceneRender(target) || Promise.resolve();
    }

    renderModel (target, model) {
        return this.queueModelRender(target, model);
    }

    async renderModelPreview (model, canvas, rotation = {x: -15, y: 30, z: 0}) {
        const object = await this.getModelObject(model);
        const renderer = new ModelRenderer(canvas);
        renderer.render(object, {rotation, rotationOrder: 'XYZ'}, {
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        }, model.activeMotion, 1);
        return renderer;
    }

    async addVideoFromFile (targetId, file) {
        const dataFormat = getExtension(file.name);
        if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, dataFormat)) {
            throw new Error('Supported video formats are MP4, WebM, OGV, and MOV.');
        }
        const data = await readFile(file);
        const storage = this.runtime.storage;
        const asset = storage.createAsset(
            storage.AssetType.Sound,
            dataFormat,
            data,
            null,
            true
        );
        const mimeType = file.type || MIME_TYPES[dataFormat];
        const url = URL.createObjectURL(new Blob([data], {type: mimeType}));
        let metadata;
        try {
            metadata = await getVideoMetadata(url);
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
        const videos = this.getVideos(targetId).slice();
        const video = {
            asset,
            assetId: asset.assetId,
            dataFormat,
            duration: metadata.duration,
            frameRate: VIDEO_FRAME_RATE,
            height: metadata.height,
            mimeType,
            name: unusedName(getName(file.name), videos.map(item => item.name)),
            url,
            width: metadata.width
        };
        videos.push(video);
        this.videos.set(targetId, videos);
        this.changed(targetId);
        return video;
    }

    async addFontFromFile (file) {
        const format = getExtension(file.name);
        if (!['ttf', 'otf', 'woff', 'woff2'].includes(format)) {
            throw new Error('Supported font formats are TTF, OTF, WOFF, and WOFF2.');
        }
        const data = await readFile(file);
        const fontManager = this.runtime.fontManager;
        const name = fontManager.getUnusedCustomFont(getName(file.name));
        const storage = this.runtime.storage;
        const asset = storage.createAsset(
            storage.AssetType.Font,
            format,
            data,
            null,
            true
        );
        fontManager.addCustomFont(name, 'sans-serif', asset);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
        return name;
    }

    deleteFont (index) {
        this.runtime.fontManager.deleteFont(index);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    }

    reorderFont (oldIndex, newIndex) {
        const fonts = this.runtime.fontManager.fonts;
        if (!fonts[oldIndex]) return;
        const [font] = fonts.splice(oldIndex, 1);
        fonts.splice(clamp(newIndex, 0, fonts.length), 0, font);
        this.runtime.fontManager.updateRenderer();
        this.runtime.fontManager.changed();
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    }

    deleteVideo (targetId, index) {
        const videos = this.getVideos(targetId).slice();
        const [removed] = videos.splice(index, 1);
        if (!removed) return;
        this.videos.set(targetId, videos);
        URL.revokeObjectURL(removed.url);
        for (const target of this.runtime.targets) {
            const original = getOriginalTarget(target);
            const state = this.targetStates.get(target.id);
            if (original && original.id === targetId && state && state.videoAssetId === removed.assetId) {
                this.showCostume(target);
                this.destroyTargetState(target);
            }
        }
        this.changed(targetId);
    }

    renameVideo (targetId, index, requestedName) {
        const videos = this.getVideos(targetId).slice();
        if (!videos[index]) return '';
        const usedNames = videos.filter((item, itemIndex) => itemIndex !== index).map(item => item.name);
        const newName = unusedName(requestedName.trim() || 'video', usedNames);
        videos[index].name = newName;
        this.videos.set(targetId, videos);
        this.changed(targetId);
        return newName;
    }

    reorderVideo (targetId, oldIndex, newIndex) {
        const videos = this.getVideos(targetId).slice();
        if (!videos[oldIndex]) return;
        const [video] = videos.splice(oldIndex, 1);
        videos.splice(clamp(newIndex, 0, videos.length), 0, video);
        this.videos.set(targetId, videos);
        this.changed(targetId);
    }

    changed (targetId) {
        this.emit('videosChanged', targetId);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    }

    getVideoByName (target, requestedVideo) {
        const videos = this.getVideos(target);
        if (!videos.length) return null;
        if (typeof requestedVideo === 'number' || /^\s*\d+\s*$/.test(String(requestedVideo))) {
            const index = Number(requestedVideo) - 1;
            return videos[clamp(index, 0, videos.length - 1)];
        }
        return videos.find(video => video.name === String(requestedVideo)) || videos[0];
    }

    getTargetState (target) {
        let state = this.targetStates.get(target.id);
        if (!state) {
            state = {
                currentFrame: 1,
                displayedFrame: null,
                displayedVideoAssetId: null,
                ignoreCamera: false,
                mode: 'costume',
                modelAssetId: null,
                modelFrame: 1,
                modelScene: [],
                modelRenderPromise: null,
                modelRenderVersion: 0,
                pendingVideoFrame: null,
                renderVersion: 0,
                rotation: {x: 0, y: 0, z: 90 - (target.direction || 90)},
                rotationOrder: 'XYZ',
                scale: {x: 1, y: 1, z: 1},
                requestedMode: 'costume',
                skinId: null,
                textQueue: [],
                textRenderPromise: null,
                video: null,
                videoAssetId: null,
                videoElementAssetId: null,
                videoRenderPromise: null,
                worldX: toNumber(target.x),
                worldY: toNumber(target.y),
                worldZ: DEFAULT_DEPTH
            };
            this.targetStates.set(target.id, state);
        }
        return state;
    }

    setTargetXY (target, x, y, force) {
        if (!target || target.isStage || (target.dragging && !force)) return;
        const state = this.getTargetState(target);
        const oldX = target.x;
        const oldY = target.y;
        state.ignoreCamera = false;
        state.worldX = toNumber(x, state.worldX);
        state.worldY = toNumber(y, state.worldY);
        target.x = state.worldX;
        target.y = state.worldY;
        this.applyProjection(target);
        this.rerenderTargetModel(target);
        if (target.onTargetMoved) target.onTargetMoved(target, oldX, oldY, force);
        this.runtime.requestTargetsUpdate(target);
    }

    setTargetPosition (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.ignoreCamera = false;
        state.worldZ = toNumber(z, state.worldZ);
        this.setTargetXY(target, x, y);
    }

    setTargetPositionWithoutCamera (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        const oldX = target.x;
        const oldY = target.y;
        state.ignoreCamera = true;
        state.worldX = toNumber(x, state.worldX);
        state.worldY = toNumber(y, state.worldY);
        state.worldZ = toNumber(z, state.worldZ);
        target.x = state.worldX;
        target.y = state.worldY;
        this.applyProjection(target);
        this.rerenderTargetModel(target);
        if (target.onTargetMoved) target.onTargetMoved(target, oldX, oldY);
        this.runtime.requestTargetsUpdate(target);
    }

    setTargetAxis (target, axis, value) {
        const state = this.getTargetState(target);
        const next = toNumber(value, state[`world${axis.toUpperCase()}`]);
        this.setTargetPosition(
            target,
            axis === 'x' ? next : state.worldX,
            axis === 'y' ? next : state.worldY,
            axis === 'z' ? next : state.worldZ
        );
    }

    changeTargetPosition (target, axis, amount) {
        const state = this.getTargetState(target);
        const key = `world${axis.toUpperCase()}`;
        this.setTargetAxis(target, axis, state[key] + toNumber(amount));
    }

    setLegacyDirection (target, direction) {
        if (!target || target.isStage || !Number.isFinite(Number(direction))) return;
        const normalized = ((((Number(direction) + 179) % 360) + 360) % 360) - 179;
        const state = this.getTargetState(target);
        target.direction = normalized;
        state.rotation.z = 90 - normalized;
        this.refreshTargetRotation(target);
        this.runtime.requestTargetsUpdate(target);
    }

    setTargetRotation (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.rotation.x = toNumber(x, state.rotation.x);
        state.rotation.y = toNumber(y, state.rotation.y);
        state.rotation.z = toNumber(z, state.rotation.z);
        target.direction = 90 - state.rotation.z;
        this.refreshTargetRotation(target);
        this.runtime.requestTargetsUpdate(target);
    }

    setTargetScale (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.scale = {
            x: normalizeScale(x, state.scale.x),
            y: normalizeScale(y, state.scale.y),
            z: normalizeScale(z, state.scale.z)
        };
        this.rerenderTargetModel(target);
        this.runtime.requestTargetsUpdate(target);
    }

    changeTargetRotation (target, x, y, z) {
        const state = this.getTargetState(target);
        this.setTargetRotation(
            target,
            state.rotation.x + toNumber(x),
            state.rotation.y + toNumber(y),
            state.rotation.z + toNumber(z)
        );
    }

    setTargetRotationOrder (target, order) {
        const state = this.getTargetState(target);
        state.rotationOrder = normalizeRotationOrder(order);
        this.refreshTargetRotation(target);
    }

    refreshTargetRotation (target) {
        this.rerenderTargetModel(target);
        this.applyProjection(target);
    }

    rerenderTargetModel (target) {
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model' || !state.modelScene.length) return;
        // A render-model block captures the transform at that point in the script. Do not move models which have
        // already been added to the temporary scene when the sprite transform changes later.
    }

    getStageSize () {
        if (this.runtime.renderer && typeof this.runtime.renderer.getNativeSize === 'function') {
            const size = this.runtime.renderer.getNativeSize();
            if (Array.isArray(size) && size.length >= 2) {
                return [toNumber(size[0], DEFAULT_STAGE_WIDTH), toNumber(size[1], DEFAULT_STAGE_HEIGHT)];
            }
        }
        return [DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT];
    }

    setFOV (value) {
        const [width, height] = this.getStageSize();
        this.camera.fov = normalizeFOV(value);
        this.camera.focalLength = focalLengthFromFOV(this.camera.fov, width, height);
        this.cameraChanged();
    }

    handleNativeSizeChanged (event) {
        const size = event && Array.isArray(event.newSize) ? event.newSize : this.getStageSize();
        if (this.timeline) {
            this.timeline.width = Math.max(1, Math.round(toNumber(size[0], this.timeline.width)));
            this.timeline.height = Math.max(1, Math.round(toNumber(size[1], this.timeline.height)));
            this.emitTimelineChanged();
        }
        this.camera.focalLength = focalLengthFromFOV(this.camera.fov, size[0], size[1]);
        this.applyCamera();
        this.emit('cameraChanged', cloneCamera(this.camera));
    }

    setCameraPosition (x, y, z) {
        this.camera.position.x = toNumber(x, this.camera.position.x);
        this.camera.position.y = toNumber(y, this.camera.position.y);
        this.camera.position.z = toNumber(z, this.camera.position.z);
        this.cameraChanged();
    }

    setCameraAxis (axis, value) {
        this.camera.position[axis] = toNumber(value, this.camera.position[axis]);
        this.cameraChanged();
    }

    changeCameraAxis (axis, amount) {
        this.setCameraAxis(axis, this.camera.position[axis] + toNumber(amount));
    }

    setCameraRotation (x, y, z) {
        this.camera.rotation.x = toNumber(x, this.camera.rotation.x);
        this.camera.rotation.y = toNumber(y, this.camera.rotation.y);
        this.camera.rotation.z = toNumber(z, this.camera.rotation.z);
        this.cameraChanged(true);
    }

    changeCameraRotation (x, y, z) {
        this.setCameraRotation(
            this.camera.rotation.x + toNumber(x),
            this.camera.rotation.y + toNumber(y),
            this.camera.rotation.z + toNumber(z)
        );
    }

    setCameraRotationOrder (order) {
        this.camera.rotationOrder = normalizeRotationOrder(order);
        this.cameraChanged(true);
    }

    lookAt (args) {
        const position = {
            x: toNumber(args.CAMERAX, this.camera.position.x),
            y: toNumber(args.CAMERAY, this.camera.position.y),
            z: toNumber(args.CAMERAZ, this.camera.position.z)
        };
        const target = {
            x: toNumber(args.X),
            y: toNumber(args.Y),
            z: toNumber(args.Z, DEFAULT_DEPTH)
        };
        this.camera.position = position;
        this.camera.rotation = cameraLookAt(position, target, this.camera.rotationOrder);
        this.cameraChanged(true);
    }

    cameraChanged (rerenderModels = true) {
        this.runtime.emitProjectChanged();
        this.applyCamera(rerenderModels);
        this.emit('cameraChanged', cloneCamera(this.camera));
    }

    applyCamera (rerenderModels = true) {
        for (const target of this.runtime.targets) {
            if (target.isStage) continue;
            this.applyProjection(target);
            if (rerenderModels) {
                const state = this.getTargetState(target);
                if (state.mode === 'model') {
                    this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            }
        }
        this.runtime.requestRedraw();
    }

    applyProjection (target) {
        if (!target || target.isStage || !this.runtime.renderer || target.drawableID === null) return;
        if (
            typeof this.runtime.renderer.updateDrawablePosition !== 'function' ||
            typeof this.runtime.renderer.updateDrawableDirectionScale !== 'function' ||
            typeof this.runtime.renderer.updateDrawableVisible !== 'function'
        ) return;
        const state = this.getTargetState(target);
        if (state.mode === 'model') {
            this.runtime.renderer.updateDrawablePosition(target.drawableID, [0, 0]);
            this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, 90, [100, 100]);
            this.runtime.renderer.updateDrawableVisible(target.drawableID, target.visible);
            if (target.visible) {
                target.emitVisualChange();
                this.runtime.requestRedraw();
            }
            return;
        }
        const projection = state.ignoreCamera ? {
            inFront: true,
            perspective: 1,
            x: state.worldX,
            y: state.worldY
        } : projectPosition({
            x: state.worldX,
            y: state.worldY,
            z: state.worldZ
        }, this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        });
        this.runtime.renderer.updateDrawablePosition(target.drawableID, [projection.x, projection.y]);
        const direction = state.mode === 'model' ? 90 : 90 - state.rotation.z;
        const scale = target.size * Math.abs(projection.perspective);
        this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, direction, [scale, scale]);
        this.runtime.renderer.updateDrawableVisible(target.drawableID, target.visible && projection.inFront);
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
    }

    switchVideo (target, requestedVideo) {
        const video = this.getVideoByName(target, requestedVideo);
        if (!video) return;
        return this.queueVideoFrame(target, video, 1);
    }

    setVideoFrame (target, requestedFrame) {
        const state = this.getTargetState(target);
        const videos = this.getVideos(target);
        const video = videos.find(item => item.assetId === state.videoAssetId) || videos[0];
        if (!video) return;
        const frame = Number(requestedFrame);
        return this.queueVideoFrame(target, video, Number.isFinite(frame) ? frame : 1);
    }

    changeVideoFrame (target, change) {
        const state = this.getTargetState(target);
        const amount = Number(change);
        return this.setVideoFrame(target, state.currentFrame + (Number.isFinite(amount) ? amount : 0));
    }

    async prepareVideoElement (state, video) {
        if (state.video && state.videoElementAssetId === video.assetId) return state.video;
        if (state.video) {
            state.video.removeAttribute('src');
            state.video.load();
        }
        const element = document.createElement('video');
        element.muted = true;
        element.preload = 'auto';
        element.src = video.url;
        if (element.readyState < 1) await once(element, 'loadedmetadata');
        element.width = element.videoWidth;
        element.height = element.videoHeight;
        this.commitVideoElement(state, element, video.assetId);
        return element;
    }

    commitVideoElement (state, element, assetId) {
        state.video = element;
        state.videoElementAssetId = assetId;
    }

    queueVideoFrame (target, video, requestedFrame) {
        if (!target || !this.runtime.renderer) return;
        const state = this.getTargetState(target);
        const maximumFrame = video.duration > 0 ?
            Math.max(1, Math.floor(video.duration * video.frameRate) + 1) : Number.MAX_SAFE_INTEGER;
        const frame = Math.round(clamp(requestedFrame, 1, maximumFrame));

        state.currentFrame = frame;
        state.videoAssetId = video.assetId;

        if (
            state.mode === 'video' &&
            state.displayedVideoAssetId === video.assetId &&
            state.displayedFrame === frame &&
            !state.pendingVideoFrame &&
            !state.videoRenderPromise
        ) {
            return Promise.resolve();
        }

        if (state.requestedMode !== 'video') state.renderVersion++;
        state.requestedMode = 'video';
        state.textQueue.length = 0;
        state.pendingVideoFrame = {
            frame,
            renderVersion: state.renderVersion,
            video
        };
        return this.startVideoRender(target, state);
    }

    startVideoRender (target, state) {
        if (state.videoRenderPromise) return state.videoRenderPromise;
        // Start after the VM's current execution burst so several frame changes collapse into one seek.
        const renderPromise = Promise.resolve().then(() => this.renderPendingVideoFrames(target, state));
        state.videoRenderPromise = renderPromise;
        const finish = () => {
            if (state.videoRenderPromise !== renderPromise) return;
            state.videoRenderPromise = null;
            if (state.pendingVideoFrame && this.targetStates.get(target.id) === state) {
                this.runWithoutWaiting(this.startVideoRender(target, state));
            }
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    }

    async renderPendingVideoFrames (target, state) {
        while (state.pendingVideoFrame && this.targetStates.get(target.id) === state) {
            const request = state.pendingVideoFrame;
            state.pendingVideoFrame = null;
            const element = await this.decodeVideoFrame(state, request.video, request.frame);

            // Decoding can be slower than the VM. Skip stale frames instead of building up visible lag.
            if (
                this.targetStates.get(target.id) !== state ||
                state.renderVersion !== request.renderVersion ||
                state.pendingVideoFrame
            ) {
                continue;
            }

            this.applyBitmap(target, element, 'video');
            state.displayedFrame = request.frame;
            state.displayedVideoAssetId = request.video.assetId;
        }
    }

    async decodeVideoFrame (state, video, frame) {
        const element = await this.prepareVideoElement(state, video);
        const time = video.duration > 0 ?
            clamp((frame - 1) / video.frameRate, 0, Math.max(0, video.duration - 0.001)) : 0;

        if (element.readyState < 2) await once(element, 'loadeddata');
        if (Math.abs(element.currentTime - time) > 0.0001) {
            const seeked = once(element, 'seeked');
            element.currentTime = time;
            await seeked;
        }
        return element;
    }

    getFont (requestedFont) {
        const fonts = this.runtime.fontManager.getFonts();
        const requested = String(requestedFont || 'sans-serif');
        return fonts.find(font => font.name.toLowerCase() === requested.toLowerCase()) || {
            family: requested,
            name: requested
        };
    }

    setText (target, requestedFont, requestedText) {
        if (!target || !this.runtime.renderer) return;
        const state = this.getTargetState(target);
        const font = this.getFont(requestedFont);
        const text = String(requestedText);
        if (state.requestedMode !== 'text') state.renderVersion++;
        state.requestedMode = 'text';
        state.pendingVideoFrame = null;

        const fontLoad = this.ensureFontLoaded(font.name);
        if (!fontLoad && !state.textRenderPromise && state.textQueue.length === 0) {
            // Keep loaded-font rendering synchronous. Warp-mode scripts may stamp or otherwise consume each
            // intermediate appearance before the next block changes it.
            this.renderText(target, font, text);
            return;
        }

        state.textQueue.push({
            font,
            fontLoad,
            renderVersion: state.renderVersion,
            text
        });
        this.runWithoutWaiting(this.startTextRender(target, state));
    }

    startTextRender (target, state) {
        if (state.textRenderPromise) return state.textRenderPromise;
        // Font loading is asynchronous. Preserve every queued text appearance instead of collapsing the queue.
        const renderPromise = Promise.resolve().then(() => this.renderPendingText(target, state));
        state.textRenderPromise = renderPromise;
        const finish = () => {
            if (state.textRenderPromise !== renderPromise) return;
            state.textRenderPromise = null;
            if (state.textQueue.length > 0 && this.targetStates.get(target.id) === state) {
                this.runWithoutWaiting(this.startTextRender(target, state));
            }
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    }

    async renderPendingText (target, state) {
        while (state.textQueue.length > 0 && this.targetStates.get(target.id) === state) {
            const request = state.textQueue.shift();
            if (request.fontLoad) await request.fontLoad;

            if (
                this.targetStates.get(target.id) !== state ||
                state.renderVersion !== request.renderVersion ||
                state.requestedMode !== 'text'
            ) {
                continue;
            }

            this.renderText(target, request.font, request.text);
        }
    }

    renderText (target, font, text) {
        const lines = text.split(/\r?\n/);
        const fontSize = 96;
        const padding = 16;
        const lineHeight = Math.round(fontSize * 1.2);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = `${fontSize}px ${font.family}`;
        const width = Math.max(2, ...lines.map(line => Math.ceil(context.measureText(line || ' ').width)));
        canvas.width = Math.min(4096, width + (padding * 2));
        canvas.height = Math.min(4096, Math.max(2, (lineHeight * lines.length) + (padding * 2)));
        context.font = `${fontSize}px ${font.family}`;
        context.fillStyle = '#000000';
        context.textBaseline = 'top';
        lines.forEach((line, index) => context.fillText(line, padding, padding + (index * lineHeight)));
        canvas.reusable = false;
        this.applyBitmap(target, canvas, 'text');
    }

    applyBitmap (target, bitmap, mode, rotationCenter) {
        const state = this.getTargetState(target);
        if (state.skinId === null) {
            state.skinId = typeof rotationCenter === 'undefined' ?
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION) :
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION, rotationCenter);
        } else if (typeof rotationCenter === 'undefined') {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION);
        } else {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION, rotationCenter);
        }
        state.mode = mode;
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, state.skinId);
        this.applyProjection(target);
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
    }

    showCostume (target, updateRenderer = true) {
        const state = this.getTargetState(target);
        state.renderVersion++;
        state.requestedMode = 'costume';
        state.textQueue.length = 0;
        state.pendingVideoFrame = null;
        state.modelRenderVersion++;
        state.modelScene = [];
        state.modelAssetId = null;
        state.mode = 'costume';
        if (updateRenderer && this.runtime.renderer) {
            const costume = target.getCostumes()[target.currentCostume];
            if (costume) this.runtime.renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
            if (target.visible) {
                target.emitVisualChange();
                this.runtime.requestRedraw();
            }
            this.applyProjection(target);
        }
    }

    restoreCustomSkin (target) {
        const state = this.targetStates.get(target.id);
        if (state && state.mode !== 'costume' && state.skinId !== null && this.runtime.renderer) {
            this.runtime.renderer.updateDrawableSkinId(target.drawableID, state.skinId);
        }
        if (state) this.applyProjection(target);
    }

    destroyTargetState (target) {
        const state = this.targetStates.get(target.id);
        if (!state) return;
        state.renderVersion++;
        state.requestedMode = 'costume';
        state.textQueue.length = 0;
        state.pendingVideoFrame = null;
        state.modelRenderVersion++;
        if (state.video) {
            state.video.removeAttribute('src');
            state.video.load();
        }
        if (state.skinId !== null && this.runtime.renderer) {
            this.runtime.renderer.destroySkin(state.skinId);
        }
        this.targetStates.delete(target.id);
    }

    syncFontFaces () {
        if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return;
        const fonts = this.runtime.fontManager.getFonts();
        const activeNames = new Set(fonts.filter(font => font.data).map(font => font.name.toLowerCase()));
        for (const [name, record] of this.fontFaces) {
            if (!activeNames.has(name)) {
                document.fonts.delete(record.face);
                this.fontFaces.delete(name);
            }
        }
        for (const font of fonts) {
            if (!font.data || this.fontFaces.has(font.name.toLowerCase())) continue;
            const start = font.data.byteOffset;
            const end = start + font.data.byteLength;
            const data = font.data.buffer.slice(start, end);
            const face = new FontFace(font.name, data);
            document.fonts.add(face);
            const loadPromise = face.load().catch(() => {});
            this.fontFaces.set(font.name.toLowerCase(), {face, loadPromise});
        }
    }

    ensureFontLoaded (fontName) {
        const record = this.fontFaces.get(fontName.toLowerCase());
        if (record) {
            if (record.face.status === 'loaded' || record.face.status === 'error') return null;
            return record.loadPromise;
        }
        if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return null;
        const descriptor = `96px "${fontName}"`;
        if (document.fonts.check && document.fonts.check(descriptor)) return null;
        return document.fonts.load(descriptor).catch(() => {});
    }

    serializeJSON (targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const result = [];
        for (const [videoTargetId, videos] of this.videos) {
            if (targetId && videoTargetId !== targetId) continue;
            const target = originalTargets.find(item => item.id === videoTargetId);
            if (!target) continue;
            for (const video of videos) {
                result.push({
                    targetId: videoTargetId,
                    targetIndex: originalTargets.indexOf(target),
                    targetName: target.getName(),
                    isStage: target.isStage,
                    name: video.name,
                    md5ext: `${video.assetId}.${video.dataFormat}`,
                    mimeType: video.mimeType,
                    duration: video.duration,
                    width: video.width,
                    height: video.height,
                    frameRate: video.frameRate
                });
            }
        }
        return result;
    }

    serializeAssets (targetId) {
        const seen = new Set();
        return this.serializeJSON(targetId).reduce((result, descriptor) => {
            if (seen.has(descriptor.md5ext)) return result;
            seen.add(descriptor.md5ext);
            const [assetId] = descriptor.md5ext.split('.');
            const videos = Array.from(this.videos.values()).reduce((all, items) => all.concat(items), []);
            const video = videos.find(item => item.assetId === assetId);
            if (video) {
                result.push({fileName: descriptor.md5ext, fileContent: video.asset.data});
            }
            return result;
        }, []);
    }

    async deserializeVideos (descriptors, zip) {
        if (!Array.isArray(descriptors) || !zip) return [];
        const results = [];
        for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.md5ext !== 'string' || typeof descriptor.targetId !== 'string') {
                continue;
            }
            let file = zip.file(descriptor.md5ext);
            if (!file) {
                const pattern = new RegExp(`^([^/]*/)?${escapeRegExp(descriptor.md5ext)}$`);
                file = zip.file(pattern)[0];
            }
            if (!file) continue;
            const data = await file.async('uint8array');
            const dataFormat = getExtension(descriptor.md5ext);
            const assetId = descriptor.md5ext.slice(0, -(dataFormat.length + 1));
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                dataFormat,
                data,
                assetId,
                false
            );
            const mimeType = descriptor.mimeType || MIME_TYPES[dataFormat] || 'video/mp4';
            const url = URL.createObjectURL(new Blob([data], {type: mimeType}));
            results.push({
                isStage: descriptor.isStage === true,
                targetIndex: Number.isInteger(descriptor.targetIndex) ? descriptor.targetIndex : -1,
                targetName: typeof descriptor.targetName === 'string' ? descriptor.targetName : '',
                targetId: descriptor.targetId,
                video: {
                    asset,
                    assetId,
                    dataFormat,
                    duration: Number(descriptor.duration) || 0,
                    frameRate: Number(descriptor.frameRate) || VIDEO_FRAME_RATE,
                    height: Number(descriptor.height) || 0,
                    mimeType,
                    name: String(descriptor.name || 'video'),
                    url,
                    width: Number(descriptor.width) || 0
                }
            });
        }
        return results;
    }

    replaceVideos (entries) {
        for (const videos of this.videos.values()) {
            videos.forEach(video => URL.revokeObjectURL(video.url));
        }
        this.videos.clear();
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const entry of entries) {
            // Scratch target IDs are regenerated whenever a project is loaded. Resolve the
            // saved target by its serialized position, with name/type as a compatibility fallback.
            const indexedTarget = originalTargets[entry.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === entry.isStage ? indexedTarget :
                originalTargets.find(item => item.isStage === entry.isStage && item.getName() === entry.targetName);
            const targetId = target ? target.id : entry.targetId;
            const videos = this.videos.get(targetId) || [];
            videos.push(entry.video);
            this.videos.set(targetId, videos);
        }
        this.emit('videosChanged');
    }

    isDefaultCamera () {
        const [width, height] = this.getStageSize();
        const defaultFocalLength = focalLengthFromFOV(DEFAULT_FOV, width, height);
        return Math.abs(this.camera.fov - DEFAULT_FOV) < 1e-9 &&
            Math.abs(this.camera.focalLength - defaultFocalLength) < 1e-9 &&
            this.camera.position.x === 0 && this.camera.position.y === 0 && this.camera.position.z === 0 &&
            this.camera.rotation.x === 0 && this.camera.rotation.y === 0 && this.camera.rotation.z === 0 &&
            this.camera.rotationOrder === 'XYZ';
    }

    serializeTransforms (json, targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const serializedTargets = Array.isArray(json.targets) ? json.targets : [json];
        const selectedTargets = targetId ? originalTargets.filter(target => target.id === targetId) : originalTargets;
        selectedTargets.forEach((target, index) => {
            if (target.isStage) return;
            const state = this.targetStates.get(target.id);
            if (!state) return;
            const modelScene = state.mode === 'model' ? state.modelScene.map(item => {
                const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
                if (!model) return null;
                return {
                    model: model.name,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                };
            }).filter(Boolean) : [];
            const selectedModel = modelScene.length === 1 ? modelScene[0].model : null;
            const isDefault = state.worldZ === DEFAULT_DEPTH && state.rotation.x === 0 && state.rotation.y === 0 &&
                state.rotationOrder === 'XYZ' && !state.ignoreCamera &&
                normalizeScale(state.scale && state.scale.x) === 1 &&
                normalizeScale(state.scale && state.scale.y) === 1 &&
                normalizeScale(state.scale && state.scale.z) === 1 && !modelScene.length;
            if (isDefault) return;
            const serializedTarget = serializedTargets[index];
            if (!serializedTarget) return;
            serializedTarget[TRANSFORM_PROJECT_KEY] = {
                rotation: {...state.rotation},
                rotationOrder: state.rotationOrder,
                scale: cloneScale(state.scale),
                scene: modelScene,
                ignoreCamera: state.ignoreCamera,
                z: state.worldZ,
                model: selectedModel
            };
        });
    }

    readTransformDescriptors (projectJSON) {
        const targets = Array.isArray(projectJSON.targets) ? projectJSON.targets : [projectJSON];
        return targets.map((target, targetIndex) => ({
            isStage: target.isStage === true,
            targetIndex,
            targetName: String(target.name || ''),
            transform: target[TRANSFORM_PROJECT_KEY]
        })).filter(item => item.transform && typeof item.transform === 'object');
    }

    restoreTransforms (descriptors) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const descriptor of descriptors) {
            const indexedTarget = originalTargets[descriptor.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === descriptor.isStage ? indexedTarget :
                originalTargets.find(item => (
                    item.isStage === descriptor.isStage && item.getName() === descriptor.targetName
                ));
            if (!target || target.isStage) continue;
            const state = this.getTargetState(target);
            const transform = descriptor.transform;
            state.ignoreCamera = transform.ignoreCamera === true;
            state.worldX = target.x;
            state.worldY = target.y;
            state.worldZ = toNumber(transform.z, DEFAULT_DEPTH);
            state.rotation = {
                x: toNumber(transform.rotation && transform.rotation.x),
                y: toNumber(transform.rotation && transform.rotation.y),
                z: toNumber(transform.rotation && transform.rotation.z, 90 - target.direction)
            };
            state.scale = cloneScale(transform.scale);
            state.rotationOrder = normalizeRotationOrder(transform.rotationOrder);
            target.direction = 90 - state.rotation.z;
            this.applyProjection(target);
            if (Array.isArray(transform.scene)) {
                state.modelScene = transform.scene.map(item => {
                    const model = this.getModelByName(target, item && item.model);
                    if (!model) return null;
                    const savedTransform = item.transform || {};
                    return {
                        assetId: model.assetId,
                        transform: {
                            rotation: {
                                x: toNumber(savedTransform.rotation && savedTransform.rotation.x),
                                y: toNumber(savedTransform.rotation && savedTransform.rotation.y),
                                z: toNumber(savedTransform.rotation && savedTransform.rotation.z)
                            },
                            rotationOrder: normalizeRotationOrder(savedTransform.rotationOrder),
                            scale: cloneScale(savedTransform.scale),
                            size: Math.max(0, toNumber(savedTransform.size, 100)),
                            worldX: toNumber(savedTransform.worldX),
                            worldY: toNumber(savedTransform.worldY),
                            worldZ: toNumber(savedTransform.worldZ, DEFAULT_DEPTH)
                        }
                    };
                }).filter(Boolean);
                if (state.modelScene.length) {
                    state.modelAssetId = state.modelScene[state.modelScene.length - 1].assetId;
                    state.requestedMode = 'model';
                    this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            } else if (transform.model) {
                this.runWithoutWaiting(this.switchModel(target, transform.model));
            }
        }
    }

    restoreCamera (descriptor) {
        const [width, height] = this.getStageSize();
        const savedFocalLength = Math.max(
            0.001,
            toNumber(descriptor && descriptor.focalLength, focalLengthFromFOV(DEFAULT_FOV, width, height))
        );
        const fov = descriptor && typeof descriptor.fov !== 'undefined' ?
            normalizeFOV(descriptor.fov) : fovFromFocalLength(savedFocalLength, width, height);
        this.camera = {
            fov,
            focalLength: descriptor && typeof descriptor.fov !== 'undefined' ?
                focalLengthFromFOV(fov, width, height) : savedFocalLength,
            position: {
                x: toNumber(descriptor && descriptor.position && descriptor.position.x),
                y: toNumber(descriptor && descriptor.position && descriptor.position.y),
                z: toNumber(descriptor && descriptor.position && descriptor.position.z)
            },
            rotation: {
                x: toNumber(descriptor && descriptor.rotation && descriptor.rotation.x),
                y: toNumber(descriptor && descriptor.rotation && descriptor.rotation.y),
                z: toNumber(descriptor && descriptor.rotation && descriptor.rotation.z)
            },
            rotationOrder: normalizeRotationOrder(descriptor && descriptor.rotationOrder)
        };
    }

    serializeModelsJSON (targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const result = [];
        for (const [modelTargetId, models] of this.models) {
            if (targetId && modelTargetId !== targetId) continue;
            const target = originalTargets.find(item => item.id === modelTargetId);
            if (!target) continue;
            for (const model of models) {
                result.push({
                    activeMotion: model.activeMotion || '',
                    animationCount: model.animationCount,
                    isStage: target.isStage,
                    md5ext: `${model.assetId}.glb`,
                    modelFormat: model.modelFormat || model.sourceFormat || 'glb',
                    motions: (model.motions || []).map(motion => ({...motion})),
                    name: model.name,
                    originalSize: model.originalSize,
                    sourceFormat: model.sourceFormat,
                    targetId: modelTargetId,
                    targetIndex: originalTargets.indexOf(target),
                    targetName: target.getName(),
                    triangles: model.triangles,
                    vertices: model.vertices
                });
            }
        }
        return result;
    }

    serializeModelAssets (targetId) {
        const seen = new Set();
        const allModels = Array.from(this.models.values()).reduce((all, items) => all.concat(items), []);
        return this.serializeModelsJSON(targetId).reduce((result, descriptor) => {
            if (seen.has(descriptor.md5ext)) return result;
            seen.add(descriptor.md5ext);
            const assetId = descriptor.md5ext.slice(0, -4);
            const model = allModels.find(item => item.assetId === assetId);
            if (model) result.push({fileName: descriptor.md5ext, fileContent: model.asset.data});
            return result;
        }, []);
    }

    async deserializeModels (descriptors, zip) {
        if (!Array.isArray(descriptors) || !zip) return [];
        const results = [];
        for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.md5ext !== 'string') continue;
            let file = zip.file(descriptor.md5ext);
            if (!file) {
                const pattern = new RegExp(`^([^/]*/)?${escapeRegExp(descriptor.md5ext)}$`);
                file = zip.file(pattern)[0];
            }
            if (!file) continue;
            const data = await file.async('uint8array');
            const assetId = descriptor.md5ext.slice(0, -4);
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                'glb',
                data,
                assetId,
                false
            );
            results.push({
                isStage: descriptor.isStage === true,
                model: {
                    activeMotion: String(descriptor.activeMotion || ''),
                    animationCount: toNumber(descriptor.animationCount),
                    asset,
                    assetId,
                    dataFormat: 'glb',
                    modelFormat: String(descriptor.modelFormat || descriptor.sourceFormat || 'glb'),
                    motions: Array.isArray(descriptor.motions) ? descriptor.motions.map(motion => ({
                        format: String(motion.format || ''),
                        frameCount: Math.max(1, toNumber(motion.frameCount, 1)),
                        name: String(motion.name || '')
                    })).filter(motion => motion.name) : [],
                    name: String(descriptor.name || 'model'),
                    originalSize: descriptor.originalSize || {x: 0, y: 0, z: 0},
                    sourceFormat: String(descriptor.sourceFormat || 'glb'),
                    triangles: toNumber(descriptor.triangles),
                    vertices: toNumber(descriptor.vertices)
                },
                targetId: String(descriptor.targetId || ''),
                targetIndex: Number.isInteger(descriptor.targetIndex) ? descriptor.targetIndex : -1,
                targetName: String(descriptor.targetName || '')
            });
        }
        return results;
    }

    replaceModels (entries) {
        for (const record of this.modelObjects.values()) {
            if (record.object) disposeObject(record.object);
        }
        this.modelObjects.clear();
        this.models.clear();
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const entry of entries) {
            const indexedTarget = originalTargets[entry.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === entry.isStage ? indexedTarget :
                originalTargets.find(item => item.isStage === entry.isStage && item.getName() === entry.targetName);
            const targetId = target ? target.id : entry.targetId;
            const models = this.models.get(targetId) || [];
            models.push(entry.model);
            this.models.set(targetId, models);
        }
        this.emit('modelsChanged');
    }
}

const installMovieAssetManager = vm => {
    if (!vm.__movieAssetManager) {
        vm.__movieAssetManager = new MovieAssetManager(vm);
        vm.runtime.movieAssetManager = vm.__movieAssetManager;
    }
    return vm.__movieAssetManager;
};

export {
    MovieAssetManager,
    VIDEO_FRAME_RATE,
    installMovieAssetManager as default
};
