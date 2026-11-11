jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {FRAME_GRAPH_NODE_TYPES} from '../../../scratch-vm/src/lib/movie-frame-graph';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {buildProject, createHarness} from '../../helpers/movie-determinism';
import {hasOfficialPlugins, readPluginDirectory, requirePluginModule} from '../../helpers/official-plugins';

const describeWithPlugins = hasOfficialPlugins ? describe : describe.skip;

const ARGS = {
    TIME: 1,
    GRAVITY: 980,
    DIRECTION: 180,
    RESTITUTION: 0.5,
    FRICTION: 0.5,
    AIR: 0,
    VX_MIN: -100,
    VX_MAX: 100,
    VY_MIN: 0,
    VY_MAX: 200
};

// A frame of width x height with opaque rectangles [x, y, w, h] (rows bottom-up, premultiplied).
const frameWith = (width, height, rectangles) => {
    const data = new Uint8Array(width * height * 4);
    for (const [x0, y0, w, h] of rectangles) {
        for (let y = y0; y < y0 + h; y++) {
            for (let x = x0; x < x0 + w; x++) {
                const offset = ((y * width) + x) * 4;
                data[offset] = 200;
                data[offset + 1] = 100;
                data[offset + 2] = 50;
                data[offset + 3] = 255;
            }
        }
    }
    return {data, width, height};
};

const box = (x, y, w, h) => ({
    x, y, mass: w * h, inertia: w * h * ((w * w) + (h * h)) / 12,
    hull: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
});

const STAGE = {minX: -240, maxX: 240, minY: -180, maxY: 180};

