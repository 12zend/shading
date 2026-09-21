const MovieTexture = require('./MovieTexture');
const {ModelRenderer} = require('./model-runtime-renderer');
const {createShapeBitmap, createLineBitmap, getShapeBitmapCacheKey, normalizeShapeType} =
    require('./MovieShapeSource');
const MovieTextSource = require('./MovieTextSource');

const instances = new WeakMap();

/** Renderer-owned source generation and upload. All ready-source submissions are synchronous. */
class MovieSourceRenderer {
    constructor (renderer) {
        this.renderer = renderer;
        this.text = new MovieTextSource();
        this.texts = new Map();
        this.model = null;
        this.images = new Map();
        this.images.pixels = 0;
        this.dynamicImages = new Map();
        this.texts.pixels = 0;
    }

    static forRenderer (renderer) {
        let instance = instances.get(renderer);
        if (!instance) {
            instance = new MovieSourceRenderer(renderer);
            instances.set(renderer, instance);
        }
        return instance;
    }

    trimText (active, clear = false) {
        this.trimCache(this.texts, new Set(active), clear ? 0 : 1024, 16 * 1024 * 1024);
    }

    static createPreview (canvas) {
        return new ModelRenderer(canvas);
    }

    copyBitmapToCanvas (bitmap) {
        const width = Math.max(1, Number(bitmap && (bitmap.videoWidth || bitmap.naturalWidth || bitmap.width)) || 1);
        const height = Math.max(
            1,
            Number(bitmap && (bitmap.videoHeight || bitmap.naturalHeight || bitmap.height)) || 1
        );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create an Objects scene image.');
        context.drawImage(bitmap, 0, 0, width, height);
        canvas.reusable = false;
        return canvas;
    }

    getModelRenderer () {
        if (!this.model) {
            this.model = new ModelRenderer();
        }
        return this.model;
    }

    prepare (request) {
        const kind = request.kind;
        let key;
        if (kind === 'shape' || kind === 'line') {
            key = `shape:${getShapeBitmapCacheKey(request.configuration)}`;
        } else if (kind === 'text') {
            key = `text:${request.font.name}\0${request.font.family}\0${request.text}`;
        } else if (kind === 'costume') {
            const skin = this.renderer._allSkins[request.skinId];
            if (!skin) return null;
            const texture = skin.getMaximumTexture();
            if (!texture) return null;
            return {
                texture,
                size: skin.size,
                rotationCenter: skin.rotationCenter,
                // Maximum SVG rasters are sampled smoothly when projected down or rotated.
                nearest: typeof skin._maxTextureScale !== 'number'
            };
        }
        if (key && this.images.has(key)) {
            const hit = this.images.get(key);
            this.images.delete(key);
            this.images.set(key, hit);
            return hit;
        }
        let bitmap = request.bitmap;
        let resolution = request.resolution || 2;
        if (kind === 'shape' || kind === 'line') {
            bitmap = normalizeShapeType(request.configuration.shape) === 'line' ?
                createLineBitmap(request.configuration) : createShapeBitmap(request.configuration);
            if (!bitmap) return null;
            resolution = bitmap.movieBitmapResolution || 2;
        } else if (kind === 'text') {
            bitmap = this.text.createTextCanvas(request.font, request.text);
            resolution = bitmap.movieBitmapResolution || 4;
        } else if (kind === 'model') {
            bitmap = this.getModelRenderer().renderWorldScene(...request.arguments);
        }
        const resource = key ? new MovieTexture(this.renderer) :
            (this.dynamicImages.get(request.owner) || new MovieTexture(this.renderer));
        resource.update(bitmap, resolution, request.rotationCenter);
        if (key) {
            this.images.set(key, resource);
            this.images.pixels += resource.pixels;
            for (const [oldKey, old] of this.images) {
                if (this.images.size <= 1024 && this.images.pixels <= 16 * 1024 * 1024) break;
                if (old === resource) break;
                old.dispose();
                this.images.delete(oldKey);
                this.images.pixels -= old.pixels;
            }
        } else {
            this.dynamicImages.set(request.owner, resource);
        }
        return resource;
    }

    release (owner) {
        const resource = this.dynamicImages.get(owner);
        if (resource) resource.dispose();
        this.dynamicImages.delete(owner);
    }

    // Looks blocks expose a sprite appearance; their resource lifetime differs from direct Objects draws.
    render (request) {
        let entry;
        if (request.kind === 'text') {
            const key = `${request.font.name}\0${request.font.family}\0${request.text}`;
            entry = this.texts.get(key);
            if (!entry) {
                const bitmap = this.text.createTextCanvas(request.font, request.text, key);
                entry = this.upload({bitmap, resolution: bitmap.movieBitmapResolution || 4});
                this.texts.pixels += entry.pixels;
            }
            this.texts.delete(key);
            this.texts.set(key, entry);
        } else if (request.kind === 'model') {
            const bitmap = this.getModelRenderer().renderWorldScene(...request.arguments);
            entry = this.upload({...request, bitmap});
        } else if (request.kind === 'video' || request.kind === 'bitmap') {
            entry = this.upload(request);
        } else {
            throw new Error(`Unknown Movie source: ${request.kind}`);
        }
        if (typeof request.drawableId === 'number') {
            this.renderer.updateDrawableSkinId(request.drawableId, entry.skinId);
        }
        return entry;
    }

    upload ({bitmap, resolution = 2, skinId = null, rotationCenter}) {
        const renderer = this.renderer;
        const hasRotationCenter = rotationCenter !== null && typeof rotationCenter !== 'undefined';
        if (skinId === null) {
            skinId = hasRotationCenter ? renderer.createBitmapSkin(bitmap, resolution, rotationCenter) :
                renderer.createBitmapSkin(bitmap, resolution);
        } else if (hasRotationCenter) {
            renderer.updateBitmapSkin(skinId, bitmap, resolution, rotationCenter);
        } else {
            renderer.updateBitmapSkin(skinId, bitmap, resolution);
        }
        return {bitmap, resolution, skinId, pixels: bitmap.width * bitmap.height};
    }

    trimCache (cache, active, countLimit, pixelLimit) {
        let pixels = cache.pixels;
        if (!Number.isFinite(pixels)) {
            pixels = 0;
            for (const entry of cache.values()) pixels += entry.pixels;
        }
        for (const [key, entry] of cache) {
            if (cache.size <= countLimit && pixels <= pixelLimit) break;
            if (active.has(entry.skinId)) continue;
            this.renderer.destroySkin(entry.skinId);
            cache.delete(key);
            pixels -= entry.pixels;
        }
        cache.pixels = pixels;
    }
}

module.exports = MovieSourceRenderer;
