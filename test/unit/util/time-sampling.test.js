jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {FRAME_GRAPH_NODE_TYPES} from '../../../scratch-vm/src/lib/movie-frame-graph';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const times = (a, b) => reporter('operator_multiply', {NUM1: a, NUM2: b});

const drawAtTime = {
    opcode: 'objects_draw',
    fields: {SOURCE: 'costume'},
    inputs: {PX: times(reporter('objects_timelineTime'), 100), PY: 0, PZ: 480}
};

const motionBlur = (samples, substack, angle = 180, phase = -90) => ({
    opcode: 'objects_motionBlur', inputs: {ANGLE: angle, PHASE: phase, SAMPLES: samples}, substack
});
const echo = (mode, substack, count = 3) => ({
    opcode: 'objects_echo', fields: {MODE: mode}, inputs: {COUNT: count, INTERVAL: -0.1, DECAY: 0.5}, substack
});

const project = (body, {variables = {}, extraScripts = []} = {}) => buildProject({
    variables,
    scripts: [{hat: 'event_renderframe', body}, ...extraScripts]
});

const graphAt = async (harness, frame) => JSON.parse(await harness.seekTo(frame));

describe.each([true, false])('time sampling blocks (compiler %s)', compiler => {
    let harness;
    afterEach(() => harness && harness.dispose());

    test('motion blur draws K samples across the shutter with equal weights, the reference last', async () => {
        harness = await createHarness(project([motionBlur(4, [drawAtTime])]), {compiler, duration: 1});
        const graph = await graphAt(harness, 15);
        const [node] = graph.children;
        expect(node.type).toBe(FRAME_GRAPH_NODE_TYPES.TIME_SAMPLE);
        expect(node.children).toHaveLength(4);
        const t = 0.5;
        // Shutter 180 degrees, phase -90: samples at t + (-90 + 180 * (i + 0.5) / 4) / 360 / 30.
        const expected = [0, 1, 2, 3].map(index => t + ((-90 + (180 * (index + 0.5) / 4)) / 360 / 30));
        const byOrder = node.children.slice().sort((a, b) => a.sample.order - b.sample.order);
        byOrder.forEach((child, index) => {
            expect(child.sample.weight).toBe(0.25);
            expect(child.sample.operation).toBe('add');
            const draw = child.children[0].configuration;
            expect(draw.evaluationTime).toBeCloseTo(expected[index], 12);
            expect(draw.position.x).toBeCloseTo(expected[index] * 100, 9);
        });
        // The sample nearest the shutter's centre (t) is evaluated last.
        const last = node.children[node.children.length - 1];
        expect(last.sample.reference).toBe(true);
        expect(Math.abs(last.sample.time)).toBeCloseTo(Math.abs(expected[2] - t), 12);
        expect(node.children.filter(child => child.sample.reference)).toHaveLength(1);
    });

    test('one-sample motion blur draws exactly what the substack draws without it', async () => {
        harness = await createHarness(project([motionBlur(1, [drawAtTime])]), {compiler, duration: 1});
        const blurred = await harness.exportRange({start: 0, end: 1});
        harness.dispose();
        harness = await createHarness(project([drawAtTime]), {compiler, duration: 1});
        const plain = await harness.exportRange({start: 0, end: 1});
        // The same draw (block IDs differ between the two projects); scripts/frame-hash compares the pixels.
        const drawn = signature => JSON.parse(signature).children.map(({type, configuration}) => ({
            type,
            evaluationTime: configuration.evaluationTime,
            position: Object.values(configuration.position).map(Number)
        }));
        for (const frame of [0, 9, 30]) expect(drawn(blurred.get(frame))).toEqual(drawn(plain.get(frame)));
    });

    test.each([
        ['composite in back', 'over', [2, 1, 0]],
        ['composite in front', 'over', [0, 1, 2]],
        ['add', 'add', [0, 1, 2]],
        ['max', 'max', [0, 1, 2]]
    ])('echo %s draws copies at t + i * interval with opacity decay ^ i', async (mode, operation, order) => {
        harness = await createHarness(project([echo(mode, [drawAtTime])]), {compiler, duration: 1});
        const [node] = (await graphAt(harness, 15)).children;
        const copies = node.children.map(child => ({
            time: child.children[0].configuration.evaluationTime,
            weight: child.sample.weight,
            operation: child.sample.operation,
            order: child.sample.order,
            reference: child.sample.reference
        })).sort((a, b) => b.time - a.time);
        expect(copies.map(copy => copy.time)).toEqual([0.5, 0.4, 0.30000000000000004].map(time => expect.closeTo(time, 12)));
        expect(copies.map(copy => copy.weight)).toEqual([1, 0.5, 0.25]);
        expect(copies.map(copy => copy.operation)).toEqual([operation, operation, operation]);
        expect(copies.map(copy => copy.order)).toEqual(order);
        expect(copies.map(copy => copy.reference)).toEqual([true, false, false]);
        // i = 0 (now) is evaluated last.
        expect(node.children[node.children.length - 1].sample.reference).toBe(true);
    });

    test('a sound inside a time-sampling block plays once per frame', async () => {
        harness = await createHarness(project([motionBlur(8, [
            {opcode: 'sound_playattime', inputs: {SOUND_MENU: 'pop', T1: 0, T2: 10, SPEED: 1, VOLUME: 100}},
            drawAtTime
        ])]), {compiler, duration: 1});
        const playRangedSound = jest.spyOn(harness.manager, 'playRangedSound').mockImplementation(() => {});
        await harness.seekTo(10);
        expect(playRangedSound).toHaveBeenCalledTimes(1);
        playRangedSound.mockClear();
        await harness.exportRange({start: 0, end: 0.2});
        expect(playRangedSound).toHaveBeenCalledTimes(7);
    });

    test('variables set inside end with the reference sample\'s values', async () => {
        harness = await createHarness(project([
            echo('add', [{
                opcode: 'data_setvariableto',
                fields: {VARIABLE: 'seen'},
                inputs: {VALUE: reporter('objects_timelineTime')}
            }, drawAtTime], 4),
            {opcode: 'data_setvariableto', fields: {VARIABLE: 'after'}, inputs: {VALUE: reporter('data_variable', {}, {
                VARIABLE: 'seen'
            })}}
        ], {variables: {seen: 0, after: 0}}), {compiler, duration: 1});
        await harness.seekTo(20);
        const stage = harness.runtime.getTargetForStage();
        expect(Number(stage.lookupVariableByNameAndType('after', '').value)).toBeCloseTo(20 / 30, 12);
    });

    test('each sample reads the simulation at its own time', async () => {
        harness = await createHarness(buildProject({scripts: [{
            hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'clock', START: 0, RATE: 240}},
            body: [{opcode: 'simulation_setState', inputs: {KEY: 'x', VALUE: 0}}]
        }, {
            hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'clock'}},
            body: [{opcode: 'simulation_changeState', inputs: {KEY: 'x', VALUE: 1}}]
        }, {
            hat: 'event_renderframe',
            body: [echo('add', [{
                opcode: 'objects_draw',
                fields: {SOURCE: 'costume'},
                inputs: {PX: reporter('simulation_stateAt', {NAME: 'clock', KEY: 'x', TIME: ''}), PY: 0, PZ: 480}
            }], 3)]
        }]}), {compiler, duration: 4});
        // At 3 s the copies are 0.1 and 0.2 s earlier; S(t) = 240 t steps.
        const [node] = (await graphAt(harness, 90)).children;
        const xs = node.children.map(child => child.children[0].configuration.position.x).sort((a, b) => b - a);
        expect(xs).toEqual([720, 696, 672].map(value => expect.closeTo(value, 9)));
    });

    test('the block primitives return undefined', async () => {
        harness = await createHarness(project([drawAtTime]), {compiler, duration: 1});
        const objectBlocks = harness.runtime.objectBlocks;
        expect(objectBlocks.motionBlur({ANGLE: 180, PHASE: -90, SAMPLES: 8}, {thread: null})).toBeUndefined();
        expect(objectBlocks.echo({COUNT: 4, INTERVAL: -0.05, DECAY: 0.5, MODE: 'add'}, {thread: null}))
            .toBeUndefined();
        expect(harness.runtime._primitives.objects_motionBlur({ANGLE: 180, PHASE: -90, SAMPLES: 2}, {thread: null}))
            .toBeUndefined();
    });
});

