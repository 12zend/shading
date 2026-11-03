jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {
    getMovieProjectFeatures,
    getRuntimeMovieProjectFeatures
} from '../../../scratch-vm/src/lib/project-format';
import {
    PRIMARY,
    collectSimulationDefinitions,
    captureVariables,
    syncSimulations
} from '../../../scratch-vm/src/lib/simulation-blocks';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const state = key => reporter('simulation_state', {KEY: key});
const times = (a, b) => reporter('operator_multiply', {NUM1: a, NUM2: b});
const plus = (a, b) => reporter('operator_add', {NUM1: a, NUM2: b});
const dt = reporter('simulation_dt');

const initializeHat = (name, start = 0, rate = 120) => ({
    opcode: 'simulation_whenInitialized',
    inputs: {NAME: name, START: start, RATE: rate}
});
const stepHat = name => ({opcode: 'simulation_whenStepped', inputs: {NAME: name}});

// A ball falling under gravity: semi-implicit Euler on vy and y.
const fallingBall = ({rate = 120, extraStep = [], extraInitialize = [], variables = {}, extraScripts = []} = {}) => (
    buildProject({
        variables,
        scripts: [{
            hat: initializeHat('ball', 0, rate),
            body: [
                {opcode: 'simulation_setState', inputs: {KEY: 'y', VALUE: 100}},
                {opcode: 'simulation_setState', inputs: {KEY: 'vy', VALUE: 0}},
                ...extraInitialize
            ]
        }, {
            hat: stepHat('ball'),
            body: [
                {opcode: 'simulation_changeState', inputs: {KEY: 'vy', VALUE: times(-9.8, dt)}},
                {opcode: 'simulation_changeState', inputs: {KEY: 'y', VALUE: times(state('vy'), dt)}},
                ...extraStep
            ]
        }, {
            hat: 'event_renderframe',
            body: [{
                opcode: 'objects_draw',
                fields: {SOURCE: 'costume'},
                inputs: {
                    PX: 0,
                    PY: reporter('simulation_stateAt', {NAME: 'ball', KEY: 'y', TIME: ''}),
                    PZ: 480
                }
            }]
        }, ...extraScripts]
    })
);

const expectedBallY = time => {
    let y = 100;
    let vy = 0;
    const steps = Math.round(time * 120);
    for (let step = 0; step < steps; step++) {
        vy += -9.8 / 120;
        y += vy / 120;
    }
    return y;
};

const sample = (harness, key, time, name = 'ball') => harness.runtime.simulationRuntime.sample(name, key, time);