describeWithPlugins('C Physics plugin internals', () => {
    const {extractPieces} = requirePluginModule('c-physics', 'lib/pieces.js');
    const {Simulation, createWorld, step} = requirePluginModule('c-physics', 'lib/solver.js');
    const {createShatter} = requirePluginModule('c-physics', 'lib/shatter.js');

    test('splits a frame into its connected regions with mass properties', () => {
        const pieces = extractPieces(frameWith(64, 48, [[2, 2, 10, 4], [30, 20, 6, 6], [40, 20, 1, 1]]),
            {pixelScale: 2});
        expect(pieces.map(piece => [piece.minX, piece.minY, piece.width, piece.height])).toEqual([
            [2, 2, 10, 4], [30, 20, 6, 6], [40, 20, 1, 1]
        ]);
        const [bar] = pieces;
        expect([bar.centerX, bar.centerY]).toEqual([7, 4]);
        // 40 pixels at 2 pixels per stage unit: 10 square stage units; the hull is the 5 x 2 rectangle.
        expect(bar.mass).toBeCloseTo(10, 9);
        expect(bar.inertia).toBeCloseTo(10 * ((5 * 5) + (2 * 2)) / 12, 9);
        expect(bar.hull.map(([x, y]) => [x, y])).toEqual([[-2.5, -1], [2.5, -1], [2.5, 1], [-2.5, 1]]);
        // Diagonal neighbours belong to the same piece.
        expect(extractPieces(frameWith(8, 8, [[1, 1, 1, 1], [2, 2, 1, 1]])).length).toBe(1);
    });

    test('falls, bounces and comes to rest on the stage edge in the gravity direction', () => {
        const world = createWorld([box(0, 100, 20, 20)], {gravity: 980, direction: 180, restitution: 0.5,
            friction: 0.5, bounds: STAGE});
        let peak = -Infinity;
        let landed = false;
        for (let index = 0; index < 240; index++) {
            step(world);
            if (world.state[4] > 0) landed = true;
            if (landed) peak = Math.max(peak, world.state[1]);
        }
        // Restitution 0.5 keeps a quarter of the 270 unit drop.
        expect(peak).toBeCloseTo(-170 + (270 / 4), -1);
        for (let index = 0; index < 600; index++) step(world);
        expect(world.state[1]).toBeCloseTo(-170, 0);
        expect(Math.abs(world.state[4])).toBeLessThan(0.01);

        const sideways = createWorld([box(0, 0, 20, 20)], {gravity: 980, direction: 90, bounds: STAGE});
        for (let index = 0; index < 600; index++) step(sideways);
        expect(sideways.state[0]).toBeCloseTo(230, 0);
        expect(sideways.state[1]).toBeCloseTo(0, 1);
    });

    test('slows a sliding piece by friction and stacks pieces', () => {
        const slide = createWorld([box(0, -170, 20, 20)], {gravity: 980, direction: 180, restitution: 0,
            friction: 0.2, velocity: {xMin: 300, xMax: 300}, bounds: STAGE});
        for (let index = 0; index < 120; index++) step(slide);
        // Friction 0.2 of gravity 980 takes 196 units/s each second.
        expect(slide.state[3]).toBeCloseTo(104, -1);
        const stack = createWorld([box(0, -160, 40, 40), box(5, -100, 30, 30)], {gravity: 980, direction: 180,
            restitution: 0.2, friction: 0.6, bounds: STAGE});
        for (let index = 0; index < 600; index++) step(stack);
        expect(stack.state[1]).toBeCloseTo(-160, 0);
        expect(stack.state[7]).toBeCloseTo(-125, 0);
    });

    test('gives the same poses for the same time however it is reached', () => {
        const bodies = [];
        for (let index = 0; index < 30; index++) bodies.push(box(-200 + (index * 14), 100 + (index % 3), 10, 10));
        const settings = {gravity: 980, direction: 180, restitution: 0.4, friction: 0.5, air: 0.2, seed: 9,
            velocity: {xMin: -100, xMax: 100, yMin: 0, yMax: 300}, bounds: STAGE};
        const direct = new Simulation(bodies, settings).posesAt(2.5);
        const scrubbed = new Simulation(bodies, settings);
        scrubbed.posesAt(4);
        scrubbed.posesAt(0.3);
        expect(Array.from(scrubbed.posesAt(2.5))).toEqual(Array.from(direct));
        // The random initial velocities follow the seed.
        const other = new Simulation(bodies, Object.assign({}, settings, {seed: 10})).posesAt(2.5);
        expect(Array.from(other)).not.toEqual(Array.from(direct));
    });

    test('draws the pieces in place at the start and moved later', () => {
        const frame = frameWith(96, 72, [[10, 40, 8, 8], [60, 50, 12, 4]]);
        const shatter = createShatter();
        const options = {key: 'block', pixelScale: 0.2, gravity: 980, direction: 180, restitution: 0.5,
            friction: 0.5, air: 0, velocity: {xMin: 0, xMax: 0, yMin: 0, yMax: 0}, seed: 1};
        expect(Array.from(shatter.render(frame, Object.assign({time: 0}, options)))).toEqual(Array.from(frame.data));
        const later = shatter.render(frame, Object.assign({time: 3}, options));
        const rows = [];
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                if (later[(((y * frame.width) + x) * 4) + 3] > 128) rows.push(y);
            }
        }
        // Both pieces lie on the bottom edge now.
        expect(Math.min(...rows)).toBe(0);
        expect(Math.max(...rows)).toBeLessThan(10);
        // The pieces are reused while the content stays the same.
        expect(shatter.entries.size).toBe(1);
        const {pieces} = shatter.entries.get('block');
        shatter.render(frame, Object.assign({time: 1}, options));
        expect(shatter.entries.get('block').pieces).toBe(pieces);
    });

    test('the engine effect reads the group and writes the moved pieces back', () => {
        const install = requirePluginModule('c-physics', 'lib/engine.js');
        class Engine {}
        install({Engine});
        const frame = frameWith(48, 36, [[4, 20, 6, 6]]);
        const writes = [];
        const engine = Object.assign(new Engine(), {
            width: 48,
            height: 36,
            pixelScale: 0.1,
            blendOpacity: 1,
            framebuffers: ['source'],
            textures: [null, 'secondary'],
            gl: {
                FRAMEBUFFER: 1, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4,
                bindFramebuffer: () => {},
                bindTexture: () => {},
                readPixels: (x, y, w, h, format, type, target) => target.set(frame.data),
                texSubImage2D: (...args) => writes.push(args[args.length - 1].slice())
            },
            _prepare: () => ({_texture: 'skin'}),
            _canRenderDirectly: () => true,
            _markSkinChanged: () => {}
        });
        const options = {key: 'k', gravity: 980, direction: 180, restitution: 0, friction: 0.5, air: 0, seed: 1,
            velocity: {xMin: 0, xMax: 0, yMin: 0, yMax: 0}};
        engine.cPhysics(Object.assign({time: 0}, options), 'normal');
        engine.cPhysics(Object.assign({time: 2}, options), 'normal');
        expect(Array.from(writes[0])).toEqual(Array.from(frame.data));
        expect(Array.from(writes[1])).not.toEqual(Array.from(frame.data));
        // The piece rests on the bottom row.
        const bottomRow = Array.from({length: 48}, (value, x) => writes[1][(x * 4) + 3]);
        expect(Math.max(...bottomRow)).toBe(255);
    });
});

