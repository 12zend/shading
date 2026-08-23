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
    createBuildingPrimitive,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    loadBuildingTexture,
    makeBuildingMaterial,
    normalizeFOV,
    projectPosition,
    spritePlaneMatrix
} from './model-runtime';
import downloadBlob from './download-blob';

const VIDEO_FRAME_RATE = 30;
const BITMAP_RESOLUTION = 2;
const RENDERING_DEFAULT_FRAME_RATE = 30;
const RENDERING_MAX_FRAME_RATE = 120;
const RENDERING_FILE_NAME = 'rendering.mp4';
const RENDERING_MASTER_GAIN = 0.8912509381337456; // -1 dBFS headroom before encoding.
const TIMELINE_DEFAULT_DURATION = 10;
const TIMELINE_MAX_DURATION = 3600;
const DEFAULT_BACKDROP_ASSET_ID = 'cd21514d0531fdffb22204e0ec5ed84a';
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

const IMPORT_MIME_TYPES = {
    aac: 'audio/aac',
    bmp: 'image/bmp',
    flac: 'audio/flac',
    gif: 'image/gif',
    jfif: 'image/jpeg',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2'
};

const COSTUME_EXTENSIONS = ['svg', 'png', 'bmp', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'exr'];
const SOUND_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'flac', 'aac', 'm4a'];
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
const MODEL_SOURCE_EXTENSIONS = ['glb', 'pmx', 'fbx', 'obj'];
const MOTION_EXTENSIONS = ['vmd', 'vpd'];

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

const getImportMimeType = file => file.type || IMPORT_MIME_TYPES[getExtension(file.name)] || '';

const normalizeImportError = error => (
    error instanceof Error ? error : new Error(String(error))
);

const MODEL_TEXTURE_FORMATS = ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'spa', 'sph', 'tga', 'webp'];
const MODEL_SUPPORT_EXTENSIONS = ['mtl'].concat(MODEL_TEXTURE_FORMATS);

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

const SHAPE_TYPES = ['polygon', 'star', 'flower'];
const PROCEDURAL_SHAPE_TYPES = SHAPE_TYPES.concat(['arc', 'circular segment', 'line']);
const MAX_SHAPE_SIZE = 4096;
const SHAPE_RADIUS_SCALE = 0.5;
const MAX_CACHED_SHAPE_SKINS = 256;
const MAX_CACHED_SHAPE_SKIN_PIXELS = 4096 * 4096;

const normalizeShapeType = value => {
    const shape = String(value || '').toLowerCase();
    return PROCEDURAL_SHAPE_TYPES.includes(shape) ? shape : SHAPE_TYPES[0];
};

const getShapeBitmapCacheKey = configuration => {
    const shape = normalizeShapeType(configuration.shape);
    const color = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    const opacity = clamp(toNumber(configuration.opacity, 100), 0, 100);
    if (shape === 'line') {
        const point1 = configuration.position1 || {};
        const point2 = configuration.position2 || {};
        return JSON.stringify([
            shape,
            toNumber(point2.x) - toNumber(point1.x),
            toNumber(point2.y) - toNumber(point1.y),
            Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5))),
            color,
            opacity
        ]);
    }

    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    const angle = configuration.angle || {};
    return JSON.stringify([
        shape,
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.width, 100))))),
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.height, 100))))),
        Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6))))),
        outerRadius,
        innerRadius,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.start, 0) : 0,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.end, 360) : 360,
        color,
        opacity
    ]);
};

const createLineBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const point1 = configuration.position1 || {};
    const point2 = configuration.position2 || {};
    const thickness = Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5)));
    const padding = thickness / 2;
    const width = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.x) - toNumber(point1.x)) + (padding * 2)
    )));
    const height = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.y) - toNumber(point1.y)) + (padding * 2)
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;
    canvas.width = width;
    canvas.height = height;
    const minX = Math.min(toNumber(point1.x), toNumber(point2.x));
    const minY = Math.min(toNumber(point1.y), toNumber(point2.y));
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.moveTo(toNumber(point1.x) - minX + padding, toNumber(point1.y) - minY + padding);
    context.lineTo(toNumber(point2.x) - minX + padding, toNumber(point2.y) - minY + padding);
    context.lineWidth = thickness;
    context.strokeStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.stroke();
    canvas.reusable = false;
    return canvas;
};

const createShapeBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const requestedWidth = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.width, 100))
    )));
    const requestedHeight = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.height, 100))
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;

    const shape = normalizeShapeType(configuration.shape);
    if (shape === 'line') return null;
    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    // Keep radius in the same coordinate system as the block's default 100px outer radius. The bitmap grows
    // when a larger radius is requested instead of normalizing every shape back to the requested dimensions.
    const scale = SHAPE_RADIUS_SCALE;
    const diameter = Math.max(2, Math.ceil(outerRadius * scale * 2));
    const width = Math.max(requestedWidth, diameter);
    const height = Math.max(requestedHeight, diameter);
    canvas.width = width;
    canvas.height = height;
    const centerX = width / 2;
    const centerY = height / 2;
    const sides = Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6)))));
    const pointCount = shape === 'polygon' ? sides : shape === 'flower' ? Math.max(24, sides * 12) : sides * 2;

    const radiusAt = angle => {
        if (shape === 'polygon') return outerRadius;
        if (shape === 'star') return angle % 2 === 0 ? outerRadius : innerRadius;
        const petal = (Math.cos((angle / pointCount) * sides * Math.PI * 2) + 1) / 2;
        return innerRadius + ((outerRadius - innerRadius) * Math.pow(petal, 0.45));
    };

    const drawPath = (count, distanceAt, reverse = false) => {
        for (let index = 0; index < count; index++) {
            const pathIndex = reverse ? count - index - 1 : index;
            const angle = (-Math.PI / 2) + ((pathIndex / count) * Math.PI * 2);
            const distance = distanceAt(pathIndex) * scale;
            const x = centerX + (Math.cos(angle) * distance);
            const y = centerY + (Math.sin(angle) * distance);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();
    };

    context.clearRect(0, 0, width, height);
    context.beginPath();
    if (shape === 'arc' || shape === 'circular segment') {
        const angle = configuration.angle || {};
        const start = (toNumber(angle.start, 0) - 90) * Math.PI / 180;
        const end = (toNumber(angle.end, 360) - 90) * Math.PI / 180;
        // Keep the endpoints unwrapped so their order describes the sweep direction.
        const anticlockwise = end < start;
        const outerStartX = centerX + (Math.cos(start) * outerRadius * scale);
        const outerStartY = centerY + (Math.sin(start) * outerRadius * scale);
        context.moveTo(outerStartX, outerStartY);
        context.arc(centerX, centerY, outerRadius * scale, start, end, anticlockwise);
        if (shape === 'arc' && innerRadius > 0) {
            context.arc(centerX, centerY, innerRadius * scale, end, start, !anticlockwise);
        } else {
            context.lineTo(outerStartX, outerStartY);
        }
    } else {
        drawPath(pointCount, radiusAt);
        if (innerRadius > 0) drawPath(sides, () => innerRadius, true);
    }
    context.fillStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.fill('evenodd');
    canvas.reusable = false;
    return canvas;
};

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
        this.buildingMaterials = new Map();
        this.buildingTextures = new Map();
        this.shapeSkinCache = new Map();
        this.shapeSkinCachePixels = 0;
        this.blockingVideoRenders = new Set();
        this.renderingFrames = [];
        this.renderingSoundEvents = [];
        this.playedTimelineSoundBlocks = new Set();
        this.timelineSoundSources = new Set();
        this.objectVideoAudio = new Map();
        this.objectVideoAudioSeen = new Set();
        this.previewRendererSize = null;
        this.modelRenderer = null;
        this.flatDepthVersion = 0;
        this.penFrameTransactionActive = false;
        this.penFrameTransactionsInstalled = false;
        this.defaultStageBackgroundColor = null;
        this.runtime.movieZBuffer = null;
        // null selects the backwards-compatible studio lights; an array is the user-authored light scene.
        this.lights = null;
        const [stageWidth, stageHeight] = this.getStageSize();
        this.timeline = {
            currentTime: 0,
            duration: TIMELINE_DEFAULT_DURATION,
            framerate: RENDERING_DEFAULT_FRAME_RATE,
            height: stageHeight,
            pendingFrame: true,
            playing: false,
            recording: false,
            renderFrameThreads: [],
            sound: '',
            waitingForFrame: false,
            waitingForVideo: false,
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
        this.handleProjectChanged = this.handleProjectChanged.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
        this.handleTimelineBeforeExecute = this.handleTimelineBeforeExecute.bind(this);
        this.handleTimelineAfterExecute = this.handleTimelineAfterExecute.bind(this);
        this.stopAllObjectVideoAudio = this.stopAllObjectVideoAudio.bind(this);
        this.ensureMainTarget = this.ensureMainTarget.bind(this);

        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.fontManager.on('change', this.handleFontsChanged);
        this.runtime.on('BEFORE_EXECUTE', this.handleTimelineBeforeExecute);
        this.runtime.on('AFTER_EXECUTE', this.handleTimelineAfterExecute);
        this.runtime.on('PROJECT_CHANGED', this.handleProjectChanged);
        this.runtime.on('PROJECT_STOP_ALL', this.stopAllObjectVideoAudio);
        this.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
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

    attachPenFrameTransactions (penFX) {
        this.penFX = penFX;
        if (this.penFrameTransactionsInstalled) return;
        const pen = this.runtime.ext_pen;
        const primitives = this.runtime._primitives;
        if (!pen || typeof pen.clear !== 'function' || !primitives ||
            typeof primitives.pen_clear !== 'function') return;

        const manager = this;
        const compiledClear = pen.clear;
        pen.clear = function (...args) {
            manager.beginPenFrameTransaction();
            const result = compiledClear.apply(this, args);
            manager.drawDefaultPenBackground();
            return result;
        };
        const interpreterClear = primitives.pen_clear;
        primitives.pen_clear = function (...args) {
            manager.beginPenFrameTransaction();
            const result = interpreterClear.apply(this, args);
            manager.drawDefaultPenBackground();
            return result;
        };
        this.penFrameTransactionsInstalled = true;
        this.drawDefaultPenBackground();
    }

    usesDefaultBackdrop () {
        const stage = typeof this.runtime.getTargetForStage === 'function' ?
            this.runtime.getTargetForStage() :
            (Array.isArray(this.runtime.targets) ? this.runtime.targets.find(target => target.isStage) : null);
        if (!stage) return false;
        const costumes = typeof stage.getCostumes === 'function' ?
            stage.getCostumes() : stage.sprite && stage.sprite.costumes;
        const costume = Array.isArray(costumes) ? costumes[stage.currentCostume] : null;
        return Boolean(costume && costume.assetId === DEFAULT_BACKDROP_ASSET_ID);
    }

    drawDefaultPenBackground () {
        const renderer = this.runtime.renderer;
        if (!this.defaultStageBackgroundColor) {
            const rendererColor = renderer && renderer._backgroundColor4f;
            this.defaultStageBackgroundColor = rendererColor && rendererColor.length === 4 ?
                Array.from(rendererColor) : [1, 1, 1, 1];
        }
        if (!this.usesDefaultBackdrop()) {
            if (renderer && typeof renderer.setBackgroundColor === 'function') {
                renderer.setBackgroundColor(...this.defaultStageBackgroundColor);
            }
            return;
        }
        if (!this.penFX || typeof this.penFX.drawDefaultBackground !== 'function') return;
        if (renderer && typeof renderer.setBackgroundColor === 'function') {
            renderer.setBackgroundColor(0, 0, 0, 0);
        }
        this.penFX.drawDefaultBackground(this.defaultStageBackgroundColor);
    }

    beginPenFrameTransaction () {
        if (this.penFrameTransactionActive || !this.timeline || !this.timeline.renderedThisStep ||
            !this.penFX || typeof this.penFX.beginFrame !== 'function') return;
        this.penFrameTransactionActive = this.penFX.beginFrame() === true;
    }

    resetPenForRenderFrame () {
        // beginFrame swaps in a transparent staging texture while the completed frame remains visible.
        // This is the render-frame reset: do not call pen_clear from a VM execute hook, because that would
        // expose an empty Pen layer before compiled or interpreted render-frame scripts finish drawing.
        this.beginPenFrameTransaction();
        if (this.penFrameTransactionActive) this.drawDefaultPenBackground();
    }

    commitPenFrameTransaction () {
        if (!this.penFrameTransactionActive) return;
        this.penFrameTransactionActive = false;
        if (this.penFX && typeof this.penFX.commitFrame === 'function') this.penFX.commitFrame();
    }

    cancelPenFrameTransaction () {
        if (!this.penFrameTransactionActive) return;
        this.penFrameTransactionActive = false;
        if (this.penFX && typeof this.penFX.cancelFrame === 'function') this.penFX.cancelFrame();
    }

    cancelPendingObjectDraws () {
        if (!(this.targetStates instanceof Map)) return;
        for (const state of this.targetStates.values()) {
            state.objectDrawVersion++;
            state.objectDrawQueue.length = 0;
        }
    }

    ensureMainTarget () {
        const sprites = this.runtime.targets.filter(target => target.isOriginal && !target.isStage);
        if (!sprites.length) return;
        const target = sprites.find(sprite => sprite.getName() === 'main') || sprites[0];
        if (target.getName() !== 'main') this.vm.renameSprite(target.id, 'main');
        if (!this.vm.editingTarget || this.vm.editingTarget.isStage) this.vm.setEditingTarget(target.id);
    }

    handleProjectLoaded () {
        for (const target of this.runtime.targets) {
            if (!target.isStage) target.setVisible(false);
        }
        this.ensureMainTarget();
        this.drawDefaultPenBackground();
    }

    installPrimitives () {
        const primitives = this.runtime._primitives;
        // Render a named frame atomically. Waiting here guarantees that a following Pen stamp consumes the
        // requested video frame instead of the sprite's previous costume, text, or model skin.
        primitives.looks_rendervideo = (args, util) => this.trackBlockingVideoRender(
            this.renderVideo(util.target, args.VIDEO, args.FRAME)
        );
        // Keep the original video controls loadable without changing their scheduling behavior. New projects use
        // render-video-at-frame so selecting and decoding a stamp source cannot race the following block.
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
        // Timeline playback tracks pending visual work separately. Never put the render-frame script into
        // promise-wait mode, or repeated hats can prevent the model from appearing during playback.
        primitives.looks_rendermodel = (args, util) => {
            this.runWithoutWaiting(this.renderModelToScene(util.target, args.MODEL));
        };
        // Building blocks must not yield between erase-all and stamp; otherwise the cleared pen frame flashes.
        primitives.looks_renderwall = (args, util) => {
            this.runWithoutWaiting(this.renderBuildingPrimitive('wall', args, util.target));
        };
        primitives.looks_renderfloor = (args, util) => {
            this.runWithoutWaiting(this.renderBuildingPrimitive('floor', args, util.target));
        };
        primitives.looks_renderbox = (args, util) => {
            this.runWithoutWaiting(this.renderBuildingPrimitive('box', args, util.target));
        };
        primitives.looks_clearmaterial = () => this.clearBuildingMaterials();
        primitives.looks_addmaterial = args => this.addBuildingMaterial(args.MATERIAL);
        primitives.looks_setalbedofromcolor = args => this.setBuildingMaterialColor(
            args.MATERIAL, 'albedo', args.COLOR
        );
        primitives.looks_setemissionfromcolor = args => this.setBuildingMaterialColor(
            args.MATERIAL, 'emission', args.COLOR
        );
        // Texture decoding continues in the background without putting the current script into promise-wait mode.
        primitives.looks_setalbedofromtexture = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'albedo', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setemissionfromtexture = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'emission', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setdisplacementmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'displacement', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setnormalmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'normal', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setroughmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'roughness', args.TEXTURE, util.target
            ));
        };
        // Frame selection itself is synchronous. Rendering can continue in the background so a render-frame hat
        // is not restarted before it reaches a following render-model block.
        primitives.looks_setmodelframeto = (args, util) => {
            this.runWithoutWaiting(this.setModelFrame(util.target, args.FRAME));
        };
        primitives.looks_clearlight = () => this.clearLights();
        primitives.looks_addpointlight = args => this.addLight('point', args);
        primitives.looks_addlight = args => this.addLight('spot', args);
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

    rerenderLightedModelScenes () {
        const renders = [];
        for (const target of this.runtime.targets || []) {
            const state = this.targetStates.get(target.id);
            if (!state || state.requestedMode !== 'model' || !state.modelScene.length) continue;
            const render = this.queueModelSceneRender(target);
            if (render && typeof render.then === 'function') renders.push(render);
        }
        return renders.length ? Promise.all(renders) : undefined;
    }

    clearLights () {
        this.lights = [];
        return this.rerenderLightedModelScenes();
    }

    addLight (type, args = {}) {
        const light = {
            angle: args.ANGLE,
            color: args.COLOR,
            intensity: args.INTENSITY,
            position: {x: args.X, y: args.Y, z: args.Z},
            radius: args.RADIUS,
            shadow: args.SHADOW,
            type
        };
        // The first authored light replaces the preview-oriented studio setup. Further blocks accumulate lights.
        this.lights = (Array.isArray(this.lights) ? this.lights : []).concat(light);
        return this.rerenderLightedModelScenes();
    }

    trackBlockingVideoRender (promise) {
        if (!promise || typeof promise.then !== 'function') return promise;
        if (!(this.blockingVideoRenders instanceof Set)) this.blockingVideoRenders = new Set();
        this.blockingVideoRenders.add(promise);
        const finish = () => this.blockingVideoRenders.delete(promise);
        promise.then(finish, error => {
            finish();
            this.emit('renderError', error);
        });
        return promise;
    }

    hasBlockingVideoRenders () {
        return this.blockingVideoRenders instanceof Set && this.blockingVideoRenders.size > 0;
    }

    hasActiveRenderFrameThreads () {
        const renderFrameThreads = this.timeline && this.timeline.renderFrameThreads;
        const runtimeThreads = this.runtime && this.runtime.threads;
        if (!Array.isArray(renderFrameThreads) || !Array.isArray(runtimeThreads)) return false;
        return renderFrameThreads.some(thread => runtimeThreads.indexOf(thread) !== -1);
    }

    hasPendingVisualRenders () {
        if (!(this.targetStates instanceof Map)) return false;
        for (const state of this.targetStates.values()) {
            if (state.objectDrawPromise || state.objectDrawQueue.length > 0) return true;
            if (state.requestedMode === 'model' && state.modelRenderPromise) return true;
            if (state.requestedMode === 'text' && (state.textRenderPromise || state.textQueue.length > 0)) return true;
            if (
                state.requestedMode === 'video' &&
                (state.videoRenderPromise || state.pendingVideoFrame)
            ) return true;
        }
        return false;
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
            this.lights = null;
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

    getTimelineSettings () {
        return {
            duration: this.timeline.duration,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
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
        this.timeline.renderFrameThreads = [];
        this.timeline.sound = String(settings.sound || '');
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
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
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        if (this.timeline.currentTime >= this.timeline.duration) this.timeline.currentTime = 0;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(this.timeline.currentTime, false);
        this.timeline.pendingFrame = true;
        this.timeline.playing = true;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    }

    pauseTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const clock = this.runtime.ioDevices.clock;
        if (this.timeline.playing) {
            this.timeline.currentTime = clamp(clock.projectTimer(), 0, this.timeline.duration);
        }
        this.timeline.playing = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.setTimelineClock(this.timeline.currentTime, true);
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.emitTimelineChanged();
    }

    stopTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const cancelledRendering = this.timeline.recording;
        this.playedTimelineSoundBlocks.clear();
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.setTimelineClock(0, true);
        this.timeline.pendingFrame = true;
        this.emitTimelineChanged();
        if (cancelledRendering) this.emit('timelineRenderCancelled');
    }

    seekTimeline (seconds) {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const wasPlaying = this.timeline.playing;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(seconds, !wasPlaying);
        this.timeline.pendingFrame = true;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        if (wasPlaying) this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    }

    requestTimelinePreviewRefresh () {
        clearTimeout(this.timelinePreviewRefreshTimeout);
        this.timelinePreviewRefreshTimeout = setTimeout(() => {
            this.timelinePreviewRefreshTimeout = null;
            if (this.timeline.playing || this.timeline.recording) return;
            this.seekTimeline(this.timeline.currentTime);
        }, 0);
    }

    handleProjectChanged () {
        // Render-frame scripts can update serializable Movie state themselves. Refreshing in response to those
        // updates would continuously restart a paused preview, so only edits made outside the frame transaction
        // should schedule another evaluation at the current timeline time.
        if (this.timeline.renderedThisStep) return;
        this.requestTimelinePreviewRefresh();
    }

    updateTimelineSettings (settings, options = {}) {
        const previousSettings = this.getTimelineSettings();
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
        const nextSettings = this.getTimelineSettings();
        if (JSON.stringify(previousSettings) !== JSON.stringify(nextSettings)) {
            this.emit('timelineSettingsChanged', nextSettings, {
                previousSettings,
                remote: options.remote === true
            });
        }
        this.runtime.emitProjectChanged();
    }

    renderTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
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
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
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
        this.stopAllObjectVideoAudio();
    }

    beginObjectVideoAudioFrame () {
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        this.objectVideoAudioSeen.clear();
    }

    finishObjectVideoAudioFrame () {
        if (!(this.objectVideoAudio instanceof Map)) this.objectVideoAudio = new Map();
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        for (const [key, playback] of this.objectVideoAudio) {
            if (!this.objectVideoAudioSeen.has(key)) this.stopObjectVideoAudioEntry(key, playback);
        }
    }

    stopObjectVideoAudioEntry (key, playback) {
        if (!playback) return;
        playback.version = (Number(playback.version) || 0) + 1;
        const element = playback.element;
        if (element) {
            if (typeof element.pause === 'function') element.pause();
            if (typeof element.removeAttribute === 'function') element.removeAttribute('src');
            if (typeof element.load === 'function') element.load();
        }
        if (this.objectVideoAudio instanceof Map && this.objectVideoAudio.get(key) === playback) {
            this.objectVideoAudio.delete(key);
        }
    }

    stopObjectVideoAudio (target, configuration) {
        if (!(this.objectVideoAudio instanceof Map) || !target) return;
        const key = this.getObjectVideoPlaybackKey(target, configuration);
        this.stopObjectVideoAudioEntry(key, this.objectVideoAudio.get(key));
    }

    stopAllObjectVideoAudio () {
        if (!(this.objectVideoAudio instanceof Map)) {
            this.objectVideoAudio = new Map();
            return;
        }
        for (const [key, playback] of this.objectVideoAudio) {
            this.stopObjectVideoAudioEntry(key, playback);
        }
        if (this.objectVideoAudioSeen instanceof Set) this.objectVideoAudioSeen.clear();
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
        if (this.timeline.waitingForFrame || this.timeline.waitingForVideo) {
            if (this.hasBlockingVideoRenders() || this.hasPendingVisualRenders()) return;
            // Continue the frame's existing threads after every slow visual operation has completed. Do not
            // restart the hat or advance the deterministic clock while the current frame is still being drawn.
            this.timeline.waitingForFrame = false;
            this.timeline.waitingForVideo = false;
            this.timeline.renderedThisStep = true;
            return;
        }
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
        this.beginObjectVideoAudioFrame();
        this.resetPenForRenderFrame();
        const threads = this.runtime.startHats('event_renderframe');
        this.timeline.renderFrameThreads = Array.isArray(threads) ? threads : [];
    }

    handleTimelineAfterExecute () {
        if (!this.timeline.renderedThisStep) return;
        this.timeline.renderedThisStep = false;
        const waitingForVideo = this.hasBlockingVideoRenders();
        if (waitingForVideo || this.hasPendingVisualRenders() || this.hasActiveRenderFrameThreads()) {
            this.timeline.waitingForFrame = true;
            this.timeline.waitingForVideo = waitingForVideo;
            return;
        }
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.finishObjectVideoAudioFrame();
        this.commitPenFrameTransaction();
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
            // Scratch's size fencing clamps the scale based on the costume and stage dimensions.
            // Keep position fencing enabled, but do not let it change an explicitly requested size.
            const runtimeOptions = this.runtime.runtimeOptions;
            const restoreFencing = runtimeOptions && runtimeOptions.fencing;
            if (restoreFencing) runtimeOptions.fencing = false;
            let result;
            try {
                result = originalSetSize(size);
            } finally {
                if (restoreFencing) runtimeOptions.fencing = true;
            }
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

    async decodeRenderingVideoAudio (video, preferredAudio) {
        const data = video && video.asset && video.asset.data;
        if (!data) return null;
        const audioEngine = this.runtime.audioEngine;
        if (audioEngine && typeof audioEngine.decodeSoundPlayer === 'function') {
            try {
                const player = await audioEngine.decodeSoundPlayer({data: data});
                if (player && player.buffer) {
                    return {
                        buffer: player.buffer,
                        context: audioEngine.audioContext,
                        ownsContext: false
                    };
                }
            } catch (error) {
                // Video containers are not accepted by every Scratch audio decoder; Web Audio may still decode it.
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
        if (!context || typeof context.decodeAudioData !== 'function') return null;
        try {
            const buffer = await context.decodeAudioData(copyArrayBuffer(data));
            return {buffer, context, ownsContext};
        } catch (error) {
            if (ownsContext && typeof context.close === 'function') {
                const closePromise = context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
            return null;
        }
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
            const decoded = clip.video ?
                await this.decodeRenderingVideoAudio(clip.video, sharedAudio) :
                await this.decodeRenderingSound(clip.sound, sharedAudio);
            if (!decoded || !decoded.buffer) continue;
            if (!sharedAudio) sharedAudio = decoded;
            const numericPlaybackRate = Number(clip.playbackRate);
            const decodedClip = {
                buffer: decoded.buffer,
                offset: Math.max(0, toNumber(clip.offset)),
                pan: clamp(toNumber(clip.pan), -100, 100) / 100,
                playbackRate: Number.isFinite(numericPlaybackRate) && numericPlaybackRate > 0 ?
                    numericPlaybackRate : Math.pow(2, toNumber(clip.pitch) / 120),
                startTime: Math.max(0, Number.isFinite(Number(clip.startTime)) ?
                    Number(clip.startTime) : toNumber(clip.frame) / framerate),
                volume: clamp(toNumber(clip.volume, 100), 0, 100) / 100
            };
            if (Number.isFinite(Number(clip.duration))) {
                decodedClip.duration = Math.max(0, Number(clip.duration));
            }
            decodedClips.push(decodedClip);
        }
        if (!sharedAudio || !decodedClips.length) {
            if (sharedAudio && sharedAudio.ownsContext && sharedAudio.context &&
                typeof sharedAudio.context.close === 'function') {
                const closePromise = sharedAudio.context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
            return null;
        }
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

    getRenderingAudioMasterGain (clips) {
        if (!Array.isArray(clips) || clips.length === 0) return 1;
        const events = [];
        for (const clip of clips) {
            const start = Math.max(0, toNumber(clip.startTime));
            const offset = Math.max(0, toNumber(clip.offset));
            const playbackRate = Math.max(Number.EPSILON, toNumber(clip.playbackRate, 1));
            const bufferDuration = clip.buffer && Number(clip.buffer.duration);
            const naturalDuration = Number.isFinite(bufferDuration) ?
                Math.max(0, (bufferDuration - offset) / playbackRate) : Infinity;
            const requestedDuration = Number(clip.duration);
            const duration = Number.isFinite(requestedDuration) ?
                Math.min(naturalDuration, Math.max(0, requestedDuration)) : naturalDuration;
            const volume = clamp(toNumber(clip.volume, 1), 0, 1);
            if (duration <= 0 || volume <= 0) continue;
            events.push({change: volume, time: start});
            events.push({change: -volume, time: start + duration});
        }
        events.sort((a, b) => (a.time - b.time) || (a.change - b.change));

        let currentVolume = 0;
        let maximumVolume = 0;
        for (const event of events) {
            currentVolume += event.change;
            maximumVolume = Math.max(maximumVolume, currentVolume);
        }
        return maximumVolume > 1 ? RENDERING_MASTER_GAIN / maximumVolume : 1;
    }

    createRenderingAudioMaster (audioContext, destination, clips) {
        const nodes = [];
        let input = destination;

        // Scale the entire mix linearly from the maximum simultaneous clip volume. Unlike compression or
        // limiting, a constant gain preserves the original tone and dynamics.
        const masterGain = this.getRenderingAudioMasterGain(clips);
        if (masterGain < 1 && typeof audioContext.createGain === 'function') {
            const gain = audioContext.createGain();
            gain.gain.value = masterGain;
            gain.connect(destination);
            input = gain;
            nodes.push(gain);
        }

        return {input, nodes};
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

        // Prefer explicit frame capture so MediaRecorder can never sample the export canvas between clearing it
        // and drawing the completed frame. Fall back to timed capture for browsers without requestFrame().
        let videoStream = canvas.captureStream(0);
        let videoTrack = videoStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('Could not create a video stream for the rendering.');
        const manuallyCaptureFrames = typeof videoTrack.requestFrame === 'function';
        if (!manuallyCaptureFrames) {
            videoTrack.stop();
            videoStream = canvas.captureStream(framerate);
            videoTrack = videoStream.getVideoTracks()[0];
            if (!videoTrack) throw new Error('Could not create a video stream for the rendering.');
        }
        const recordingStream = new MediaStream();
        recordingStream.addTrack(videoTrack);

        const audioSources = [];
        let audioDestination = null;
        let audioMasterNodes = [];
        if (audio) {
            if (!audio.context || typeof audio.context.createMediaStreamDestination !== 'function') {
                throw new Error('This browser cannot add audio to the rendering.');
            }
            audioDestination = audio.context.createMediaStreamDestination();
            const audioMaster = this.createRenderingAudioMaster(audio.context, audioDestination, audio.clips);
            audioMasterNodes = audioMaster.nodes;
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
                output.connect(audioMaster.input);
                audioSources.push({
                    duration: clip.duration,
                    nodes,
                    offset: clip.offset,
                    source,
                    startTime: clip.startTime
                });
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
            audioMasterNodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
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
                const scheduledStart = audioStartTime + audioSource.startTime;
                audioSource.source.start(scheduledStart, audioSource.offset);
                if (Number.isFinite(Number(audioSource.duration))) {
                    audioSource.source.stop(scheduledStart + Math.max(0, Number(audioSource.duration)));
                }
            }

            const frameDuration = 1000 / framerate;
            const startTime = now();
            if (manuallyCaptureFrames) videoTrack.requestFrame();
            for (let index = 1; index < frames.length; index++) {
                await wait(Math.max(0, startTime + (index * frameDuration) - now()));
                drawFrame(frames[index]);
                if (manuallyCaptureFrames) videoTrack.requestFrame();
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

    normalizeBuildingMaterialName (requestedName) {
        return String(requestedName || '').trim() || 'material';
    }

    getBuildingMaterialRecord (requestedName) {
        const name = this.normalizeBuildingMaterialName(requestedName);
        let record = this.buildingMaterials.get(name);
        if (!record) {
            record = {
                albedo: '#ff00ff',
                albedoTexture: null,
                albedoTexturePending: null,
                albedoTextureSource: null,
                displacementTexture: null,
                displacementTexturePending: null,
                displacementTextureSource: null,
                emission: '#000000',
                emissionTexture: null,
                emissionTexturePending: null,
                emissionTextureSource: null,
                ior: 1.45,
                material: makeBuildingMaterial(),
                name,
                normalTexture: null,
                normalTexturePending: null,
                normalTextureSource: null,
                roughness: 1,
                roughnessTexture: null,
                roughnessTexturePending: null,
                roughnessTextureSource: null,
                textureVersions: {
                    albedo: 0,
                    displacement: 0,
                    emission: 0,
                    normal: 0,
                    roughness: 0
                }
            };
            this.buildingMaterials.set(name, record);
        }
        return record;
    }

    syncBuildingMaterial (record) {
        const material = record.material;
        try {
            material.color.set(record.albedoTexture ? '#ffffff' : record.albedo);
        } catch (error) {
            material.color.set('#ff00ff');
        }
        try {
            material.emissive.set(record.emissionTexture ? '#ffffff' : record.emission);
        } catch (error) {
            material.emissive.set('#000000');
        }
        material.map = record.albedoTexture;
        material.displacementMap = record.displacementTexture;
        material.emissiveMap = record.emissionTexture;
        material.normalMap = record.normalTexture;
        material.ior = record.ior;
        material.roughness = record.roughness;
        material.roughnessMap = record.roughnessTexture;
        material.needsUpdate = true;
    }

    rerenderBuildingScenes () {
        for (const target of this.runtime.targets || []) {
            const state = this.targetStates.get(target.id);
            if (!state || state.requestedMode !== 'model' ||
                !state.modelScene.some(item => item.sourceObject)) continue;
            this.runWithoutWaiting(this.queueModelSceneRender(target));
        }
    }

    resetBuildingMaterial (record) {
        record.albedo = '#ff00ff';
        record.albedoTexture = null;
        record.albedoTexturePending = null;
        record.albedoTextureSource = null;
        record.displacementTexture = null;
        record.displacementTexturePending = null;
        record.displacementTextureSource = null;
        record.emission = '#000000';
        record.emissionTexture = null;
        record.emissionTexturePending = null;
        record.emissionTextureSource = null;
        record.normalTexture = null;
        record.normalTexturePending = null;
        record.normalTextureSource = null;
        record.ior = 1.45;
        record.roughness = 1;
        record.roughnessTexture = null;
        record.roughnessTexturePending = null;
        record.roughnessTextureSource = null;
        Object.keys(record.textureVersions).forEach(channel => record.textureVersions[channel]++);
        this.syncBuildingMaterial(record);
    }

    clearBuildingMaterials () {
        for (const record of this.buildingMaterials.values()) {
            this.resetBuildingMaterial(record);
        }
        this.rerenderBuildingScenes();
    }

    addBuildingMaterial (requestedName) {
        const name = this.normalizeBuildingMaterialName(requestedName);
        if (this.buildingMaterials.has(name)) return;
        this.getBuildingMaterialRecord(name);
    }

    setBuildingMaterialColor (requestedName, channel, requestedColor) {
        const record = this.getBuildingMaterialRecord(requestedName);
        const textureKey = `${channel}Texture`;
        const pendingKey = `${channel}TexturePending`;
        const sourceKey = `${channel}TextureSource`;
        record[channel] = String(requestedColor || (channel === 'albedo' ? '#ff00ff' : '#000000'));
        record[textureKey] = null;
        record[pendingKey] = null;
        record[sourceKey] = null;
        record.textureVersions[channel]++;
        this.syncBuildingMaterial(record);
        this.rerenderBuildingScenes();
    }

    getCostumeByName (target, requestedCostume) {
        const original = getOriginalTarget(target);
        const costumes = original && typeof original.getCostumes === 'function' ? original.getCostumes() : [];
        if (!costumes.length) return null;
        if (typeof requestedCostume === 'number' || /^\s*\d+\s*$/.test(String(requestedCostume))) {
            return costumes[clamp(Number(requestedCostume) - 1, 0, costumes.length - 1)];
        }
        return costumes.find(costume => costume.name === String(requestedCostume)) || costumes[0];
    }

    getBuildingTexture (costume, channel) {
        const source = costume.asset;
        const usage = channel === 'albedo' || channel === 'emission' ? 'color' : 'data';
        let cachedByUsage = this.buildingTextures.get(source);
        if (!cachedByUsage) {
            cachedByUsage = {};
            this.buildingTextures.set(source, cachedByUsage);
        }
        let cached = cachedByUsage[usage];
        if (cached) return cached;
        cached = {promise: null, texture: null};
        cached.promise = Promise.resolve().then(() => loadBuildingTexture(
            source.encodeDataURI(), usage === 'color'
        )).then(texture => {
            cached.texture = texture;
            return texture;
        }, error => {
            if (cachedByUsage[usage] === cached) delete cachedByUsage[usage];
            if (!Object.keys(cachedByUsage).length) this.buildingTextures.delete(source);
            throw error;
        });
        cachedByUsage[usage] = cached;
        return cached;
    }

    setBuildingMaterialTexture (requestedName, channel, requestedCostume, target) {
        const record = this.getBuildingMaterialRecord(requestedName);
        const costume = this.getCostumeByName(target, requestedCostume);
        if (!costume || !costume.asset || typeof costume.asset.encodeDataURI !== 'function') return;
        const textureKey = `${channel}Texture`;
        const pendingKey = `${channel}TexturePending`;
        const sourceKey = `${channel}TextureSource`;
        const source = costume.asset;
        if (record[sourceKey] === source && record[textureKey]) return;
        if (record[sourceKey] === source && record[pendingKey]) return record[pendingKey];
        const cached = this.getBuildingTexture(costume, channel);
        const version = ++record.textureVersions[channel];
        record[sourceKey] = source;
        if (cached.texture) {
            record[textureKey] = cached.texture;
            this.syncBuildingMaterial(record);
            this.rerenderBuildingScenes();
            return;
        }
        let pending;
        const clearPending = () => {
            if (record[pendingKey] === pending) record[pendingKey] = null;
        };
        pending = cached.promise.then(texture => {
            if (record.textureVersions[channel] !== version || record[sourceKey] !== source) return;
            record[textureKey] = texture;
            this.syncBuildingMaterial(record);
            this.rerenderBuildingScenes();
        });
        record[pendingKey] = pending;
        pending.then(clearPending, clearPending);
        return pending;
    }

    renderBuildingPrimitive (type, args, target) {
        const record = this.getBuildingMaterialRecord(args.MATERIAL);
        const sourceObject = createBuildingPrimitive(type, {
            x1: args.X1,
            x2: args.X2,
            y1: args.Y1,
            y2: args.Y2,
            z1: args.Z1,
            z2: args.Z2
        }, {
            u1: args.U1,
            u2: args.U2,
            v1: args.V1,
            v2: args.V2
        }, record.material);
        const state = this.getTargetState(target);
        state.modelAssetId = null;
        state.modelScene.push({
            materialName: record.name,
            sourceObject,
            transform: this.getModelTransform(target, state)
        });
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

    stampTarget (target) {
        if (!target) return;
        const pen = this.runtime.ext_pen;
        if (pen && typeof pen._stamp === 'function') {
            pen._stamp(target);
            return;
        }
        const stamp = this.runtime._primitives && this.runtime._primitives.pen_stamp;
        if (typeof stamp === 'function') stamp({}, {target});
    }

    cloneObjectDrawConfiguration (configuration) {
        const clone = {
            ...configuration,
            position: {...(configuration.position || {})},
            rotation: {...(configuration.rotation || {})},
            scale: {...(configuration.scale || {})}
        };
        if (configuration.time) clone.time = {...configuration.time};
        return clone;
    }

    applyObjectDrawConfiguration (target, configuration) {
        const position = configuration.position || {};
        const rotation = configuration.rotation || {};
        const scale = configuration.scale || {};
        this.setTargetPosition(target, position.x, position.y, position.z);
        this.setTargetRotation(target, rotation.x, rotation.y, rotation.z);
        this.setTargetScale(target, scale.x, scale.y, scale.z);
        if (typeof target.setSize === 'function') target.setSize(toNumber(configuration.size, 100));

        const graphicEffects = this.runtime.graphicEffectsManager;
        if (graphicEffects && typeof graphicEffects.setScale === 'function') {
            graphicEffects.setScale(target, 'width', configuration.width);
            graphicEffects.setScale(target, 'height', configuration.height);
        }
    }

    finishObjectDraw (target, configuration, source, reapplyConfiguration = false) {
        if (reapplyConfiguration) this.applyObjectDrawConfiguration(target, configuration);
        const state = this.getTargetState(target);
        // Objects video is a Pen source. Keep its drawable available for stamping, but do not leave the
        // unprocessed video visible above the Pen layer where it would cover the grouped Pen FX result.
        state.penOnly = source === 'video' || source === 'shape';
        // Size, per-axis dimensions, and costume changes update Scratch's drawable transform directly.
        // Reapply Movie's shared 3D transform last so draw uses the same position/rotation/scale state as
        // the corresponding Motion and Looks blocks, including Z perspective.
        this.applyProjection(target);
        this.stampTarget(target);
        if (source !== 'model') this.publishFlatZBuffer(target);
    }

    getVideoFrameNumber (video, requestedFrame) {
        const maximumFrame = video.duration > 0 ?
            Math.max(1, Math.floor(video.duration * video.frameRate) + 1) : Number.MAX_SAFE_INTEGER;
        const numericFrame = Number(requestedFrame);
        return Math.round(clamp(Number.isFinite(numericFrame) ? numericFrame : 1, 1, maximumFrame));
    }

    getObjectVideoPlaybackKey (target, configuration = {}) {
        const playbackId = String(configuration.playbackId || configuration.asset || 'video');
        return `${target.id}:${playbackId}`;
    }

    getObjectVideoPlayback (video, configuration, currentTime) {
        if (String(configuration.videoMode || '').toLowerCase() !== 'video') return null;
        const start = configuration.time ?
            toNumber(configuration.time.start, 0) : 0;
        const requestedEnd = configuration.time ?
            toNumber(configuration.time.end, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
        const numericSpeed = Number(configuration.speed);
        const speed = Number.isFinite(numericSpeed) && numericSpeed > 0 ? numericSpeed : 1;
        const videoDuration = toNumber(video && video.duration);
        const mediaEnd = videoDuration > 0 && Number.isFinite(start) ? start + (videoDuration / speed) :
            Number.POSITIVE_INFINITY;
        const end = Math.min(requestedEnd, mediaEnd);
        const mediaTime = Math.max(0, (currentTime - start) * speed);
        return {
            active: currentTime >= start && currentTime < end,
            end,
            frame: this.getVideoFrameNumber(video, (mediaTime * video.frameRate) + 1),
            mediaTime,
            speed,
            start,
            volume: clamp(toNumber(configuration.volume, 100), 0, 100)
        };
    }

    recordObjectVideoAudio (target, video, configuration, playback, currentTime) {
        const volume = playback.volume * this.getProjectVolume();
        if (!this.timeline || !this.timeline.recording || volume <= 0) return;
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        const key = `object-video:${this.getObjectVideoPlaybackKey(target, configuration)}`;
        if (this.playedTimelineSoundBlocks.has(key)) return;
        this.playedTimelineSoundBlocks.add(key);
        this.renderingSoundEvents.push({
            duration: Math.max(0, playback.end - currentTime),
            frame: this.timeline.renderFrameIndex,
            offset: playback.mediaTime,
            playbackRate: playback.speed,
            video,
            volume
        });
    }

    getProjectVolume () {
        const audioEngine = this.runtime && this.runtime.audioEngine;
        const gain = audioEngine && audioEngine.inputNode && audioEngine.inputNode.gain;
        return clamp(toNumber(gain && gain.value, 1), 0, 1);
    }

    setObjectVideoAudioProperties (element, playback) {
        element.muted = false;
        element.volume = (playback.volume / 100) * this.getProjectVolume();
        element.playbackRate = playback.speed;
        // The speed control intentionally changes pitch together with duration.
        if ('preservesPitch' in element) element.preservesPitch = false;
        if ('mozPreservesPitch' in element) element.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in element) element.webkitPreservesPitch = false;
    }

    startObjectVideoAudio (key, entry, playback) {
        if (entry.startPromise) return;
        const version = ++entry.version;
        let ready = Promise.resolve();
        if (entry.element.readyState < 1) ready = once(entry.element, 'loadedmetadata');
        const startPromise = ready.then(() => {
            if (!(this.objectVideoAudio instanceof Map) || this.objectVideoAudio.get(key) !== entry ||
                entry.version !== version) return;
            this.setObjectVideoAudioProperties(entry.element, playback);
            const duration = Number(entry.element.duration);
            const maximumTime = Number.isFinite(duration) ? Math.max(0, duration - 0.001) : playback.mediaTime;
            entry.element.currentTime = clamp(playback.mediaTime, 0, maximumTime);
            const playResult = entry.element.play();
            if (playResult && typeof playResult.then === 'function') return playResult;
        }).catch(error => {
            // A browser may reject autoplay before the user has interacted with the page. Keep video rendering
            // available, and let the next user-initiated timeline playback try the audio again.
            if (error && error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
                this.emit('renderError', error);
            }
        });
        entry.startPromise = startPromise;
        const finish = () => {
            if (entry.startPromise === startPromise) entry.startPromise = null;
        };
        startPromise.then(finish, finish);
    }

    syncObjectVideoAudio (target, video, configuration, playback, currentTime) {
        const key = this.getObjectVideoPlaybackKey(target, configuration);
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        this.objectVideoAudioSeen.add(key);
        if (this.timeline && this.timeline.recording) {
            this.stopObjectVideoAudioEntry(
                key,
                this.objectVideoAudio instanceof Map ? this.objectVideoAudio.get(key) : null
            );
            this.recordObjectVideoAudio(target, video, configuration, playback, currentTime);
            return;
        }
        if (!this.timeline || !this.timeline.playing || typeof document === 'undefined') {
            this.stopObjectVideoAudio(target, configuration);
            return;
        }
        if (!(this.objectVideoAudio instanceof Map)) this.objectVideoAudio = new Map();
        let entry = this.objectVideoAudio.get(key);
        if (entry && entry.assetId !== video.assetId) {
            this.stopObjectVideoAudioEntry(key, entry);
            entry = null;
        }
        if (!entry) {
            const element = document.createElement('audio');
            element.preload = 'auto';
            element.src = video.url;
            entry = {
                assetId: video.assetId,
                element,
                startPromise: null,
                targetId: target.id,
                version: 0
            };
            this.objectVideoAudio.set(key, entry);
        }

        this.setObjectVideoAudioProperties(entry.element, playback);
        if (entry.element.readyState >= 1 && Number.isFinite(Number(entry.element.currentTime)) &&
            Math.abs(Number(entry.element.currentTime) - playback.mediaTime) > 0.15) {
            const duration = Number(entry.element.duration);
            const maximumTime = Number.isFinite(duration) ? Math.max(0, duration - 0.001) : playback.mediaTime;
            entry.element.currentTime = clamp(playback.mediaTime, 0, maximumTime);
        }
        if (entry.element.paused !== false) this.startObjectVideoAudio(key, entry, playback);
    }

    hasDisplayedObjectVideoFrame (state, video, frame) {
        return state.mode === 'video' &&
            state.displayedVideoAssetId === video.assetId &&
            state.displayedFrame === frame &&
            !state.pendingVideoFrame &&
            !state.videoRenderPromise;
    }

    queueObjectDraw (target, configuration) {
        const state = this.getTargetState(target);
        state.objectDrawQueue.push({
            configuration: this.cloneObjectDrawConfiguration(configuration),
            version: state.objectDrawVersion
        });
        if (state.objectDrawPromise) return state.objectDrawPromise;

        const renderPromise = Promise.resolve().then(() => this.renderQueuedObjectDraws(target, state));
        state.objectDrawPromise = renderPromise;
        const finish = () => {
            if (state.objectDrawPromise !== renderPromise) return;
            state.objectDrawPromise = null;
            if (state.objectDrawQueue.length && this.targetStates.get(target.id) === state) {
                this.runWithoutWaiting(this.queueObjectDraw(target, state.objectDrawQueue.shift().configuration));
            }
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    }

    async renderQueuedObjectDraws (target, state) {
        while (state.objectDrawQueue.length && this.targetStates.get(target.id) === state) {
            const request = state.objectDrawQueue.shift();
            if (request.version !== state.objectDrawVersion) continue;
            const configuration = request.configuration;
            const source = String(configuration.source || 'costume').toLowerCase();

            if (source === 'video') {
                const video = this.getVideoByName(target, configuration.asset);
                if (!video) continue;
                const frame = this.getVideoFrameNumber(video, configuration.frame);
                const element = await this.decodeObjectVideoFrame(state, video, frame);
                if (
                    this.targetStates.get(target.id) !== state ||
                    request.version !== state.objectDrawVersion
                ) continue;
                this.applyObjectDrawConfiguration(target, configuration);
                this.applyBitmap(target, element, 'video', null, true);
                state.currentFrame = frame;
                state.videoAssetId = video.assetId;
                state.displayedFrame = frame;
                state.displayedVideoAssetId = video.assetId;
                this.finishObjectDraw(target, configuration, source);
                continue;
            }

            const render = this.performObjectDraw(target, configuration);
            if (render && typeof render.then === 'function') await render;
        }
    }

    async prepareObjectVideoElement (state, video) {
        if (state.objectVideo && state.objectVideoAssetId === video.assetId) return state.objectVideo;
        if (state.objectVideo) {
            state.objectVideo.removeAttribute('src');
            state.objectVideo.load();
        }
        const element = document.createElement('video');
        element.muted = true;
        element.preload = 'auto';
        element.src = video.url;
        if (element.readyState < 1) await once(element, 'loadedmetadata');
        element.width = element.videoWidth;
        element.height = element.videoHeight;
        this.commitObjectVideoElement(state, element, video.assetId);
        return element;
    }

    commitObjectVideoElement (state, element, assetId) {
        state.objectVideo = element;
        state.objectVideoAssetId = assetId;
    }

    async decodeObjectVideoFrame (state, video, frame) {
        const element = await this.prepareObjectVideoElement(state, video);
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

    performObjectDraw (target, configuration) {
        this.applyObjectDrawConfiguration(target, configuration);
        const source = String(configuration.source || 'costume').toLowerCase();
        let render;
        if (source === 'costume') {
            const costumeIndex = typeof target.getCostumeIndexByName === 'function' ?
                target.getCostumeIndexByName(String(configuration.asset)) : -1;
            if (costumeIndex < 0 || typeof target.setCostume !== 'function') return;
            target.setCostume(costumeIndex);
        } else if (source === 'text') {
            this.setText(target, configuration.asset, configuration.text);
            const state = this.getTargetState(target);
            render = state.textRenderPromise;
        } else if (source === 'model') {
            if (!this.getModelByName(target, configuration.asset)) return;
            const state = this.getTargetState(target);
            const frame = Number(configuration.frame);
            state.modelFrame = Number.isFinite(frame) ? Math.max(1, frame) : 1;
            render = this.replaceModelScene(target, configuration.asset);
        } else {
            return;
        }

        const finishDraw = () => this.finishObjectDraw(
            target,
            configuration,
            source,
            Boolean(render && typeof render.then === 'function')
        );
        if (render && typeof render.then === 'function') return render.then(finishDraw);
        finishDraw();
    }

    drawObject (target, configuration = {}) {
        if (!target || target.isStage) return;
        const source = String(configuration.source || 'costume').toLowerCase();
        if (!['costume', 'video', 'text', 'model'].includes(source)) return;
        const playsVideo = source === 'video' && String(configuration.videoMode || '').toLowerCase() === 'video';
        let drawConfiguration = configuration;
        if (playsVideo) {
            const video = this.getVideoByName(target, configuration.asset);
            if (!video) {
                this.stopObjectVideoAudio(target, configuration);
                return;
            }
            const currentTime = this.timeline ? toNumber(this.timeline.currentTime) : 0;
            const playback = this.getObjectVideoPlayback(video, configuration, currentTime);
            if (!playback || !playback.active) {
                this.stopObjectVideoAudio(target, configuration);
                return;
            }
            this.syncObjectVideoAudio(target, video, configuration, playback, currentTime);
            drawConfiguration = {...configuration, frame: playback.frame};
        } else {
            this.stopObjectVideoAudio(target, configuration);
        }
        if (drawConfiguration.time && !playsVideo) {
            const startTime = toNumber(configuration.time.start, Number.NEGATIVE_INFINITY);
            const endTime = toNumber(configuration.time.end, Number.POSITIVE_INFINITY);
            const currentTime = this.timeline ? toNumber(this.timeline.currentTime) : 0;
            if (currentTime < startTime || currentTime > endTime) return;
        }
        if (source === 'video') {
            const video = this.getVideoByName(target, drawConfiguration.asset);
            if (!video) return;
            const state = this.getTargetState(target);
            const frame = this.getVideoFrameNumber(video, drawConfiguration.frame);
            if (!state.objectDrawPromise && this.hasDisplayedObjectVideoFrame(state, video, frame)) {
                this.applyObjectDrawConfiguration(target, drawConfiguration);
                this.finishObjectDraw(target, drawConfiguration, source);
                return;
            }
            return this.queueObjectDraw(target, drawConfiguration);
        }
        const state = this.getTargetState(target);
        if (state.objectDrawPromise) return this.queueObjectDraw(target, drawConfiguration);
        if (source === 'model') return this.queueObjectDraw(target, drawConfiguration);
        return this.performObjectDraw(target, drawConfiguration);
    }

    renderShape (target, configuration = {}) {
        if (!target || target.isStage || !this.runtime.renderer) return;
        const shape = normalizeShapeType(configuration.shape);
        let drawConfiguration = configuration;
        if (shape === 'line') {
            const point1 = configuration.position1 || {};
            const point2 = configuration.position2 || {};
            drawConfiguration = {
                ...configuration,
                position: {
                    x: (toNumber(point1.x) + toNumber(point2.x)) / 2,
                    y: (toNumber(point1.y) + toNumber(point2.y)) / 2,
                    z: (toNumber(point1.z) + toNumber(point2.z)) / 2
                },
                rotation: {x: 0, y: 0, z: 0},
                scale: {x: 1, y: 1, z: 1},
                size: 100
            };
        }

        const shapeConfiguration = shape === 'line' ? drawConfiguration : {...configuration, shape};
        const skinId = this.getShapeSkin(shapeConfiguration);
        if (skinId === null) return;

        const state = this.getTargetState(target);
        state.renderVersion++;
        state.requestedMode = 'shape';
        state.pendingVideoFrame = null;
        state.textQueue.length = 0;
        state.modelRenderVersion++;
        state.modelScene = [];
        state.modelAssetId = null;
        state.mode = 'shape';
        state.penOnly = true;
        state.shapeSkinId = skinId;

        this.applyObjectDrawConfiguration(target, drawConfiguration);
        // Cached procedural skins follow the same cheap stamp path as costume skins. Geometry, color and opacity
        // select the skin; position, rotation and scale only update the drawable transform.
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        this.finishObjectDraw(target, drawConfiguration, 'shape');
        this.trimShapeSkinCache(skinId);
    }

    getShapeSkin (configuration) {
        if (!(this.shapeSkinCache instanceof Map)) {
            this.shapeSkinCache = new Map();
            this.shapeSkinCachePixels = 0;
        }
        const key = getShapeBitmapCacheKey(configuration);
        const cached = this.shapeSkinCache.get(key);
        if (cached) {
            // Map insertion order is the LRU order.
            this.shapeSkinCache.delete(key);
            this.shapeSkinCache.set(key, cached);
            return cached.skinId;
        }

        const bitmap = normalizeShapeType(configuration.shape) === 'line' ?
            createLineBitmap(configuration) : createShapeBitmap(configuration);
        if (!bitmap) return null;
        const skinId = this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION);
        if (skinId === null || typeof skinId === 'undefined') return null;
        const pixels = Math.max(1, toNumber(bitmap.width, 1) * toNumber(bitmap.height, 1));
        this.shapeSkinCache.set(key, {pixels, skinId});
        this.shapeSkinCachePixels += pixels;
        return skinId;
    }

    trimShapeSkinCache (currentSkinId) {
        if (!(this.shapeSkinCache instanceof Map)) return;
        const activeSkinIds = new Set([currentSkinId]);
        for (const state of this.targetStates.values()) {
            if (state.mode === 'shape' && state.shapeSkinId !== null) activeSkinIds.add(state.shapeSkinId);
        }
        while (
            this.shapeSkinCache.size > MAX_CACHED_SHAPE_SKINS ||
            this.shapeSkinCachePixels > MAX_CACHED_SHAPE_SKIN_PIXELS
        ) {
            let evictedKey = null;
            let evicted = null;
            for (const [key, entry] of this.shapeSkinCache) {
                if (!activeSkinIds.has(entry.skinId)) {
                    evictedKey = key;
                    evicted = entry;
                    break;
                }
            }
            if (!evicted) return;
            this.shapeSkinCache.delete(evictedKey);
            this.shapeSkinCachePixels -= evicted.pixels;
            if (typeof this.runtime.renderer.destroySkin === 'function') {
                this.runtime.renderer.destroySkin(evicted.skinId);
            }
        }
    }

    drawShape (target, configuration = {}) {
        if (!target || target.isStage) return;
        if (configuration.time) {
            const startTime = toNumber(configuration.time.start, Number.NEGATIVE_INFINITY);
            const endTime = toNumber(configuration.time.end, Number.POSITIVE_INFINITY);
            const currentTime = this.timeline ? toNumber(this.timeline.currentTime) : 0;
            if (currentTime < startTime || currentTime > endTime) return;
        }
        return this.renderShape(target, configuration);
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
            if (item.sourceObject) {
                return {
                    animationName: '',
                    frame: 1,
                    sourceObject: item.sourceObject,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                };
            }
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
            const renderArguments = [cachedItems, this.camera, this.getStageSize(), BITMAP_RESOLUTION];
            if (Array.isArray(this.lights)) renderArguments.push(this.lights);
            const canvas = this.modelRenderer.renderWorldScene(...renderArguments);
            this.applyBitmap(target, canvas, 'model');
            this.publishModelZBuffer(target);
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
                    sourceObject: item.sourceObject,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                }));
                const loadedItems = await Promise.all(sceneItems.map(async item => {
                    if (item.sourceObject) {
                        return {
                            animationName: '',
                            frame: 1,
                            sourceObject: item.sourceObject,
                            transform: item.transform
                        };
                    }
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
                const renderArguments = [
                    loadedItems.filter(Boolean),
                    this.camera,
                    this.getStageSize(),
                    BITMAP_RESOLUTION
                ];
                if (Array.isArray(this.lights)) renderArguments.push(this.lights);
                const canvas = this.modelRenderer.renderWorldScene(...renderArguments);
                this.applyBitmap(target, canvas, 'model');
                this.publishModelZBuffer(target);
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

    publishModelZBuffer (target) {
        if (!this.modelRenderer || typeof this.modelRenderer.getDepthBuffer !== 'function') return;
        const depthBuffer = this.modelRenderer.getDepthBuffer();
        if (!depthBuffer) return;
        const published = {
            ...depthBuffer,
            targetId: target && target.id
        };
        this.runtime.movieZBuffer = published;
        const state = target && this.targetStates.get(target.id);
        if (state) state.zBuffer = published;
    }

    publishFlatZBuffer (target) {
        if (!target) return;
        const state = this.getTargetState(target);
        const camera = this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        const depth = state.ignoreCamera ? state.worldZ : projectPosition({
            x: state.worldX,
            y: state.worldY,
            z: state.worldZ
        }, camera).depth;
        if (!Number.isFinite(depth) || depth <= 0) return;
        this.flatDepthVersion = (Number(this.flatDepthVersion) || 0) + 1;
        const published = {
            flatDepth: depth,
            targetId: target.id,
            version: this.flatDepthVersion
        };
        this.runtime.movieZBuffer = published;
        state.zBuffer = published;
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

    async addCostumesFromFile (targetId, file) {
        const {costumeUpload} = await import('./file-uploader');
        const data = await readFile(file);
        return new Promise((resolve, reject) => {
            const handleError = error => reject(normalizeImportError(error));
            try {
                costumeUpload(
                    copyArrayBuffer(data),
                    getImportMimeType(file),
                    this.vm,
                    costumes => {
                        const baseName = getName(file.name);
                        Promise.all(costumes.map((costume, index) => {
                            costume.name = `${baseName}${index ? index + 1 : ''}`;
                            return Promise.resolve(this.vm.addCostume(costume.md5, costume, targetId));
                        })).then(() => resolve(costumes), handleError);
                    },
                    handleError
                );
            } catch (error) {
                handleError(error);
            }
        });
    }

    async addSoundFromFile (targetId, file) {
        const {soundUpload} = await import('./file-uploader');
        const data = await readFile(file);
        return new Promise((resolve, reject) => {
            const handleError = error => reject(normalizeImportError(error));
            try {
                soundUpload(
                    data,
                    getImportMimeType(file),
                    this.runtime.storage,
                    sound => {
                        sound.name = getName(file.name);
                        Promise.resolve(this.vm.addSound(sound, targetId)).then(() => resolve(sound), handleError);
                    },
                    handleError
                );
            } catch (error) {
                handleError(error);
            }
        });
    }

    async importFiles (targetId, files, options = {}) {
        const selectedFiles = Array.from(files || []);
        if (!selectedFiles.length) return [];

        const extensions = selectedFiles.map(file => getExtension(file.name));
        const modelSourceFiles = selectedFiles.filter(file => MODEL_SOURCE_EXTENSIONS.includes(
            getExtension(file.name)
        ));
        const modelFiles = modelSourceFiles.length ? selectedFiles.filter(file => MODEL_SUPPORT_EXTENSIONS.concat(
            MODEL_SOURCE_EXTENSIONS
        ).includes(getExtension(file.name))) : [];
        const consumedModelFiles = new Set(modelFiles);
        const supportedExtensions = new Set([
            ...Object.keys(MIME_TYPES),
            ...COSTUME_EXTENSIONS,
            ...SOUND_EXTENSIONS,
            ...FONT_EXTENSIONS,
            ...MOTION_EXTENSIONS
        ]);
        const unsupported = selectedFiles.filter((file, index) => (
            !consumedModelFiles.has(file) && !supportedExtensions.has(extensions[index])
        ));
        if (unsupported.length) {
            throw new Error(`Unsupported file type: ${getExtension(unsupported[0].name) || 'unknown'}.`);
        }

        const imported = [];
        if (modelSourceFiles.length) {
            const models = await this.addModelsFromFiles(targetId, modelFiles);
            imported.push(...models.map(model => ({
                name: model.name,
                source: 'model'
            })));
        }

        const motionFiles = selectedFiles.filter(file => MOTION_EXTENSIONS.includes(getExtension(file.name)));
        if (motionFiles.length) {
            const models = this.getModels(targetId);
            const requestedModel = options.modelName && models.find(model => model.name === options.modelName);
            const modelIndex = requestedModel ? models.indexOf(requestedModel) : models.length - 1;
            const model = await this.addModelMotionsFromFiles(targetId, modelIndex, motionFiles);
            imported.push({name: model.name, source: 'model'});
        }

        for (const file of selectedFiles) {
            const extension = getExtension(file.name);
            if (consumedModelFiles.has(file) || MOTION_EXTENSIONS.includes(extension)) continue;
            if (Object.prototype.hasOwnProperty.call(MIME_TYPES, extension)) {
                const video = await this.addVideoFromFile(targetId, file);
                imported.push({name: video.name, source: 'video'});
            } else if (FONT_EXTENSIONS.includes(extension)) {
                const name = await this.addFontFromFile(file);
                imported.push({name, source: 'text'});
            } else if (COSTUME_EXTENSIONS.includes(extension)) {
                const costumes = await this.addCostumesFromFile(targetId, file);
                imported.push(...costumes.map(costume => ({
                    name: costume.name,
                    source: 'costume'
                })));
            } else if (SOUND_EXTENSIONS.includes(extension)) {
                const sound = await this.addSoundFromFile(targetId, file);
                imported.push({name: sound.name, source: 'sound'});
            }
        }

        return imported;
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
                objectDrawPromise: null,
                objectDrawQueue: [],
                objectDrawVersion: 0,
                objectVideo: null,
                objectVideoAssetId: null,
                penOnly: false,
                pendingVideoFrame: null,
                renderVersion: 0,
                rotation: {x: 0, y: 0, z: 90 - (target.direction || 90)},
                rotationOrder: 'XYZ',
                scale: {x: 1, y: 1, z: 1},
                requestedMode: 'costume',
                shapeSkinId: null,
                skinId: null,
                textQueue: [],
                textRenderPromise: null,
                video: null,
                videoAssetId: null,
                videoElementAssetId: null,
                videoRenderPromise: null,
                worldX: toNumber(target.x),
                worldY: toNumber(target.y),
                worldZ: DEFAULT_DEPTH,
                zBuffer: null
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
        this.applyProjection(target);
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
            this.runtime.renderer.updateDrawableVisible(target.drawableID, target.visible && !state.penOnly);
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
        const cameraRotationZ = state.ignoreCamera ? 0 :
            toNumber(this.camera && this.camera.rotation && this.camera.rotation.z);
        const direction = state.mode === 'model' ? 90 : 90 - state.rotation.z + cameraRotationZ;
        const renderedScale = typeof target._getRenderedDirectionAndScale === 'function' ?
            target._getRenderedDirectionAndScale().scale : [target.size, target.size];
        const perspective = Math.abs(projection.perspective);
        this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, direction, [
            renderedScale[0] * state.scale.x * perspective,
            renderedScale[1] * state.scale.y * perspective
        ]);
        this.applySpritePlaneMatrix(target, state, renderedScale);
        this.runtime.renderer.updateDrawableVisible(
            target.drawableID,
            target.visible && projection.inFront && !state.penOnly
        );
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
    }

    applySpritePlaneMatrix (target, state, renderedScale) {
        const renderer = this.runtime.renderer;
        const drawable = renderer && renderer._allDrawables && renderer._allDrawables[target.drawableID];
        if (!drawable || !drawable.skin || typeof drawable.getUniforms !== 'function') return;
        const camera = state.ignoreCamera ? {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        } : (this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        });
        const matrix = spritePlaneMatrix({
            position: {
                x: state.worldX,
                y: state.worldY,
                z: state.ignoreCamera ? DEFAULT_FOCAL_LENGTH : state.worldZ
            },
            rotation: state.rotation,
            rotationOrder: state.rotationOrder,
            scale: state.scale
        }, camera, drawable.skin.size, drawable.skin.rotationCenter, renderedScale);
        const uniforms = drawable.getUniforms();
        if (!uniforms || !uniforms.u_modelMatrix) return;
        uniforms.u_modelMatrix.set(matrix);
        drawable._inverseTransformDirty = true;
        drawable._transformedHullDirty = true;
    }

    switchVideo (target, requestedVideo) {
        const video = this.getVideoByName(target, requestedVideo);
        if (!video) return;
        return this.queueVideoFrame(target, video, 1);
    }

    renderVideo (target, requestedVideo, requestedFrame) {
        const video = this.getVideoByName(target, requestedVideo);
        if (!video) return Promise.resolve();
        const frame = Number(requestedFrame);
        return this.queueVideoFrame(target, video, Number.isFinite(frame) ? frame : 1) || Promise.resolve();
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
            state.penOnly = false;
            this.applyProjection(target);
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

    applyBitmap (target, bitmap, mode, rotationCenter, penOnly = false) {
        const state = this.getTargetState(target);
        const hasRotationCenter = rotationCenter !== null && typeof rotationCenter !== 'undefined';
        if (state.skinId === null) {
            state.skinId = !hasRotationCenter ?
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION) :
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION, rotationCenter);
        } else if (!hasRotationCenter) {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION);
        } else {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION, rotationCenter);
        }
        state.mode = mode;
        state.penOnly = penOnly;
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
        state.penOnly = false;
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
        const skinId = state && state.mode === 'shape' ? state.shapeSkinId : state && state.skinId;
        if (state && state.mode !== 'costume' && skinId !== null && this.runtime.renderer) {
            this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        }
        if (state) this.applyProjection(target);
    }

    destroyTargetState (target) {
        const state = this.targetStates.get(target.id);
        if (!state) return;
        if (this.objectVideoAudio instanceof Map) {
            for (const [key, playback] of this.objectVideoAudio) {
                if (playback.targetId === target.id) this.stopObjectVideoAudioEntry(key, playback);
            }
        }
        state.renderVersion++;
        state.requestedMode = 'costume';
        state.textQueue.length = 0;
        state.pendingVideoFrame = null;
        state.objectDrawQueue.length = 0;
        state.objectDrawVersion++;
        state.modelRenderVersion++;
        if (state.video) {
            state.video.removeAttribute('src');
            state.video.load();
        }
        if (state.objectVideo) {
            state.objectVideo.removeAttribute('src');
            state.objectVideo.load();
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
