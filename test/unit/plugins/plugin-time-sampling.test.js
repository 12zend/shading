jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import JSZip from '@turbowarp/jszip';

import {FRAME_GRAPH_NODE_TYPES} from '../../../scratch-vm/src/lib/movie-frame-graph';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {MAX_TIME_SAMPLES, normalizeTimeSamples} from '../../../src/lib/plugins/time-sampling';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const PLUGIN_MAIN = `
exports.activate = shading => {
    const {BlockType} = shading.scratch;
    shading.objects.registerTimeComposer('diff', {
        begin: () => {},
        layer: () => {},
        end: () => {}
    });
    exports.maxTimeSamples = shading.objects.MAX_TIME_SAMPLES;
    exports.register = (name, composer) => shading.objects.registerTimeComposer(name, composer);
    shading.objects.addBlocks({
        blocks: [{
            opcode: 'shiftTime',
            blockType: BlockType.CONDITIONAL,
            branchCount: 1,
            text: 'shift time'
        }, {
            opcode: 'timeDifference',
            blockType: BlockType.CONDITIONAL,
            branchCount: 1,
            text: 'time difference'
        }],
        methods: {
            shiftTime: (args, util) => shading.objects.runWithLocalTime(util, 'offset', 0.5),
            timeDifference: (args, util) => shading.objects.runTimeSampling(util, [
                {delta: 0, reference: true},
                {delta: -0.1, weight: 0}
            ], {composer: {name: 'diff', params: {gain: 2}}, opacity: 0.75})
        }
    });
};
`;

const pluginZip = async () => {
    const zip = new JSZip();
    zip.file('time-demo/shading-plugin.json', JSON.stringify({
        format: 'shading.app/plugin', formatVersion: 1, id: 'time-demo', name: 'Time Demo', version: '1.0.0',
        main: 'main.js'
    }));
    zip.file('time-demo/main.js', PLUGIN_MAIN);
    return zip.generateAsync({type: 'uint8array'});
};

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const drawAtTime = {
    opcode: 'objects_draw',
    fields: {SOURCE: 'costume'},
    inputs: {PX: reporter('operator_multiply', {NUM1: reporter('objects_timelineTime'), NUM2: 100}), PY: 0, PZ: 480}
};
const playSound = {opcode: 'sound_playattime', inputs: {SOUND_MENU: 'pop', T1: 0, T2: 10, SPEED: 1, VOLUME: 100}};

