jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import JSZip from '@turbowarp/jszip';

import {FRAME_GRAPH_NODE_TYPES} from '../../../scratch-vm/src/lib/movie-frame-graph';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

// A plugin with a gravity-only "physics" solver: bodies fall; the world serializes as JSON bytes.
const PLUGIN_MAIN = `
const solver = {
    id: 'fall',
    create: settings => ({gravity: Number(settings.gravity) || -10, bodies: {}}),
    beforeStep: () => {},
    step: (world, dt) => {
        for (const body of Object.values(world.bodies)) {
            body.vy += world.gravity * dt;
            body.y += body.vy * dt;
        }
    },
    snapshot: world => new TextEncoder().encode(JSON.stringify(world)),
    restore: bytes => JSON.parse(new TextDecoder().decode(bytes)),
    dispose: () => {},
    readPose: (world, name) => ({position: {x: 0, y: world.bodies[name].y, z: 480},
        quaternion: {x: 0, y: 0, z: 0, w: 1}})
};
exports.activate = shading => {
    const {BlockType, ArgumentType} = shading.scratch;
    shading.simulation.registerSolver(solver);
    shading.simulation.addBlocks({
        blocks: [{
            opcode: 'fallWorld',
            blockType: BlockType.COMMAND,
            text: 'falling world, ball at [Y]',
            arguments: {Y: {type: ArgumentType.NUMBER, defaultValue: 100}}
        }, {
            opcode: 'ballY',
            blockType: BlockType.REPORTER,
            text: 'ball y'
        }, {
            opcode: 'atBall',
            blockType: BlockType.CONDITIONAL,
            branchCount: 1,
            text: 'at the ball'
        }, {
            opcode: 'contextName',
            blockType: BlockType.REPORTER,
            text: 'context name'
        }],
        methods: {
            fallWorld: (args, util) => {
                const context = shading.simulation.getContext(util);
                if (!context) return Promise.resolve('outside');
                const world = context.createWorld('fall', {gravity: -9.8});
                world.bodies.ball = {y: Number(args.Y), vy: 0};
                context.state.handles.set('ball', 1);
                return Promise.resolve('ignored');
            },
            ballY: (args, util) => {
                const pose = shading.simulation.readPose('drop', 'ball', undefined, util);
                return pose ? pose.position.y : 0;
            },
            atBall: (args, util) => {
                const pose = shading.simulation.readPose('drop', 'ball', undefined, util);
                shading.objects.runWithTransform(util, {position: pose ? pose.position : {x: 0, y: 0, z: 0}});
            },
            contextName: (args, util) => {
                const context = shading.simulation.getContext(util);
                return context ? context.name : 'none';
            }
        }
    });
};
`;

const pluginZip = async () => {
    const zip = new JSZip();
    zip.file('fall/shading-plugin.json', JSON.stringify({
        format: 'shading.app/plugin', formatVersion: 1, id: 'fall', name: 'Fall', version: '1.0.0', main: 'main.js'
    }));
    zip.file('fall/main.js', PLUGIN_MAIN);
    return zip.generateAsync({type: 'uint8array'});
};

const draw = py => ({opcode: 'objects_draw', fields: {SOURCE: 'costume'}, inputs: {PX: 0, PY: py, PZ: 0}});

const project = () => buildProject({
    scripts: [{
        hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'drop', START: 0, RATE: 120}},
        body: [
            {opcode: 'simulation_fallWorld', inputs: {Y: 100}},
            {opcode: 'simulation_setState', inputs: {KEY: 'name', VALUE: {opcode: 'simulation_contextName'}}}
        ]
    }, {
        hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'drop'}},
        body: []
    }, {
        hat: 'event_renderframe',
        body: [
            draw({opcode: 'simulation_ballY'}),
            {opcode: 'simulation_atBall', substack: [draw(0)]},
            {
                opcode: 'objects_motionBlur',
                inputs: {ANGLE: 360, PHASE: -360, SAMPLES: 2},
                substack: [draw({opcode: 'simulation_ballY'})]
            }
        ]
    }]
});

const fallen = time => {
    let y = 100;
    let vy = 0;
    for (let step = 0; step < Math.round(time * 120); step++) {
        vy += -9.8 / 120;
        y += vy / 120;
    }
    return y;
};

describe.each([true, false])('the shading.simulation plugin API (compiler %s)', compiler => {
    let harness;
    let plugins;
    afterEach(() => harness && harness.dispose());

    const load = () => createHarness(project(), {
        compiler,
        duration: 2,
        beforeLoad: async vm => {
            plugins = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
            await plugins.init();
            await plugins.install(await plugins.inspect(await pluginZip(), 'fall.zip'));
            await vm.extensionManager.refreshBlocks('simulation');
        }
    });

    test('adds Simulation blocks, a solver, contexts and pose reads', async () => {
        harness = await load();
        const info = harness.runtime._blockInfo.find(category => category.id === 'simulation');
        expect(info.blocks.map(block => block.info.opcode)).toEqual(expect.arrayContaining(['fallWorld', 'atBall']));
        // Commands return undefined even when the plugin method returns a Promise.
        expect(harness.runtime._primitives.simulation_fallWorld({Y: 1}, {thread: null})).toBeUndefined();
        expect(harness.runtime._primitives.simulation_contextName({}, {thread: null})).toBe('none');

        const graph = JSON.parse(await harness.seekTo(30));
        const [ballDraw, transform, blur] = graph.children;
        expect(ballDraw.configuration.position.y).toBeCloseTo(fallen(1), 9);
        expect(transform.type).toBe(FRAME_GRAPH_NODE_TYPES.TRANSFORM);
        expect(transform.transform.position.y).toBeCloseTo(fallen(1), 9);
        expect(harness.runtime.simulationRuntime.sample('drop', 'name', 1)).toBe('drop');
        // A shutter of one frame before t: the two samples read the pose a quarter and three quarters back.
        const ys = blur.children.map(child => child.children[0].configuration.position.y).sort((a, b) => a - b);
        const samples = [0.75 / 30, 0.25 / 30].map(back => {
            const time = 1 - back;
            const k = Math.floor(time * 120);
            return fallen(k / 120) + ((fallen((k + 1) / 120) - fallen(k / 120)) * ((time * 120) - k));
        });
        expect(ys).toEqual(samples.sort((a, b) => a - b).map(y => expect.closeTo(y, 9)));
        expect(ys[0]).not.toBeCloseTo(ys[1], 6);

        const saved = JSON.parse(harness.vm.toJSON());
        expect(saved.shadingPlugins.map(reference => reference.id)).toEqual(['fall']);
    });

    test('disposes the solver and blocks with the plugin', async () => {
        harness = await load();
        expect(harness.runtime.simulationRuntime.getSolver('fall')).not.toBeNull();
        await plugins.uninstall('fall');
        expect(harness.runtime.simulationRuntime.getSolver('fall')).toBeNull();
        await harness.vm.extensionManager.refreshBlocks('simulation');
        const info = harness.runtime._blockInfo.find(category => category.id === 'simulation');
        expect(info.blocks.map(block => block.info.opcode)).not.toContain('fallWorld');
    });
});
