import EventEmitter from 'events';
import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';

import {MOVIE_ASSET_BLOCKS, markMovieProject} from './project-format';

const VIDEO_FRAME_RATE = 30;
const BITMAP_RESOLUTION = 2;
const VIDEO_PROJECT_KEY = 'movieVideos';
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

class MovieAssetManager extends EventEmitter {
    constructor (vm) {
        super();
        this.vm = vm;
        this.runtime = vm.runtime;
        this.videos = new Map();
        this.targetStates = new Map();
        this.fontFaces = new Map();

        this.handleTargetCreated = this.handleTargetCreated.bind(this);
        this.handleTargetRemoved = this.handleTargetRemoved.bind(this);
        this.handleFontsChanged = this.handleFontsChanged.bind(this);

        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.fontManager.on('change', this.handleFontsChanged);
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

        for (const opcode of MOVIE_ASSET_BLOCKS) {
            if (!compatBlocks.stacked.includes(opcode)) compatBlocks.stacked.push(opcode);
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
            return JSON.stringify(markMovieProject(json));
        };

        const originalSerializeAssets = this.vm.serializeAssets.bind(this.vm);
        this.vm.serializeAssets = targetId => originalSerializeAssets(targetId).concat(
            this.serializeAssets(targetId)
        );

        const originalDeserializeProject = this.vm.deserializeProject.bind(this.vm);
        this.vm.deserializeProject = async (projectJSON, zip) => {
            const videoPromise = this.deserializeVideos(projectJSON[VIDEO_PROJECT_KEY], zip);
            const result = await originalDeserializeProject(projectJSON, zip);
            this.replaceVideos(await videoPromise);
            this.runtime.targets.forEach(target => this.patchTarget(target));
            return result;
        };
    }

    patchTarget (target) {
        if (!target || target.__movieAssetsPatched) return;
        target.__movieAssetsPatched = true;

        const originalSetCostume = target.setCostume.bind(target);
        target.setCostume = index => {
            const result = originalSetCostume(index);
            this.showCostume(target, false);
            return result;
        };

        const originalUpdateAll = target.updateAllDrawableProperties.bind(target);
        target.updateAllDrawableProperties = () => {
            const result = originalUpdateAll();
            this.restoreCustomSkin(target);
            return result;
        };
    }

    handleTargetCreated (target) {
        this.patchTarget(target);
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
                pendingVideoFrame: null,
                renderVersion: 0,
                requestedMode: 'costume',
                skinId: null,
                textQueue: [],
                textRenderPromise: null,
                video: null,
                videoAssetId: null,
                videoElementAssetId: null,
                videoRenderPromise: null
            };
            this.targetStates.set(target.id, state);
        }
        return state;
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

    applyBitmap (target, bitmap, mode) {
        const state = this.getTargetState(target);
        if (state.skinId === null) {
            state.skinId = this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION);
        } else {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION);
        }
        state.mode = mode;
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, state.skinId);
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
        state.mode = 'costume';
        if (updateRenderer && this.runtime.renderer) {
            const costume = target.getCostumes()[target.currentCostume];
            if (costume) this.runtime.renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
            if (target.visible) {
                target.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
    }

    restoreCustomSkin (target) {
        const state = this.targetStates.get(target.id);
        if (state && state.mode !== 'costume' && state.skinId !== null && this.runtime.renderer) {
            this.runtime.renderer.updateDrawableSkinId(target.drawableID, state.skinId);
        }
    }

    destroyTargetState (target) {
        const state = this.targetStates.get(target.id);
        if (!state) return;
        state.renderVersion++;
        state.requestedMode = 'costume';
        state.textQueue.length = 0;
        state.pendingVideoFrame = null;
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
