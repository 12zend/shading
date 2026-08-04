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
    cameraLookAt,
    convertModelToGLB,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    normalizeFOV,
    projectPosition
} from './model-runtime';

const VIDEO_FRAME_RATE = 30;
const BITMAP_RESOLUTION = 2;
const VIDEO_PROJECT_KEY = 'movieVideos';
const MODEL_PROJECT_KEY = 'movieModels';
const CAMERA_PROJECT_KEY = 'movieCamera';
const TRANSFORM_PROJECT_KEY = 'movie3D';
const MIME_TYPES = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    webm: 'video/webm'
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
        this.modelRenderer = null;
        const [stageWidth, stageHeight] = this.getStageSize();
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

        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.fontManager.on('change', this.handleFontsChanged);
        if (this.runtime.renderer && typeof this.runtime.renderer.on === 'function') {
            this.runtime.renderer.on('NativeSizeChanged', this.handleNativeSizeChanged);
        }
        this.runtime.targets.forEach(target => this.patchTarget(target));

        this.installPrimitives();
        this.installSerializationHooks();
        this.syncFontFaces();
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
        // Clear scene returns its promise so a following pen stamp cannot run before the 3D frame is ready.
        primitives.looks_clearscene = (args, util) => this.clearModelScene(util.target);
        // Model rendering can take longer than a VM step. Keep the current frame visible while it is prepared.
        primitives.looks_rendermodel = (args, util) => {
            this.runWithoutWaiting(this.renderModelToScene(util.target, args.MODEL));
        };
        // Keep old projects working. The legacy switch block replaces the scene instead of accumulating into it.
        primitives.looks_switchmodelto = (args, util) => this.replaceModelScene(util.target, args.MODEL);

        const goToXYZ = (args, util) => this.setTargetPosition(
            util.target,
            args.X,
            args.Y,
            typeof args.Z === 'undefined' ? this.getTargetState(util.target).worldZ : args.Z
        );
        primitives.motion_gotoxy = goToXYZ;
        primitives.motion_gotoxyz = goToXYZ;
        primitives.motion_changexby = (args, util) => this.changeTargetPosition(util.target, 'x', args.DX);
        primitives.motion_setx = (args, util) => this.setTargetAxis(util.target, 'x', args.X);
        primitives.motion_changeyby = (args, util) => this.changeTargetPosition(util.target, 'y', args.DY);
        primitives.motion_sety = (args, util) => this.setTargetAxis(util.target, 'y', args.Y);
        primitives.motion_changezby = (args, util) => this.changeTargetPosition(util.target, 'z', args.DZ);
        primitives.motion_setz = (args, util) => this.setTargetAxis(util.target, 'z', args.Z);
        primitives.motion_setrotation = (args, util) => this.setTargetRotation(
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
            const videoPromise = this.deserializeVideos(projectJSON[VIDEO_PROJECT_KEY], zip);
            const modelPromise = this.deserializeModels(projectJSON[MODEL_PROJECT_KEY], zip);
            const transformDescriptors = this.readTransformDescriptors(projectJSON);
            const cameraDescriptor = projectJSON[CAMERA_PROJECT_KEY];
            const result = await originalDeserializeProject(projectJSON, zip);
            this.replaceVideos(await videoPromise);
            this.replaceModels(await modelPromise);
            this.restoreCamera(cameraDescriptor);
            this.runtime.targets.forEach(target => this.patchTarget(target));
            this.restoreTransforms(transformDescriptors);
            this.applyCamera();
            return result;
        };
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
                state.rotationOrder = sourceState.rotationOrder;
                state.modelAssetId = sourceState.modelAssetId;
                state.modelScene = sourceState.modelScene.map(item => ({
                    assetId: item.assetId,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation}
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
        const supportedFiles = files.filter(file => ['glb', 'fbx', 'obj', 'mtl'].includes(getExtension(file.name)));
        const materialFiles = supportedFiles.filter(file => getExtension(file.name) === 'mtl');
        const sourceFiles = supportedFiles.filter(file => getExtension(file.name) !== 'mtl');
        if (!sourceFiles.length) throw new Error('Choose a GLB, FBX, or OBJ file. MTL files accompany OBJ files.');

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
            const converted = await convertModelToGLB(sourceFormat, data, mtlData);
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
                animationCount: converted.animationCount,
                asset,
                assetId: asset.assetId,
                dataFormat: 'glb',
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
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
        this.emit('modelsChanged', targetId);
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

    getModelTransform (target, state = this.getTargetState(target)) {
        return {
            rotation: {...state.rotation},
            rotationOrder: state.rotationOrder,
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
        return this.queueModelSceneRender(target);
    }

    // Internal compatibility alias used by project restoration and older UI integrations.
    switchModel (target, requestedModel) {
        return this.replaceModelScene(target, requestedModel);
    }

    queueModelSceneRender (target) {
        const state = this.getTargetState(target);
        state.modelRenderVersion++;
        const version = state.modelRenderVersion;
        const sceneItems = state.modelScene.map(item => ({
            assetId: item.assetId,
            transform: {
                ...item.transform,
                rotation: {...item.transform.rotation}
            }
        }));
        const renderPromise = Promise.resolve().then(async () => {
            const loadedItems = await Promise.all(sceneItems.map(async item => {
                const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
                if (!model) return null;
                return {
                    sourceObject: await this.getModelObject(model),
                    transform: item.transform
                };
            }));
            if (
                this.targetStates.get(target.id) !== state ||
                state.modelRenderVersion !== version ||
                state.requestedMode !== 'model'
            ) return;
            if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
            const canvas = this.modelRenderer.renderWorldScene(
                loadedItems.filter(Boolean),
                this.camera,
                this.getStageSize(),
                BITMAP_RESOLUTION
            );
            this.applyBitmap(target, canvas, 'model');
            this.applyProjection(target);
        });
        state.modelRenderPromise = renderPromise;
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
        return this.queueModelSceneRender(target);
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
        });
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
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
        this.emit('videosChanged', targetId);
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
                mode: 'costume',
                modelAssetId: null,
                modelScene: [],
                modelRenderPromise: null,
                modelRenderVersion: 0,
                pendingVideoFrame: null,
                renderVersion: 0,
                rotation: {x: 0, y: 0, z: 90 - (target.direction || 90)},
                rotationOrder: 'XYZ',
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
        state.worldZ = toNumber(z, state.worldZ);
        this.setTargetXY(target, x, y);
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
        const projection = projectPosition({
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
                        rotation: {...item.transform.rotation}
                    }
                };
            }).filter(Boolean) : [];
            const selectedModel = modelScene.length === 1 ? modelScene[0].model : null;
            const isDefault = state.worldZ === DEFAULT_DEPTH && state.rotation.x === 0 && state.rotation.y === 0 &&
                state.rotationOrder === 'XYZ' && !modelScene.length;
            if (isDefault) return;
            const serializedTarget = serializedTargets[index];
            if (!serializedTarget) return;
            serializedTarget[TRANSFORM_PROJECT_KEY] = {
                rotation: {...state.rotation},
                rotationOrder: state.rotationOrder,
                scene: modelScene,
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
            state.worldX = target.x;
            state.worldY = target.y;
            state.worldZ = toNumber(transform.z, DEFAULT_DEPTH);
            state.rotation = {
                x: toNumber(transform.rotation && transform.rotation.x),
                y: toNumber(transform.rotation && transform.rotation.y),
                z: toNumber(transform.rotation && transform.rotation.z, 90 - target.direction)
            };
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
                    animationCount: model.animationCount,
                    isStage: target.isStage,
                    md5ext: `${model.assetId}.glb`,
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
                    animationCount: toNumber(descriptor.animationCount),
                    asset,
                    assetId,
                    dataFormat: 'glb',
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
