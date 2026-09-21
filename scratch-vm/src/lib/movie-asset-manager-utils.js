import {
    BITMAP_RESOLUTION,
    IMPORT_MIME_TYPES,
    KEYFRAME_TIME_EPSILON,
    TIMELINE_DEFAULT_DURATION
} from './movie-asset-manager-constants';
import {ROTATION_ORDERS} from 'scratch-render/src/model-runtime';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const canvasToBlob = (canvas, type = 'image/png') => new Promise((resolve, reject) => {
    if (!canvas) {
        reject(new Error('Rendering frame is not available.'));
        return;
    }
    if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Could not encode the rendering frame.'));
        }, type);
        return;
    }
    try {
        const dataUrl = canvas.toDataURL(type);
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        resolve(new Blob([bytes], {type}));
    } catch (error) {
        reject(error);
    }
});

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

const getCostumeAssetId = costume => (
    typeof costume === 'string' ? costume : costume && (costume.assetId || costume.name)
);

const normalizeCostumeGroup = (group, fallbackName = 'Costume group') => {
    const source = group || {};
    const members = Array.isArray(source.costumeAssetIds) ? source.costumeAssetIds : source.costumes;
    const costumeAssetIds = Array.from(new Set(
        (Array.isArray(members) ? members : [])
            .map(getCostumeAssetId)
            .filter(Boolean)
            .map(String)
    ));
    return {
        costumeAssetIds,
        name: String(source.name || fallbackName)
    };
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const normalizeTimelineKeyframes = (keyframes, duration = TIMELINE_DEFAULT_DURATION) => {
    const maximum = Math.max(0, toNumber(duration, TIMELINE_DEFAULT_DURATION));
    return (Array.isArray(keyframes) ? keyframes : [])
        .map(time => clamp(toNumber(time, NaN), 0, maximum))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .filter((time, index, result) => (
            index === 0 || Math.abs(time - result[index - 1]) > KEYFRAME_TIME_EPSILON
        ));
};

const normalizeRotationOrder = value => {
    const order = String(value || '').toUpperCase();
    return ROTATION_ORDERS.includes(order) ? order : 'XYZ';
};

// Shared time-window gate for object and shape draws. Missing bounds stay unbounded.
const isWithinTimeWindow = (timeWindow, currentTime) => {
    if (!timeWindow) return true;
    const startTime = toNumber(timeWindow.start, Number.NEGATIVE_INFINITY);
    const endTime = toNumber(timeWindow.end, Number.POSITIVE_INFINITY);
    return currentTime >= startTime && currentTime <= endTime;
};

const normalizeScale = (value, fallback = 1) => Math.max(0, toNumber(value, fallback));

const cloneScale = scale => ({
    x: normalizeScale(scale && scale.x),
    y: normalizeScale(scale && scale.y),
    z: normalizeScale(scale && scale.z)
});

const cloneCamera = camera => {
    if (!camera) return null;
    const clone = {...camera};
    if (camera.position) clone.position = {...camera.position};
    if (camera.rotation) clone.rotation = {...camera.rotation};
    return clone;
};

export {
    BITMAP_RESOLUTION,
    MODEL_SUPPORT_EXTENSIONS,
    MODEL_TEXTURE_FORMATS,
    canvasToBlob,
    clamp,
    cloneCamera,
    cloneScale,
    copyArrayBuffer,
    escapeRegExp,
    getCostumeAssetId,
    getExtension,
    getImportMimeType,
    getModelResourcePath,
    getName,
    getOriginalTarget,
    getUploadPath,
    getVideoMetadata,
    isWithinTimeWindow,
    normalizeCostumeGroup,
    normalizeImportError,
    normalizeRotationOrder,
    normalizeScale,
    normalizeTimelineKeyframes,
    now,
    once,
    readFile,
    toNumber,
    unusedName,
    wait
};