describe('time sampling frame graph execution', () => {
    test('accumulates each sample layer in composite order with its weight, then composites once', async () => {
        const harness = await createHarness(project([echo('composite in back', [drawAtTime])]), {duration: 1});
        const graph = JSON.parse(await harness.seekTo(15));
        const calls = [];
        let layer = 0;
        harness.manager.penFX = {
            beginAccumulation: () => calls.push(['beginAccumulation']) && true,
            beginLayer: () => calls.push(['beginLayer']) && true,
            endLayer: () => ({id: ++layer}),
            accumulateLayer: (sample, weight, operation) => calls.push(['accumulate', sample.id, weight, operation]),
            releaseLayer: () => {},
            endAccumulation: () => calls.push(['endAccumulation'])
        };
        harness.manager.drawObjectImmediately = jest.fn((target, configuration) => {
            calls.push(['draw', configuration.evaluationTime]);
        });
        // The harness records graphs instead of executing them; execute this one with the real executor.
        const MovieAssetManager = Object.getPrototypeOf(harness.manager);
        const node = graph.children[0];
        node.children.forEach(child => {
            child.children.forEach(draw => {
                draw.target = harness.runtime.targets[1];
            });
        });
        await MovieAssetManager.executeFrameGraphTimeSample.call(harness.manager, node, {
            generation: harness.manager.frameGraphRenderer.generation,
            resources: {depth: null},
            transforms: []
        });
        expect(calls).toEqual([
            ['beginAccumulation'],
            ['beginLayer'], ['draw', expect.closeTo(0.3, 12)], ['accumulate', 1, 0.25, 'over'],
            ['beginLayer'], ['draw', expect.closeTo(0.4, 12)], ['accumulate', 2, 0.5, 'over'],
            ['beginLayer'], ['draw', expect.closeTo(0.5, 12)], ['accumulate', 3, 1, 'over'],
            ['endAccumulation']
        ]);
        harness.dispose();
    });
});