describe.each([true, false])('Simulation blocks (compiler %s)', compiler => {
    let harness;
    afterEach(() => harness && harness.dispose());

    const load = async project => {
        harness = await createHarness(project, {compiler, duration: 2});
        syncSimulations(harness.vm);
        return harness;
    };

    test('computes a simulation from its initialize and step scripts', async () => {
        await load(fallingBall());
        const result = harness.runtime.simulationRuntime.ensureAll(1);
        expect(result).toEqual({ready: true, progress: 1, errors: []});
        expect(sample(harness, 'y', 1)).toBeCloseTo(expectedBallY(1), 9);
        expect(sample(harness, 'y', 0)).toBe(100);
        expect(sample(harness, 'y', 0.5 / 120)).toBeCloseTo((100 + expectedBallY(1 / 120)) / 2, 9);
    });

    test('never starts the simulation hats from the green flag, render frames or broadcasts', async () => {
        await load(fallingBall({extraScripts: [{
            hat: 'event_whenflagclicked',
            body: [{opcode: 'control_wait', inputs: {DURATION: 0}}]
        }]}));
        const hats = new Set(Object.values(harness.runtime.targets[1].blocks._blocks)
            .filter(block => block.opcode.startsWith('simulation_when'))
            .map(block => block.id));
        const started = [];
        const pushThread = harness.runtime._pushThread.bind(harness.runtime);
        harness.runtime._pushThread = (id, ...args) => {
            started.push(id);
            return pushThread(id, ...args);
        };
        harness.vm.greenFlag();
        harness.runtime.startHats('event_renderframe');
        harness.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
        for (let tick = 0; tick < 3; tick++) harness.step();
        expect(started.length).toBeGreaterThan(0);
        expect(started.filter(id => hats.has(id))).toEqual([]);
        expect(harness.runtime.threads.filter(thread => hats.has(thread.topBlock))).toEqual([]);
    });

    test('reads the hat start and rate; a reporter in an input is evaluated once', async () => {
        const project = fallingBall({rate: 60});
        await load(project);
        const [definition] = collectSimulationDefinitions(harness.runtime);
        expect(definition).toEqual(expect.objectContaining({name: 'ball', start: 0, rate: 60}));
        const blocks = harness.runtime.targets[1].blocks;
        const hat = Object.values(blocks._blocks).find(block => block.opcode === 'simulation_whenInitialized');
        for (const [id, value] of [['rate-a', '20'], ['rate-b', '40']]) {
            blocks.createBlock({
                id, opcode: 'math_number', parent: 'rate-reporter', next: null, shadow: true,
                topLevel: false, fields: {NUM: {name: 'NUM', value}}, inputs: {}
            });
        }
        blocks.createBlock({
            id: 'rate-reporter', opcode: 'operator_add', parent: hat.id, next: null, shadow: false,
            topLevel: false, fields: {}, inputs: {
                NUM1: {name: 'NUM1', block: 'rate-a', shadow: 'rate-a'},
                NUM2: {name: 'NUM2', block: 'rate-b', shadow: 'rate-b'}
            }
        });
        hat.inputs.RATE.block = 'rate-reporter';
        expect(collectSimulationDefinitions(harness.runtime)[0].rate).toBe(60);
    });

    test('a step that draws, waits or calls a custom block that waits is not computed', async () => {
        for (const extraStep of [
            [{opcode: 'objects_draw', fields: {SOURCE: 'costume'}, inputs: {PX: 0, PY: 0, PZ: 480}}],
            [{opcode: 'control_wait', inputs: {DURATION: 0}}],
            [{opcode: 'objects_localTime', fields: {MODE: 'offset'}, inputs: {A: 1, B: 0}, substack: []}]
        ]) {
            await load(fallingBall({extraStep}));
            const result = harness.runtime.simulationRuntime.ensureAll(1);
            expect(result.ready).toBe(false);
            expect(result.errors[0].error.message).toMatch(/cannot run in a simulation/);
            expect(sample(harness, 'y', 1)).toBeUndefined();
            harness.dispose();
        }
        harness = null;
    });

    test('writes outside a simulation do nothing, warn once and return undefined', async () => {
        await load(fallingBall());
        const blocks = harness.runtime.ext_simulation || harness.vm.extensionManager;
        const primitives = harness.runtime._primitives;
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const util = {thread: {}};
        for (const opcode of ['simulation_setState', 'simulation_changeState', 'simulation_addToList',
            'simulation_replaceListItem', 'simulation_clearList']) {
            expect(primitives[opcode]({KEY: 'y', VALUE: 1, INDEX: 1}, util)).toBeUndefined();
            expect(primitives[opcode]({KEY: 'y', VALUE: 1, INDEX: 1}, util)).toBeUndefined();
        }
        expect(warn.mock.calls.filter(([message]) => /only changes simulation state/.test(message)))
            .toHaveLength(5);
        warn.mockRestore();
        expect(blocks).toBeDefined();
        harness.runtime.simulationRuntime.ensureAll(1);
        expect(sample(harness, 'y', 0)).toBe(100);
    });

    test('state writes inside a step return undefined too', async () => {
        await load(fallingBall());
        const results = [];
        const primitives = harness.runtime._primitives;
        for (const opcode of ['simulation_setState', 'simulation_changeState', 'simulation_addToList',
            'simulation_replaceListItem', 'simulation_clearList']) {
            const primitive = primitives[opcode];
            primitives[opcode] = (args, util) => {
                const result = primitive(args, util);
                results.push(result);
                return result;
            };
        }
        harness.runtime.simulationRuntime.ensureAll(0.1);
        expect(results.length).toBeGreaterThan(0);
        expect(results.every(result => typeof result === 'undefined')).toBe(true);
    });

    test('state lists hold particles', async () => {
        await load(fallingBall({
            extraInitialize: [{opcode: 'simulation_clearList', inputs: {KEY: 'p'}}],
            extraStep: [
                {opcode: 'simulation_addToList', inputs: {KEY: 'p', VALUE: reporter('simulation_stepIndex')}},
                {
                    opcode: 'control_if',
                    inputs: {CONDITION: reporter('operator_gt', {
                        OPERAND1: reporter('simulation_listLength', {KEY: 'p'}), OPERAND2: 3
                    })},
                    substack: [{
                        opcode: 'simulation_replaceListItem',
                        inputs: {KEY: 'p', INDEX: 1, VALUE: reporter('simulation_listItem', {KEY: 'p', INDEX: 2})}
                    }]
                }
            ]
        }));
        harness.runtime.simulationRuntime.ensureAll(5 / 120);
        expect(sample(harness, 'p', 5 / 120)).toEqual([1, 1, 2, 3, 4]);
        expect(sample(harness, 'p', 2 / 120)).toEqual([0, 1]);
    });

    test('reads ordinary variables as their values at initialize and keeps writes inside the step', async () => {
        await load(fallingBall({
            variables: {gravity: 2, scratch: 0},
            extraStep: [
                {opcode: 'data_changevariableby', fields: {VARIABLE: 'scratch'}, inputs: {VALUE: 1}},
                {opcode: 'simulation_setState', inputs: {
                    KEY: 'seen', VALUE: plus(reporter('data_variable', {}, {VARIABLE: 'gravity'}),
                        reporter('data_variable', {}, {VARIABLE: 'scratch'}))
                }}
            ]
        }));
        const stage = harness.runtime.getTargetForStage();
        const variable = name => stage.lookupVariableByNameAndType(name, '');
        variable('gravity').value = 7;
        syncSimulations(harness.vm);
        variable('gravity').value = 1000;
        harness.runtime.simulationRuntime.ensureAll(0.5);
        expect(sample(harness, 'seen', 0.5)).toBe(8);
        expect(variable('scratch').value).toBe(0);
        // A different value at initialize is a different simulation.
        const hash = collectSimulationDefinitions(harness.runtime, captureVariables(harness.runtime))[0].hash;
        variable('gravity').value = 7;
        expect(collectSimulationDefinitions(harness.runtime, captureVariables(harness.runtime))[0].hash)
            .not.toBe(hash);
    });

    test('the timer, mouse and keys are fixed inside a step and pick random is seeded', async () => {
        await load(fallingBall({extraStep: [
            {opcode: 'simulation_setState', inputs: {KEY: 'timer', VALUE: reporter('sensing_timer')}},
            {opcode: 'simulation_setState', inputs: {KEY: 'mouse', VALUE: reporter('sensing_mousex')}},
            {opcode: 'simulation_setState', inputs: {KEY: 'random', VALUE: reporter('operator_random', {
                FROM: 1, TO: 1000000
            })}},
            {opcode: 'simulation_setState', inputs: {KEY: 'seeded', VALUE: reporter('simulation_seededRandom', {
                SEED: 3, FROM: 0, TO: 1000000
            })}}
        ]}));
        harness.runtime.ioDevices.mouse._scratchX = 120;
        harness.runtime.simulationRuntime.ensureAll(1);
        expect(sample(harness, 'timer', 1)).toBe(0);
        expect(sample(harness, 'mouse', 1)).toBe(0);
        const randomValues = [0.1, 0.5, 1].map(time => sample(harness, 'random', time));
        const seeded = [0.1, 0.5, 1].map(time => sample(harness, 'seeded', time));
        harness.dispose();
        await load(fallingBall({extraStep: [
            {opcode: 'simulation_setState', inputs: {KEY: 'timer', VALUE: reporter('sensing_timer')}},
            {opcode: 'simulation_setState', inputs: {KEY: 'mouse', VALUE: reporter('sensing_mousex')}},
            {opcode: 'simulation_setState', inputs: {KEY: 'random', VALUE: reporter('operator_random', {
                FROM: 1, TO: 1000000
            })}},
            {opcode: 'simulation_setState', inputs: {KEY: 'seeded', VALUE: reporter('simulation_seededRandom', {
                SEED: 3, FROM: 0, TO: 1000000
            })}}
        ]}));
        harness.runtime.simulationRuntime.ensureAll(1);
        expect([0.1, 0.5, 1].map(time => sample(harness, 'random', time))).toEqual(randomValues);
        expect([0.1, 0.5, 1].map(time => sample(harness, 'seeded', time))).toEqual(seeded);
        expect(new Set(seeded).size).toBe(3);
    });

    test('a render frame reads S(t) at its time and asks for times that are not computed', async () => {
        await load(fallingBall());
        const simulationRuntime = harness.runtime.simulationRuntime;
        // Nothing computed yet: the read falls back to S0... once S0 exists.
        simulationRuntime.ensureAll(0);
        await harness.seekTo(15);
        const drawnY = () => JSON.parse(harness.frames.committed).children[0].configuration.position.y;
        expect(drawnY()).toBe(100);
        expect(simulationRuntime.takeRequestedTimes()).toEqual([{name: 'ball', time: 0.5}]);
        simulationRuntime.ensureAll(0.5);
        await harness.seekTo(15);
        expect(drawnY()).toBeCloseTo(expectedBallY(0.5), 9);
        expect(simulationRuntime.hasRequestedTimes()).toBe(false);
    });

    test('render-frame seeded random is the same for the same seed, time and call order', async () => {
        await load(buildProject({scripts: [{
            hat: 'event_renderframe',
            body: [1, 2].map(() => ({
                opcode: 'objects_draw',
                fields: {SOURCE: 'costume'},
                inputs: {PX: reporter('simulation_seededRandom', {SEED: 9, FROM: 0, TO: 1000000}), PY: 0, PZ: 480}
            }))
        }]}));
        const read = async frame => {
            await harness.seekTo(frame);
            return JSON.parse(harness.frames.committed).children.map(node => node.configuration.position.x);
        };
        const first = await read(10);
        expect(first[0]).not.toBe(first[1]);
        expect(await read(11)).not.toEqual(first);
        expect(await read(10)).toEqual(first);
        const exported = await harness.exportRange({start: 0, end: 0.5});
        expect(JSON.parse(exported.get(10)).children.map(node => node.configuration.position.x)).toEqual(first);
    });
});

describe('Simulation project format', () => {
    test('detects the simulation feature and treats the new blocks as Movie blocks', () => {
        const features = getMovieProjectFeatures(fallingBall());
        expect(features).toEqual(expect.arrayContaining(['movie-blocks', 'simulation']));
        const localTime = buildProject({scripts: [{
            hat: 'event_whenflagclicked',
            body: [{opcode: 'objects_localTime', fields: {MODE: 'offset'}, inputs: {A: 1, B: 0}, substack: []}]
        }]});
        expect(getMovieProjectFeatures(localTime)).toEqual(['movie-blocks']);
        const plain = buildProject({scripts: [{hat: 'event_whenflagclicked', body: []}]});
        expect(getMovieProjectFeatures(plain)).toEqual([]);
    });

    test('detects the feature on a running project', async () => {
        const harness = await createHarness(fallingBall(), {duration: 1});
        expect(getRuntimeMovieProjectFeatures(harness.runtime)).toEqual(expect.arrayContaining(['simulation']));
        harness.dispose();
    });

    test('uses its own category colour', () => {
        expect(PRIMARY).toBe('#2E8B8B');
    });
});
