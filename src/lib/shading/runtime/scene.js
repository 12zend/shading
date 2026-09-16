import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import {definitions} from '../blocks';
import ShadingAssets from '../assets';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const numeric = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const defaults = () => ({anchor: [0, 0],
    position: [0, 0],
    scale: 100,
    rotation: 0,
    opacity: 100,
    fill: '#ffffff',
    radius: 100,
    points: 5,
    inner: 50,
    fontSize: 72});

for (const block of definitions) {
    const group = block.shape === 'reporter' ? compatBlocks.inputs : compatBlocks.stacked;
    if (!group.includes(block.opcode)) group.push(block.opcode);
}

class ShadingScene {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.assets = new ShadingAssets(this.runtime);
        this.reset();
        this.runtime.on('PROJECT_START', () => this.reset());
        this.previewPending = false;
        this.previewPromise = Promise.resolve();
        this.lastPreviewKey = '';
        const preview = () => {
            if (this.exporting || this.previewPending || !this.runtime.renderer || !this.composition) return;
            const key = `${this.revision}:${this.time()}`;
            if (key === this.lastPreviewKey) return;
            this.lastPreviewKey = key;
            this.previewPending = true;
            this.previewPromise = this.prepareFrame().then(() => {
                this.runtime.renderer.draw();
            })
                .catch(error => this.runtime.emit('SHADING_MEDIA_ERROR', error.message))
                .then(() => {
                    this.previewPending = false;
                });
        };
        this.runtime.on('SHADING_ASSETS_CHANGED', () => {
            this.revision++; preview();
        });
        this.runtime.on('AFTER_EXECUTE', preview);
        this.runtime.on('SHADING_RENDER_FRAME', preview);
        if (!this.runtime._primitives) this.runtime._primitives = {};
        for (const block of definitions) {
            const method = block.opcode.slice(6);
            this.runtime._primitives[block.opcode] = args => {
                const result = this[method](args);
                if (block.shape !== 'reporter') {
                    this.revision++;
                    this.runtime.requestRedraw();
                }
                return result;
            };
        }
    }
    reset () {
        this.revision = (this.revision || 0) + 1;
        this.compositions = new Map();
        this.active = '';
        this.settings = defaults();
    }
    get composition () {
        return this.compositions.get(this.active);
    }
    initComposition () {
        this.compositions.clear();
        this.active = '';
    }
    initLayer () {
        for (const composition of this.compositions.values()) composition.layers.clear();
    }
    addComposition (args) {
        const name = String(args.NAME);
        const previous = this.compositions.get(name);
        const composition = {name,
            width: clamp(Math.round(numeric(args.WIDTH, 1920)), 16, 7680),
            height: clamp(Math.round(numeric(args.HEIGHT, 1080)), 16, 7680),
            framerate: clamp(numeric(args.FRAMERATE, 30), 1, 120),
            color: String(args.COLOR),
            layers: previous ? previous.layers : new Map()};
        this.compositions.set(name, composition);
        this.selectComposition({NAME: name});
    }
    deleteComposition ({NAME}) {
        this.compositions.delete(String(NAME));
        if (this.active === String(NAME)) {
            this.active = this.compositions.keys().next().value || '';
            if (this.composition) this.selectComposition({NAME: this.active});
        }
    }
    selectComposition ({NAME}) {
        const composition = this.compositions.get(String(NAME));
        if (!composition) return;
        this.active = composition.name;
        const timeline = this.runtime.shadingTimeline;
        if (timeline) {
            timeline.setRenderSettings({width: composition.width,
                height: composition.height,
                framerate: composition.framerate}, false);
        }
    }
    addLayer (kind, args) {
        if (!this.composition) {
            this.addComposition({NAME: 'Composition 1',
                WIDTH: 1920,
                HEIGHT: 1080,
                FRAMERATE: 30,
                COLOR: '#000000'});
        }
        const layers = this.composition.layers;
        const name = String(args.NAME);
        const parent = String(args.PARENT || '');
        // Allow forward references, but never create a parent cycle.
        let ancestor = parent;
        const visited = new Set([name]);
        while (ancestor) {
            if (visited.has(ancestor)) throw new Error(`Layer parent cycle: ${name}`);
            visited.add(ancestor);
            ancestor = layers.has(ancestor) ? layers.get(ancestor).parent : '';
        }
        const previous = layers.get(name);
        layers.set(name, {name,
            kind,
            parent,
            mode: String(args.MODE || 'normal'),
            media: String(args.MEDIA || ''),
            font: String(args.FONT || 'sans-serif'),
            text: String(args.TEXT || ''),
            shape: String(args.TYPE || 'polygon'),
            transform: {...this.settings,
                anchor: this.settings.anchor.slice(),
                position: this.settings.position.slice()},
            effects: previous ? previous.effects : new Map()});
    }
    addFootage (args) {
        this.addLayer('footage', args);
    }
    addText (args) {
        this.addLayer('text', args);
    }
    addShape (args) {
        this.addLayer('shape', args);
    }
    addAdjustment (args) {
        this.addLayer('adjustment', args);
    }
    addNull (args) {
        this.addLayer('null', args);
    }
    deleteLayer ({LAYER}) {
        if (!this.composition) return;
        this.composition.layers.delete(String(LAYER));
        for (const layer of this.composition.layers.values()) {
            if (layer.parent === String(LAYER)) layer.parent = '';
        }
    }
    setAnchor ({X, Y}) {
        this.settings.anchor = [numeric(X), numeric(Y)];
    }
    setPosition ({X, Y}) {
        this.settings.position = [numeric(X), numeric(Y)];
    }
    setScale ({SCALE}) {
        this.settings.scale = numeric(SCALE, 100);
    }
    setRotation ({DEGREES}) {
        this.settings.rotation = numeric(DEGREES);
    }
    setOpacity ({OPACITY}) {
        this.settings.opacity = clamp(numeric(OPACITY, 100), 0, 100);
    }
    setFill ({COLOR}) {
        this.settings.fill = String(COLOR);
    }
    setShape ({RADIUS, POINTS, INNER}) {
        this.settings.radius = clamp(numeric(RADIUS, 100), 0, 7680);
        this.settings.points = clamp(Math.round(numeric(POINTS, 5)), 3, 128);
        this.settings.inner = clamp(numeric(INNER, 50), 0, 100);
    }
    setFontSize ({SIZE}) {
        this.settings.fontSize = clamp(numeric(SIZE, 72), 1, 2048);
    }
    effect (name, layerName, args) {
        const layer = this.composition && this.composition.layers.get(String(layerName));
        if (layer) layer.effects.set(name, {...args});
    }
    colorGrading (args) {
        this.effect('grading', args.LAYER, args);
    }
    blur (args) {
        this.effect('blur', args.LAYER, args);
    }
    autoGrading (args) {
        this.effect('auto', args.DST, args);
    }
    time () {
        const clock = this.runtime.ioDevices && this.runtime.ioDevices.clock;
        return clock ? clock.projectTimer() : 0;
    }
    async prepareFrame () {
        const layers = this.composition ? Array.from(this.composition.layers.values()) : [];
        const videos = new Set(layers.filter(l => l.kind === 'footage').map(l => l.media));
        await this.assets.prepareFrame(this.time(), videos);
        if (this.runtime.renderer && this.runtime.renderer.ready) await this.runtime.renderer.ready();
    }
}

const installShadingScene = vm => {
    if (vm.runtime.shadingScene) return vm.runtime.shadingScene;
    const scene = new ShadingScene(vm);
    vm.runtime.shadingScene = scene;
    if (vm.runtime.renderer) vm.runtime.renderer.scene = scene;
    if (typeof vm.toJSON === 'function') {
        const original = vm.toJSON.bind(vm);
        vm.toJSON = (targetId, options) => {
            const json = JSON.parse(original(targetId, options));
            if (typeof targetId === 'undefined' || targetId === null) {
                json.shade = {...json.shade, assets: scene.assets.toJSON()};
            }
            return JSON.stringify(json);
        };
    }
    if (typeof vm.deserializeProject === 'function') {
        const original = vm.deserializeProject.bind(vm);
        vm.deserializeProject = async (json, zip) => {
            const result = await original(json, zip);
            scene.reset();
            await scene.assets.restore((json.shade && json.shade.assets) || []);
            return result;
        };
    }
    return scene;
};
export {ShadingScene, installShadingScene};