describe.each([true, false])('the shading.objects time API (compiler %s)', compiler => {
    let harness;
    let plugins;
    afterEach(() => harness && harness.dispose());

    const load = body => createHarness(buildProject({scripts: [{hat: 'event_renderframe', body}]}), {
        compiler,
        duration: 2,
        beforeLoad: async vm => {
            plugins = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
            await plugins.init();
            await plugins.install(await plugins.inspect(await pluginZip(), 'time-demo.zip'));
            await vm.extensionManager.refreshBlocks('objects');
        }
    });

    test('runWithLocalTime evaluates the substack like the local time block', async () => {
        harness = await load([{opcode: 'objects_shiftTime', substack: [drawAtTime]}]);
        const shifted = JSON.parse(await harness.seekTo(15)).children[0].configuration;
        harness.dispose();
        harness = await createHarness(buildProject({scripts: [{hat: 'event_renderframe', body: [{
            opcode: 'objects_localTime', fields: {MODE: 'offset'}, inputs: {A: 0.5, B: 0}, substack: [drawAtTime]
        }]}]}), {compiler, duration: 2});
        const local = JSON.parse(await harness.seekTo(15)).children[0].configuration;
        expect(shifted.evaluationTime).toBe(local.evaluationTime);
        expect(shifted.position.x).toBe(local.position.x);
        expect(shifted.evaluationTime).not.toBeCloseTo(0.5, 6);
    });

    test('runTimeSampling builds a TimeSample node with the plugin\'s composer and the reference last',
        async () => {
            harness = await load([{opcode: 'objects_timeDifference', substack: [playSound, drawAtTime]}]);
            const playRangedSound = jest.spyOn(harness.manager, 'playRangedSound').mockImplementation(() => {});
            const [node] = JSON.parse(await harness.seekTo(15)).children;
            expect(node.type).toBe(FRAME_GRAPH_NODE_TYPES.TIME_SAMPLE);
            expect(node.composer).toEqual({key: 'time-demo/diff', params: {gain: 2}});
            expect(node.opacity).toBe(0.75);
            expect(node.children.map(child => child.sample)).toEqual([
                {operation: 'add', order: 1, reference: false, time: -0.1, weight: 0},
                {operation: 'add', order: 0, reference: true, time: 0, weight: 1}
            ]);
            expect(node.children.map(child => child.children[0].configuration.evaluationTime))
                .toEqual([expect.closeTo(0.4, 12), expect.closeTo(0.5, 12)]);
            // Only the reference sample plays sounds.
            expect(playRangedSound).toHaveBeenCalledTimes(1);
        });

    test('the block primitives return undefined', async () => {
        harness = await load([drawAtTime]);
        expect(harness.runtime._primitives.objects_shiftTime({}, {thread: null})).toBeUndefined();
        expect(harness.runtime._primitives.objects_timeDifference({}, {thread: null})).toBeUndefined();
    });

    test('registerTimeComposer validates names and is undone with the plugin', async () => {
        harness = await load([drawAtTime]);
        const exported = plugins.getExports('time-demo');
        expect(exported.maxTimeSamples).toBe(MAX_TIME_SAMPLES);
        expect(harness.runtime.timeComposers.has('time-demo/diff')).toBe(true);
        expect(() => exported.register('diff', {layer: () => {}})).toThrow(/already registered/);
        expect(() => exported.register('Bad Name', {layer: () => {}})).toThrow(/Invalid time composer name/);
        expect(() => exported.register('no-layer', {})).toThrow(/layer/);
        const unregister = exported.register('other', {layer: () => {}});
        expect(harness.runtime.timeComposers.has('time-demo/other')).toBe(true);
        unregister();
        expect(harness.runtime.timeComposers.has('time-demo/other')).toBe(false);
        await plugins.setEnabled('time-demo', false);
        expect(harness.runtime.timeComposers.has('time-demo/diff')).toBe(false);
    });
});

describe('normalizeTimeSamples', () => {
    test('fills defaults and moves the reference sample last', () => {
        expect(normalizeTimeSamples([
            {delta: 'x', weight: -1, operation: 'screen', reference: true},
            {delta: -0.1, weight: Infinity, operation: 'MAX', order: 5},
            null
        ])).toEqual([
            {delta: -0.1, weight: 1, operation: 'max', order: 5, reference: false},
            {delta: 0, weight: 1, operation: 'add', order: 2, reference: false},
            {delta: 0, weight: 0, operation: 'add', order: 0, reference: true}
        ]);
    });

    test('uses the last sample as the reference without one and the first of several', () => {
        expect(normalizeTimeSamples([{delta: 1}, {delta: 2}]).map(sample => sample.reference)).toEqual([false, true]);
        const several = normalizeTimeSamples([{delta: 1, reference: true}, {delta: 2, reference: true}, {delta: 3}]);
        expect(several.map(sample => [sample.delta, sample.reference])).toEqual([[2, false], [3, false], [1, true]]);
        expect(normalizeTimeSamples([])).toEqual([]);
        expect(normalizeTimeSamples(null)).toEqual([]);
    });

    test('keeps MAX_TIME_SAMPLES samples, the lowest orders and the reference', () => {
        const samples = Array.from({length: 65}, (unused, index) => ({delta: -index, order: 64 - index}));
        samples[10].reference = true;
        const normalized = normalizeTimeSamples(samples);
        expect(normalized).toHaveLength(64);
        expect(normalized[63]).toEqual(expect.objectContaining({delta: -10, reference: true}));
        // Order 64 (delta 0) is the one dropped.
        expect(normalized.map(sample => sample.delta)).not.toContain(0);
    });
});