// A PenFX stand-in whose effects land in the frame graph with the options the effect received.
const installFakePenFX = vm => {
    class FakePenFX {
        constructor () {
            this.customShaders = {getPluginOpcodes: () => new Map()};
        }
        beginGroup () {}
        endGroup () {}
        _safe (callback) {
            const received = {};
            callback({cPhysics: options => Object.assign(received, options)});
            vm.runtime.movieAssetManager.enqueueFrameGraphEffect({cPhysics: received});
        }
    }
    vm.runtime.penFX = new FakePenFX();
};

const project = () => buildProject({
    scripts: [{
        hat: 'event_renderframe',
        body: [{
            opcode: 'objects_cPhysics',
            inputs: ARGS,
            substack: [{
                opcode: 'objects_draw',
                fields: {SOURCE: 'costume'},
                inputs: {PX: 0, PY: {opcode: 'objects_timelineTime'}, PZ: 480}
            }]
        }]
    }]
});

describeWithPlugins.each([true, false])('C Physics block (compiler %s)', compiler => {
    let harness;
    let plugins;
    afterEach(() => harness && harness.dispose());

    const load = () => createHarness(project(), {
        compiler,
        duration: 4,
        beforeLoad: async vm => {
            installFakePenFX(vm);
            plugins = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
            await plugins.init();
            const record = plugins.loadArchive(readPluginDirectory('c-physics'));
            if (record.state === 'error') throw new Error(record.error);
            await vm.extensionManager.refreshBlocks('objects');
        }
    });

    test('is a C block in the Objects category that returns undefined', async () => {
        harness = await load();
        const info = harness.runtime._blockInfo.find(category => category.id === 'objects');
        const block = info.blocks.find(entry => entry.info.opcode === 'cPhysics');
        expect(block.info.blockType).toBe('conditional');
        expect(Object.keys(block.info.arguments)).toEqual(Object.keys(ARGS));
        expect(block.info.arguments.TIME.timelineTime).toBe(true);
        expect(plugins.getObjectsToolboxXML()).toContain('type="objects_cPhysics"');
        expect(harness.runtime._primitives.objects_cPhysics(ARGS, {thread: null})).toBeUndefined();
    });

    test('draws the substack as it is before the time', async () => {
        harness = await load();
        const graph = JSON.parse(await harness.seekTo(15));
        const [transform] = graph.children;
        expect(transform.type).toBe(FRAME_GRAPH_NODE_TYPES.TRANSFORM);
        expect(transform.children[0].configuration.position.y).toBeCloseTo(0.5, 9);
    });

    test('freezes the substack at the time and moves its pieces with physics after it', async () => {
        harness = await load();
        const graph = JSON.parse(await harness.seekTo(60));
        const [group] = graph.children;
        expect(group).toMatchObject({type: FRAME_GRAPH_NODE_TYPES.COMPOSITE, operation: 'effects'});
        const [transform, effect] = group.children;
        // The substack keeps what it drew at 1 s: its own animation no longer applies.
        expect(transform.children[0].configuration.position.y).toBeCloseTo(1, 9);
        expect(transform.children[0].configuration.evaluationTime).toBeCloseTo(1, 9);
        expect(effect).toMatchObject({operation: 'effect'});
        expect(effect.effect.cPhysics).toMatchObject({
            time: 1,
            gravity: 980,
            direction: 180,
            restitution: 0.5,
            friction: 0.5,
            air: 0,
            velocity: {xMin: -100, xMax: 100, yMin: 0, yMax: 200}
        });
        expect(typeof effect.effect.cPhysics.seed).toBe('number');
        const later = JSON.parse(await harness.seekTo(90));
        expect(later.children[0].children[1].effect.cPhysics.time).toBeCloseTo(2, 9);
        expect(later.children[0].children[1].effect.cPhysics.seed).toBe(effect.effect.cPhysics.seed);
    });
});
