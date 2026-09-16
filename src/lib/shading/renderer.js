/* eslint-disable no-mixed-operators */
import EventEmitter from 'events';
import {gradePixels, blurPixels, autoGradePixels} from './effects';

const canvasOf = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};
const blendMode = mode => ({normal: 'source-over', add: 'lighter'}[mode] || mode);

/** Native composition renderer, with a small costume adapter for the VM/editor. */
class ShadingRenderer extends EventEmitter {
    constructor (canvas, left = -240, right = 240, bottom = -180, top = 180) {
        super();
        this.canvas = canvas;
        this.context = canvas.getContext('2d', {willReadFrequently: true});
        this.overlayContainer = document.createElement('div');
        this._allDrawables = [];
        this._allSkins = [];
        this._drawList = [];
        this.pending = new Set();
        this.useHighQualityRender = true;
        this.dirty = true;
        this.customFonts = {};
        this.setStageSize(left, right, bottom, top);
    }
    static isSupported () {
        try {
            return Boolean(document.createElement('canvas').getContext('2d'));
        } catch (e) {
            return false;
        }
    }
    setStageSize (left, right, bottom, top) {
        this.nativeSize = [right - left, top - bottom];
    }
    getNativeSize () {
        return this.nativeSize.slice();
    }
    resize (width, height) {
        this.canvas.width = Math.max(1, Math.round(width));
        this.canvas.height = Math.max(1, Math.round(height));
        this.draw();
    }
    setLayerGroupOrdering (groups) {
        this.groups = groups;
    }
    setUseHighQualityRender (enabled) {
        this.useHighQualityRender = enabled;
        this.emit('UseHighQualityRenderChanged', enabled);
    }
    setPrivateSkinAccess (enabled) {
        this.allowPrivateSkinAccess = enabled;
    }
    setCustomFonts (fonts) {
        this.customFonts = fonts;
    }
    createDrawable (group) {
        const id = this._allDrawables.length;
        this._allDrawables.push({id,
            group,
            skin: null,
            position: [0, 0],
            scale: [100, 100],
            direction: 90,
            visible: true,
            effects: {},
            _position: [0, 0],
            _scale: [100, 100]});
        this._allDrawables[id].getAABB = () => this.getBounds(id);
        this._drawList.push(id);
        return id;
    }
    destroyDrawable (id) {
        delete this._allDrawables[id];
        this._drawList = this._drawList.filter(value => value !== id);
    }
    updateDrawablePosition (id, position) {
        const drawable = this._allDrawables[id];
        if (drawable) {
            drawable.position = position.slice(); drawable._position = position.slice();
        }
    }
    updateDrawableDirectionScale (id, direction, scale) {
        const drawable = this._allDrawables[id];
        if (drawable) {
            drawable.direction = direction; drawable.scale = scale.slice(); drawable._scale = scale.slice();
        }
    }
    updateDrawableVisible (id, visible) {
        if (this._allDrawables[id]) this._allDrawables[id].visible = visible;
    }
    updateDrawableSkinId (id, skinId) {
        if (this._allDrawables[id]) this._allDrawables[id].skin = this._allSkins[skinId];
    }
    updateDrawableEffect (id, effect, value) {
        if (this._allDrawables[id]) this._allDrawables[id].effects[effect] = value;
    }
    getDrawableOrder (id) {
        return this._drawList.indexOf(id);
    }
    setDrawableOrder (id, order, group, relative = false) {
        const current = this.getDrawableOrder(id);
        this._drawList = this._drawList.filter(value => value !== id);
        const index = Math.max(0, Math.min(this._drawList.length, relative ? current + order : order));
        this._drawList.splice(index, 0, id);
        return index;
    }
    markSkinAsPrivate (id) {
        if (this._allSkins[id]) this._allSkins[id].private = true;
    }
    markDrawableAsNoninteractive (id) {
        if (this._allDrawables[id]) this._allDrawables[id].noninteractive = true;
    }
    createBitmapSkin (source, resolution = 1, center) {
        const id = this._allSkins.length;
        this._allSkins.push({id});
        this.updateBitmapSkin(id, source, resolution, center);
        return id;
    }
    updateBitmapSkin (id, source, resolution = 1, center) {
        let image = source;
        if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
            image = canvasOf(source.width, source.height);
            image.getContext('2d').putImageData(source, 0, 0);
        }
        const width = (image.naturalWidth || image.width) / resolution;
        const height = (image.naturalHeight || image.height) / resolution;
        Object.assign(this._allSkins[id], {image,
            size: [width, height],
            rotationCenter: center || [width / 2, height / 2]});
        this.dirty = true;
    }
    createSVGSkin (svg, center) {
        const id = this._allSkins.length;
        this._allSkins.push({id});
        this.updateSVGSkin(id, svg, center);
        return id;
    }
    updateSVGSkin (id, svg, center) {
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        const viewBox = (root.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
        const width = parseFloat(root.getAttribute('width')) || viewBox[2] || 1;
        const height = parseFloat(root.getAttribute('height')) || viewBox[3] || 1;
        const image = new Image();
        const skin = this._allSkins[id];
        Object.assign(skin, {size: [width, height], rotationCenter: center || [width / 2, height / 2]});
        const pending = new Promise((resolve, reject) => {
            image.onload = () => {
                skin.image = image; this.dirty = true; this.draw(); resolve();
            };
            image.onerror = () => reject(new Error('Could not decode SVG costume'));
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        this.pending.add(pending);
        pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    }
    getSkinSize (id) {
        return this._allSkins[id] ? this._allSkins[id].size.slice() : [0, 0];
    }
    getSkinRotationCenter (id) {
        return this._allSkins[id].rotationCenter.slice();
    }
    getCurrentSkinSize (id) {
        const drawable = this._allDrawables[id];
        return drawable && drawable.skin ? drawable.skin.size.slice() : [0, 0];
    }
    destroySkin (id) {
        delete this._allSkins[id];
    }
    ready () {
        return Promise.all(Array.from(this.pending));
    }
    getFencedPositionOfDrawable (id, position) {
        return position;
    }
    getBounds (id) {
        const drawable = this._allDrawables[id];
        const size = this.getCurrentSkinSize(id);
        const [x, y] = drawable ? drawable.position : [0, 0];
        return {left: x - size[0] / 2,
            right: x + size[0] / 2,
            top: y + size[1] / 2,
            bottom: y - size[1] / 2,
            width: size[0],
            height: size[1]};
    }
    getBoundsForBubble (id) {
        return this.getBounds(id);
    }
    pick () {
        return -1;
    } // Composition layers are addressed by name, never by Scratch drawable ID.
    extractColor (x, y) {
        const data = this.context.getImageData(Math.max(0, Math.min(this.canvas.width - 1, x)),
            Math.max(0, Math.min(this.canvas.height - 1, y)), 1, 1).data;
        return {color: [data[0], data[1], data[2]], alpha: data[3]};
    }
    requestSnapshot (callback) {
        this.draw(); callback(this.canvas.toDataURL());
    }
    drawableTouching () {
        return false;
    }
    isTouchingDrawables () {
        return false;
    }
    isTouchingColor () {
        return false;
    }
    costumeImage (media) {
        if (!media.startsWith('costume:') || !this.scene) return null;
        // Target IDs may contain punctuation; match known IDs instead of splitting them.
        for (const target of this.scene.runtime.targets) {
            const prefix = `costume:${encodeURIComponent(target.getName())}:`;
            if (!media.startsWith(prefix)) continue;
            const costume = target.getCostumes().find(c => encodeURIComponent(c.name) === media.slice(prefix.length));
            return costume && this._allSkins[costume.skinId];
        }
        return null;
    }
    transformLayer (context, layer, composition, visited = new Set()) {
        if (visited.has(layer.name)) return;
        visited.add(layer.name);
        const parent = composition.layers.get(layer.parent);
        if (parent) this.transformLayer(context, parent, composition, visited);
        // All Transform values use a center origin: position (0, 0) is the
        // parent/composition center and anchor (0, 0) is the layer center.
        const t = layer.transform;
        context.translate(t.position[0], t.position[1]);
        context.rotate(t.rotation * Math.PI / 180);
        context.scale(t.scale / 100, t.scale / 100);
        context.translate(-t.anchor[0], -t.anchor[1]);
        context.globalAlpha *= t.opacity / 100;
    }
    paintShape (context, layer) {
        const {radius, points, inner} = layer.transform;
        const curved = layer.shape === 'curve star' || layer.shape === 'flower';
        const count = layer.shape === 'polygon' ? points : (curved ? points * 32 : points * 2);
        context.beginPath();
        for (let i = 0; i < count; i++) {
            const angle = i / count * Math.PI * 2 - Math.PI / 2;
            let r = radius;
            if (layer.shape === 'star') r *= i % 2 ? inner / 100 : 1;
            if (curved) {
                const wave = (Math.cos(i / count * Math.PI * 2 * points) + 1) / 2;
                r *= inner / 100 + (1 - inner / 100) * (layer.shape === 'flower' ? Math.sqrt(wave) : wave);
            }
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
    }
    layerSurface (layer, composition) {
        const surface = canvasOf(composition.width, composition.height);
        const context = surface.getContext('2d', {willReadFrequently: true});
        // Canvas origin is top-left, but every Transform value uses the
        // composition center as (0, 0). Shift once here so nested parents do
        // not accumulate the offset.
        context.translate(composition.width / 2, composition.height / 2);
        this.transformLayer(context, layer, composition);
        context.fillStyle = layer.transform.fill;
        if (layer.kind === 'shape') this.paintShape(context, layer);
        if (layer.kind === 'text') {
            const font = this.scene.assets.items.get(layer.font);
            context.font = `${layer.transform.fontSize}px "${font ? font.family : 'sans-serif'}"`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            const lines = layer.text.split('\n');
            const lineHeight = layer.transform.fontSize * 1.2;
            lines.forEach((line, index) => context.fillText(line, 0,
                (index - (lines.length - 1) / 2) * lineHeight));
        }
        if (layer.kind === 'footage') {
            const asset = this.scene.assets.items.get(layer.media);
            const skin = this.costumeImage(layer.media);
            if (asset && asset.kind === 'video' && asset.element.readyState >= 2) {
                const width = asset.width || asset.element.videoWidth || asset.element.width || 0;
                const height = asset.height || asset.element.videoHeight || asset.element.height || 0;
                if (width > 0 && height > 0) {
                    context.drawImage(asset.element, -width / 2, -height / 2, width, height);
                } else {
                    context.drawImage(asset.element, 0, 0);
                }
            } else if (skin && skin.image) {
                context.drawImage(skin.image, -skin.size[0] / 2, -skin.size[1] / 2,
                    skin.size[0], skin.size[1]);
            }
        }
        return surface;
    }
    applyEffects (surface, layer, composition, rawLayers) {
        if (!layer.effects.size) return surface;
        const context = surface.getContext('2d', {willReadFrequently: true});
        const image = context.getImageData(0, 0, surface.width, surface.height);
        for (const [kind, args] of layer.effects) {
            if (kind === 'grading') gradePixels(image.data, args);
            if (kind === 'blur') blurPixels(image.data, surface.width, surface.height, args);
            if (kind === 'auto') {
                const source = composition.layers.get(String(args.SRC));
                if (source && source.kind !== 'adjustment') {
                    let background = rawLayers.get(source.name);
                    if (!background) {
                        background = this.layerSurface(source, composition); rawLayers.set(source.name, background);
                    }
                    autoGradePixels(image.data, background.getContext('2d').getImageData(0, 0,
                        background.width, background.height).data);
                }
            }
        }
        context.putImageData(image, 0, 0);
        return surface;
    }
    renderComposition (composition) {
        const output = canvasOf(composition.width, composition.height);
        const context = output.getContext('2d', {willReadFrequently: true});
        if (composition.color !== 'transparent') {
            context.fillStyle = composition.color;
            context.fillRect(0, 0, output.width, output.height);
        }
        const rawLayers = new Map();
        for (const layer of composition.layers.values()) {
            if (layer.kind === 'null') continue;
            let surface;
            if (layer.kind === 'adjustment') {
                surface = canvasOf(output.width, output.height);
                surface.getContext('2d').drawImage(output, 0, 0);
            } else {
                surface = this.layerSurface(layer, composition);
            }
            this.applyEffects(surface, layer, composition, rawLayers);
            context.save();
            context.globalCompositeOperation = blendMode(layer.mode);
            if (layer.kind === 'adjustment') context.globalAlpha = layer.transform.opacity / 100;
            context.drawImage(surface, 0, 0);
            context.restore();
        }
        return output;
    }
    draw () {
        const context = this.context;
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const composition = this.scene && this.scene.composition;
        if (composition) {
            const surface = this.renderComposition(composition);
            const scale = Math.min(this.canvas.width / surface.width, this.canvas.height / surface.height);
            const width = surface.width * scale;
            const height = surface.height * scale;
            context.drawImage(surface, (this.canvas.width - width) / 2,
                (this.canvas.height - height) / 2, width, height);
        } else {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.dirty = false;
    }
    async drawFrame (targetCanvas) {
        if (this.scene) await this.scene.prepareFrame();
        const composition = this.scene && this.scene.composition;
        const context = targetCanvas.getContext('2d');
        context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        if (composition) {
            context.drawImage(this.renderComposition(composition), 0, 0,
                targetCanvas.width, targetCanvas.height);
        } else {
            this.draw(); context.drawImage(this.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
        }
    }
}
export default ShadingRenderer;
