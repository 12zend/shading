import {
    COSTUME_EXTENSIONS,
    FONT_EXTENSIONS,
    MIME_TYPES,
    MODEL_SOURCE_EXTENSIONS,
    MOTION_EXTENSIONS,
    SOUND_EXTENSIONS,
    VIDEO_FRAME_RATE,
    BITMAP_RESOLUTION
} from './movie-asset-manager-constants';
import {
    clamp,
    copyArrayBuffer,
    getExtension,
    getImportMimeType,
    getName,
    getOriginalTarget,
    getVideoMetadata,
    MODEL_SUPPORT_EXTENSIONS,
    normalizeImportError,
    once,
    readFile,
    unusedName
} from './movie-asset-manager-utils';

const MovieAssetManagerMediaMethods = {
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
    },

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
    },

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
    },

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
    },

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
    },

    deleteFont (index) {
        this.runtime.fontManager.deleteFont(index);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    },

    reorderFont (oldIndex, newIndex) {
        const fonts = this.runtime.fontManager.fonts;
        if (!fonts[oldIndex]) return;
        const [font] = fonts.splice(oldIndex, 1);
        fonts.splice(clamp(newIndex, 0, fonts.length), 0, font);
        this.runtime.fontManager.updateRenderer();
        this.runtime.fontManager.changed();
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    },

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
    },

    renameVideo (targetId, index, requestedName) {
        const videos = this.getVideos(targetId).slice();
        if (!videos[index]) return '';
        const usedNames = videos.filter((item, itemIndex) => itemIndex !== index).map(item => item.name);
        const newName = unusedName(requestedName.trim() || 'video', usedNames);
        videos[index].name = newName;
        this.videos.set(targetId, videos);
        this.changed(targetId);
        return newName;
    },

    reorderVideo (targetId, oldIndex, newIndex) {
        const videos = this.getVideos(targetId).slice();
        if (!videos[oldIndex]) return;
        const [video] = videos.splice(oldIndex, 1);
        videos.splice(clamp(newIndex, 0, videos.length), 0, video);
        this.videos.set(targetId, videos);
        this.changed(targetId);
    },

    changed (targetId) {
        this.emit('videosChanged', targetId);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    },

    getVideoByName (target, requestedVideo) {
        const videos = this.getVideos(target);
        if (!videos.length) return null;
        if (typeof requestedVideo === 'number' || /^\s*\d+\s*$/.test(String(requestedVideo))) {
            const index = Number(requestedVideo) - 1;
            return videos[clamp(index, 0, videos.length - 1)];
        }
        return videos.find(video => video.name === String(requestedVideo)) || videos[0];
    },

    switchVideo (target, requestedVideo) {
        const video = this.getVideoByName(target, requestedVideo);
        if (!video) return;
        return this.queueVideoFrame(target, video, 1);
    },

    renderVideo (target, requestedVideo, requestedFrame) {
        const video = this.getVideoByName(target, requestedVideo);
        if (!video) return Promise.resolve();
        const frame = Number(requestedFrame);
        return this.queueVideoFrame(target, video, Number.isFinite(frame) ? frame : 1) || Promise.resolve();
    },

    setVideoFrame (target, requestedFrame) {
        const state = this.getTargetState(target);
        const videos = this.getVideos(target);
        const video = videos.find(item => item.assetId === state.videoAssetId) || videos[0];
        if (!video) return;
        const frame = Number(requestedFrame);
        return this.queueVideoFrame(target, video, Number.isFinite(frame) ? frame : 1);
    },

    changeVideoFrame (target, change) {
        const state = this.getTargetState(target);
        const amount = Number(change);
        return this.setVideoFrame(target, state.currentFrame + (Number.isFinite(amount) ? amount : 0));
    },

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
    },

    commitVideoElement (state, element, assetId) {
        state.video = element;
        state.videoElementAssetId = assetId;
    },

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
    },

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
    },

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
    },

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
    },

    getFont (requestedFont) {
        const fonts = this.runtime.fontManager.getFonts();
        const requested = String(requestedFont || 'sans-serif');
        return fonts.find(font => font.name.toLowerCase() === requested.toLowerCase()) || {
            family: requested,
            name: requested
        };
    },

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
    },

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
    },

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
    },

    createTextCanvas (font, text) {
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
        return canvas;
    },

    renderText (target, font, text) {
        const canvas = this.createTextCanvas(font, text);
        this.applyBitmap(target, canvas, 'text');
    },

    applyBitmap (target, bitmap, mode, rotationCenter, penOnly = false) {
        const state = this.getTargetState(target);
        const hasRotationCenter = rotationCenter !== null && typeof rotationCenter !== 'undefined';
        if (state.skinId === null) {
            state.skinId = hasRotationCenter ?
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION, rotationCenter) :
                this.runtime.renderer.createBitmapSkin(bitmap, BITMAP_RESOLUTION);
        } else if (hasRotationCenter) {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION, rotationCenter);
        } else {
            this.runtime.renderer.updateBitmapSkin(state.skinId, bitmap, BITMAP_RESOLUTION);
        }
        state.mode = mode;
        state.penOnly = penOnly;
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, state.skinId);
        this.applyProjection(target);
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
    },

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
    },

    restoreCustomSkin (target) {
        const state = this.targetStates.get(target.id);
        const skinId = state && state.mode === 'shape' ? state.shapeSkinId : state && state.skinId;
        if (state && state.mode !== 'costume' && skinId !== null && this.runtime.renderer) {
            this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        }
        if (state) this.applyProjection(target);
    },

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
};

export default MovieAssetManagerMediaMethods;
