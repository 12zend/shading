import {SimulationCache} from '../../../scratch-vm/src/lib/simulation/simulation-cache';
import {canonicalScript, hashSimulationDefinition} from '../../../scratch-vm/src/lib/simulation/simulation-hash';
import {interpolateValue} from '../../../scratch-vm/src/lib/simulation/simulation-interp';
import {SimulationRuntime, clampRate} from '../../../scratch-vm/src/lib/simulation/simulation-runtime';
import {SimulationState} from '../../../scratch-vm/src/lib/simulation/simulation-state';
import {
    createSeededRandom,
    hashParts,
    randomInRange,
    seededRandomValue
} from '../../../scratch-vm/src/lib/simulation/seeded-random';

// A point under gravity, integrated with semi-implicit Euler; the world serializes as JSON bytes.
const createFakeSolver = () => {
    const solver = {
        id: 'fake-gravity',
        worlds: 0,
        create: settings => {
            solver.worlds++;
            return {gravity: Number(settings.gravity) || -10, bodies: {}};
        },
        beforeStep: () => {},
        step: (world, dt) => {
            for (const body of Object.values(world.bodies)) {
                body.vy += world.gravity * dt;
                body.y += body.vy * dt;
            }
        },
        snapshot: world => new TextEncoder().encode(JSON.stringify(world)),
        restore: bytes => {
            solver.worlds++;
            return JSON.parse(new TextDecoder().decode(bytes));
        },
        dispose: () => {
            solver.worlds--;
        },
        readPose: (world, name) => ({
            position: {x: 0, y: world.bodies[name].y, z: 0},
            quaternion: {x: 0, y: 0, z: 0, w: 1}
        })
    };
    return solver;
};

const executor = {
    initialize: (definition, state, context) => {
        const world = context.createWorld('fake-gravity', {gravity: -9.8});
        world.bodies.ball = {y: 100, vy: 0};
        state.handles.set('ball', 1);
        state.set('count', 0);
        state.set('heading', 350, 'angle');
        state.set('label', 'start');
        state.set('trail', []);
    },
    step: (definition, state, context) => {
        state.set('count', state.get('count') + 1);
        state.set('heading', (state.get('heading') + 7) % 360, 'angle');
        state.set('label', `step ${context.stepIndex + 1}`);
        state.set('noise', context.random('seed'));
        const trail = state.get('trail').concat([context.stepIndex]);
        state.set('trail', trail.slice(-5));
    }
};

const makeRuntime = (options = {}) => {
    const runtime = new SimulationRuntime({executor, ...options});
    runtime.registerSolver(createFakeSolver());
    runtime.syncDefinitions([{name: 'ball', hash: 'h1', start: 0, rate: 120}]);
    return runtime;
};

describe('seeded random', () => {
    test('is reproducible and depends on every seed part', () => {
        expect(seededRandomValue('sim', 1, 10, 0)).toBe(seededRandomValue('sim', 1, 10, 0));
        const values = new Set([
            seededRandomValue('sim', 1, 10, 0),
            seededRandomValue('sim', 1, 10, 1),
            seededRandomValue('sim', 1, 11, 0),
            seededRandomValue('sim', 2, 10, 0),
            seededRandomValue('other', 1, 10, 0)
        ]);
        expect(values.size).toBe(5);
        expect(hashParts(1, 'a')).not.toBe(hashParts('1', 'a'));
        const random = createSeededRandom(42);
        const samples = Array.from({length: 1000}, () => random());
        expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...samples)).toBeLessThan(1);
        const again = createSeededRandom(42);
        expect(Array.from({length: 1000}, () => again())).toEqual(samples);
    });

    test('maps to a range like pick random', () => {
        expect(randomInRange(0, 1, 10)).toBe(1);
        expect(randomInRange(0.9999, 1, 10)).toBe(10);
        expect(randomInRange(0.5, 10, 1)).toBe(6);
        expect(randomInRange(0.5, 0, 1.5)).toBe(0.75);
    });
});

describe('simulation state and interpolation', () => {
    test('snapshots are deep copies in insertion order', () => {
        const state = new SimulationState();
        state.set('b', 1);
        state.set('a', [1, 2]);
        state.set('c', NaN);
        const snapshot = state.snapshot();
        state.get('a').push(3);
        state.set('b', 2);
        expect(Array.from(snapshot.values.keys())).toEqual(['b', 'a', 'c']);
        expect(snapshot.values.get('a')).toEqual([1, 2]);
        expect(snapshot.values.get('b')).toBe(1);
        expect(snapshot.values.get('c')).toBe(0);
        const restored = SimulationState.fromSnapshot(snapshot);
        restored.get('a').push(9);
        expect(snapshot.values.get('a')).toEqual([1, 2]);
    });

    test('interpolates numbers, angles, quaternions and poses but not strings or list lengths', () => {
        expect(interpolateValue(0, 10, 0.25)).toBe(2.5);
        expect(interpolateValue(350, 10, 0.5, 'angle')).toBeCloseTo(360);
        expect(interpolateValue(10, 350, 0.5, 'angle')).toBeCloseTo(0);
        const half = interpolateValue([0, 0, 0, 1], [0, 0, 1, 0], 0.5, 'quaternion');
        expect(half[2]).toBeCloseTo(Math.SQRT1_2);
        expect(half[3]).toBeCloseTo(Math.SQRT1_2);
        // q and -q are the same rotation: interpolation takes the short way.
        const short = interpolateValue([0, 0, 0, 1], [0, 0, 0, -1], 0.5, 'quaternion');
        expect(short[3]).toBeCloseTo(1);
        const pose = interpolateValue([0, 10, 0, 0, 0, 0, 1], [2, 20, 0, 0, 0, 1, 0], 0.5, 'pose');
        expect(pose.slice(0, 3)).toEqual([1, 15, 0]);
        expect(interpolateValue('a', 'b', 0.9)).toBe('a');
        expect(interpolateValue(true, false, 0.9)).toBe(true);
        expect(interpolateValue([1, 2], [3, 4, 5], 0.5)).toEqual([1, 2]);
        expect(interpolateValue([1, 'x'], [3, 'y'], 0.5)).toEqual([2, 'x']);
    });
});

describe('simulation cache', () => {
    test('computes forward and reads S(t) between steps', () => {
        const runtime = makeRuntime();
        expect(runtime.ensureAll(1).ready).toBe(true);
        expect(runtime.sample('ball', 'count', 1)).toBe(120);
        expect(runtime.sample('ball', 'count', 1.5 / 120)).toBeCloseTo(1.5);
        expect(runtime.sample('ball', 'label', 1.5 / 120)).toBe('step 1');
        // Before t0 the simulation is S0.
        expect(runtime.sample('ball', 'count', -3)).toBe(0);
        const pose = runtime.readPose('ball', 'ball', 1);
        expect(pose.position.y).toBeLessThan(100);
        expect(runtime.hasRequestedTimes()).toBe(false);
    });

    test('reads the same S(t) at 30 and 60 frames per second', () => {
        const at30 = makeRuntime();
        const at60 = makeRuntime();
        for (let frame = 0; frame <= 60; frame++) at30.ensureAll(frame / 30);
        for (let frame = 0; frame <= 120; frame++) at60.ensureAll(frame / 60);
        for (let frame = 0; frame <= 60; frame++) {
            const time = frame / 30;
            for (const key of ['count', 'heading', 'noise', 'trail', 'pose:ball']) {
                expect(at60.sample('ball', key, (frame * 2) / 60)).toEqual(at30.sample('ball', key, time));
            }
        }
    });

    test('reads recent steps from the ring buffer without computing', () => {
        const runtime = makeRuntime();
        runtime.ensureAll(5);
        const cache = runtime.getSimulation('ball');
        const computed = cache.stepsComputed;
        expect(runtime.isAvailable('ball', 4.2)).toBe(true);
        expect(runtime.sample('ball', 'count', 4.2)).toBeCloseTo(504);
        expect(runtime.isAvailable('ball', 3.5)).toBe(true);
        expect(cache.stepsComputed).toBe(computed);
    });

    test('recomputes older steps from a checkpoint without moving the live state', () => {
        const reference = makeRuntime();
        reference.ensureAll(1.3 + (0.5 / 120));
        const runtime = makeRuntime();
        runtime.ensureAll(5);
        const cache = runtime.getSimulation('ball');
        const time = 1.3 + (0.5 / 120);
        expect(runtime.isAvailable('ball', time)).toBe(false);
        expect(runtime.sample('ball', 'count', time)).toBe(cache.sample('count', 1).value);
        expect(runtime.takeRequestedTimes()).toEqual([{name: 'ball', time}]);
        const before = cache.stepsComputed;
        expect(runtime.ensureTimes([{name: 'ball', time}]).ready).toBe(true);
        // From the 1.0 s checkpoint to step 157: 37 steps.
        expect(cache.stepsComputed - before).toBe(37);
        expect(cache.live.index).toBe(600);
        for (const key of ['count', 'heading', 'noise', 'trail', 'label', 'pose:ball']) {
            expect(runtime.sample('ball', key, time)).toEqual(reference.sample('ball', key, time));
        }
        expect(runtime.hasRequestedTimes()).toBe(false);
    });

    test('still seeks correctly after checkpoints were dropped for memory', () => {
        const reference = makeRuntime();
        reference.ensureAll(2.2);
        const runtime = makeRuntime({memoryLimit: 64 * 1024});
        runtime.ensureAll(6);
        const cache = runtime.getSimulation('ball');
        expect(cache.memoryBytes).toBeLessThanOrEqual(cache.memoryLimit);
        expect(cache.checkpoints.has(0)).toBe(true);
        expect(cache.checkpoints.size).toBeLessThan(13);
        expect(runtime.ensureTimes([{name: 'ball', time: 2.2}]).ready).toBe(true);
        expect(runtime.sample('ball', 'pose:ball', 2.2)).toEqual(reference.sample('ball', 'pose:ball', 2.2));
        expect(runtime.sample('ball', 'noise', 2.2)).toEqual(reference.sample('ball', 'noise', 2.2));
    });

    test('stops at the budget and resumes', () => {
        let clock = 0;
        const runtime = new SimulationRuntime({executor, now: () => clock});
        runtime.registerSolver(createFakeSolver());
        runtime.syncDefinitions([{name: 'ball', hash: 'h', start: 0, rate: 120}]);
        const cache = runtime.getSimulation('ball');
        const step = cache.stepState;
        cache.stepState = (...args) => {
            clock += 1;
            step(...args);
        };
        expect(runtime.ensureAll(1, 10).ready).toBe(false);
        expect(cache.live.index).toBeLessThan(120);
        let ticks = 0;
        while (!runtime.ensureAll(1, 10).ready) ticks++;
        expect(ticks).toBeGreaterThan(5);
        expect(runtime.sample('ball', 'count', 1)).toBe(120);
    });

    test('several times that each take longer than the budget are all computed eventually', () => {
        let clock = 0;
        const runtime = new SimulationRuntime({executor, now: () => clock});
        runtime.registerSolver(createFakeSolver());
        runtime.syncDefinitions([{name: 'ball', hash: 'h', start: 0, rate: 120}]);
        runtime.ensureAll(5);
        const cache = runtime.getSimulation('ball');
        const step = cache.stepState;
        cache.stepState = (...args) => {
            clock += 1;
            step(...args);
        };
        // Three times away from the live state and the checkpoints, each needing about 50 steps, 10 per call.
        const requests = [0.4, 1.4, 2.4].map(time => ({name: 'ball', time}));
        let calls = 0;
        while (!runtime.ensureTimes(requests, 10).ready) {
            calls++;
            expect(calls).toBeLessThan(100);
        }
        expect(requests.every(({time}) => runtime.isAvailable('ball', time))).toBe(true);
        expect(runtime.sample('ball', 'count', 1.4)).toBe(168);
    });

    test('keeps the computed steps when a definition keeps its hash', () => {
        const runtime = makeRuntime();
        runtime.ensureAll(1);
        const cache = runtime.getSimulation('ball');
        expect(runtime.syncDefinitions([{name: 'ball', hash: 'h1', start: 0, rate: 120}])).toEqual([]);
        expect(runtime.getSimulation('ball')).toBe(cache);
        expect(runtime.syncDefinitions([{name: 'ball', hash: 'h2', start: 0, rate: 120}])).toEqual(['ball']);
        expect(runtime.getSimulation('ball')).not.toBe(cache);
        expect(runtime.syncDefinitions([])).toEqual(['ball']);
        expect(runtime.getSimulation('ball')).toBeNull();
    });

    test('starts at t0 and clamps the step rate', () => {
        const runtime = new SimulationRuntime({executor});
        runtime.registerSolver(createFakeSolver());
        runtime.syncDefinitions([{name: 'late', hash: 'h', start: 2, rate: 10}]);
        runtime.ensureAll(3);
        expect(runtime.sample('late', 'count', 1)).toBe(0);
        expect(runtime.sample('late', 'count', 2.55)).toBeCloseTo(5.5);
        expect(clampRate(0)).toBe(120);
        expect(clampRate(5000)).toBe(1000);
        expect(clampRate(0.5)).toBe(1);
    });

    test('reports an error from a step and keeps returning S0', () => {
        const runtime = new SimulationRuntime({
            executor: {
                initialize: (definition, state) => state.set('x', 1),
                step: () => {
                    throw new Error('step failed');
                }
            }
        });
        runtime.syncDefinitions([{name: 'broken', hash: 'h', start: 0, rate: 60}]);
        const result = runtime.ensureAll(1);
        expect(result.ready).toBe(false);
        expect(result.errors[0].error.message).toBe('step failed');
        expect(runtime.sample('broken', 'x', 1)).toBe(1);
    });

    test('reports computed ranges', () => {
        const changes = [];
        const runtime = makeRuntime({onChange: ranges => changes.push(ranges)});
        runtime.ensureAll(1.25);
        expect(runtime.getCachedRanges().ball).toEqual([{start: 0, end: 1.25}]);
        expect(changes.length).toBeGreaterThan(0);
    });

    test('disposes solver worlds it no longer needs', () => {
        const solver = createFakeSolver();
        const runtime = new SimulationRuntime({executor});
        runtime.registerSolver(solver);
        runtime.syncDefinitions([{name: 'ball', hash: 'h', start: 0, rate: 120}]);
        runtime.ensureAll(3);
        runtime.ensureTimes([{name: 'ball', time: 0.3}]);
        expect(solver.worlds).toBe(1);
        runtime.dispose();
        expect(solver.worlds).toBe(0);
    });

    test('a cache can be used without a runtime', () => {
        const cache = new SimulationCache({
            initialize: state => state.set('x', 0),
            step: state => state.set('x', state.get('x') + 2),
            rate: 4
        });
        expect(cache.ensureTime(1)).toBe(true);
        expect(cache.sample('x', 0.875)).toEqual({available: true, value: 7});
    });
});

describe('simulation definition hash', () => {
    const blocks = ids => ({
        [ids.hat]: {opcode: 'simulation_whenStepped', fields: {NAME: {value: 'ball'}}, inputs: {}, next: ids.change},
        [ids.change]: {
            opcode: 'simulation_changeState',
            fields: {KEY: {value: 'y'}},
            inputs: {VALUE: {block: ids.number, shadow: ids.number}},
            next: ids.call
        },
        [ids.number]: {opcode: 'math_number', fields: {NUM: {value: '5'}}, inputs: {}, next: null},
        [ids.call]: {
            opcode: 'procedures_call', fields: {}, inputs: {}, next: null,
            mutation: {proccode: 'helper %s', argumentnames: '["a"]', warp: 'true'}
        },
        [ids.definition]: {opcode: 'procedures_definition', fields: {}, inputs: {}, next: ids.helperBody},
        [ids.helperBody]: {opcode: 'data_setvariableto', fields: {VARIABLE: {value: 'v'}}, inputs: {}, next: null}
    });
    const definition = (ids, overrides = {}) => {
        const table = blocks(ids);
        return {
            getBlock: id => table[id],
            scriptIds: [ids.hat],
            getProcedureDefinition: proccode => (proccode === 'helper %s' ? ids.definition : null),
            inputs: {start: 0, rate: 120},
            assets: [],
            variables: {v: 1},
            ...overrides
        };
    };
    const first = {hat: 'a', change: 'b', number: 'c', call: 'd', definition: 'e', helperBody: 'f'};
    const second = {hat: 'z1', change: 'z2', number: 'z3', call: 'z4', definition: 'z5', helperBody: 'z6'};

    test('does not depend on block IDs', () => {
        expect(hashSimulationDefinition(definition(first))).toBe(hashSimulationDefinition(definition(second)));
        expect(canonicalScript(definition(first).getBlock, 'a')).toBe(canonicalScript(definition(second).getBlock, 'z1'));
    });

    test('changes with fields, called definitions, inputs, assets and variables', () => {
        const base = hashSimulationDefinition(definition(first));
        const changedField = definition(first);
        const getBlock = changedField.getBlock;
        changedField.getBlock = id => (id === 'c' ? {...getBlock(id), fields: {NUM: {value: '6'}}} : getBlock(id));
        expect(hashSimulationDefinition(changedField)).not.toBe(base);
        const changedHelper = definition(first);
        changedHelper.getBlock = id => (id === 'f' ? {...getBlock(id), fields: {VARIABLE: {value: 'w'}}} : getBlock(id));
        expect(hashSimulationDefinition(changedHelper)).not.toBe(base);
        expect(hashSimulationDefinition(definition(first, {inputs: {start: 0, rate: 60}}))).not.toBe(base);
        expect(hashSimulationDefinition(definition(first, {assets: ['x']}))).not.toBe(base);
        expect(hashSimulationDefinition(definition(first, {variables: {v: 2}}))).not.toBe(base);
        expect(hashSimulationDefinition(definition(first))).toBe(base);
    });
});
