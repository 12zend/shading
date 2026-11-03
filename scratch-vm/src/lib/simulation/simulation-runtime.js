// One per VM. Keeps a SimulationCache per simulation definition and answers reads of S(t). The VM side (the
// executor) runs the initialize and step scripts; this module never touches the VM, so it can be tested alone.
//
// Solver interface (implemented by plugins, for example a physics engine):
//   {id, create(settings) -> world, beforeStep(world, ctx), step(world, dt), snapshot(world) -> Uint8Array,
//    restore(bytes) -> world, dispose(world), readPose(world, bodyName) -> {position: {x, y, z},
//    quaternion: {x, y, z, w}}}
// The simulation state keeps body name -> handle, and the pose of every named body after each step under
// `pose:<name>` (type 'pose'), so poses interpolate between steps like any other value.
import {DEFAULT_MEMORY_LIMIT, SimulationCache, defaultNow} from './simulation-cache';
import {createSeededRandom, hashParts} from './seeded-random';

const MIN_RATE = 1;
const MAX_RATE = 1000;
const DEFAULT_RATE = 120;

const clampRate = rate => {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_RATE;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, value));
};

const POSE_PREFIX = 'pose:';

const poseToArray = pose => {
    const position = (pose && pose.position) || {};
    const quaternion = (pose && pose.quaternion) || {};
    const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    return [
        number(position.x), number(position.y), number(position.z),
        number(quaternion.x), number(quaternion.y), number(quaternion.z),
        Number.isFinite(Number(quaternion.w)) ? Number(quaternion.w) : 1
    ];
};

const poseFromArray = value => (Array.isArray(value) && value.length === 7 ? {
    position: {x: value[0], y: value[1], z: value[2]},
    quaternion: {x: value[3], y: value[4], z: value[5], w: value[6]}
} : null);

class SimulationRuntime {
    /**
     * @param {object} options Runtime options.
     * @param {object} options.executor {initialize(definition, state, context), step(definition, state, context)}.
     * @param {Function} options.now Clock for work budgets in milliseconds.
     * @param {number} options.memoryLimit Bytes of cached steps, shared by all simulations.
     * @param {Function} options.onChange Called when computed ranges change.
     */
    constructor ({executor, now = defaultNow, memoryLimit = DEFAULT_MEMORY_LIMIT, onChange = null} = {}) {
        this.executor = executor;
        this.now = now;
        this.memoryLimit = memoryLimit;
        this.onChange = onChange;
        this.solvers = new Map();
        this.simulations = new Map();
        this.requestedTimes = [];
    }

    registerSolver (solver) {
        if (!solver || typeof solver.id !== 'string' || !solver.id) throw new TypeError('A solver needs an id.');
        for (const method of ['create', 'beforeStep', 'step', 'snapshot', 'restore', 'dispose', 'readPose']) {
            if (typeof solver[method] !== 'function') throw new TypeError(`Solver ${solver.id} needs ${method}().`);
        }
        this.solvers.set(solver.id, solver);
        return () => {
            if (this.solvers.get(solver.id) !== solver) return;
            this.solvers.delete(solver.id);
            // Simulations that used the solver cannot continue: recompute them when it comes back.
            for (const [name, simulation] of this.simulations) {
                if (simulation.definition.solver === solver.id) this.invalidate(name);
            }
        };
    }

    getSolver (id) {
        return this.solvers.get(id) || null;
    }

    /**
     * Replace the set of simulation definitions. A definition is {name, hash, start, rate, ...executor data}.
     * Simulations whose hash did not change keep their computed steps.
     * @returns {string[]} Names of the simulations that were (re)created or removed.
     */
    syncDefinitions (definitions) {
        const changed = [];
        const next = new Map();
        for (const definition of definitions || []) {
            if (!definition || !definition.name || next.has(definition.name)) continue;
            next.set(definition.name, {...definition, rate: clampRate(definition.rate)});
        }
        for (const [name, simulation] of this.simulations) {
            const definition = next.get(name);
            if (definition && definition.hash === simulation.definition.hash) {
                simulation.definition = definition;
                continue;
            }
            simulation.cache.dispose();
            this.simulations.delete(name);
            changed.push(name);
        }
        for (const [name, definition] of next) {
            if (this.simulations.has(name)) continue;
            this.simulations.set(name, {definition, cache: this.createCache(definition)});
            if (!changed.includes(name)) changed.push(name);
        }
        this.rebalanceMemory();
        if (changed.length) this.emitChange();
        return changed;
    }

    invalidate (name) {
        const simulation = this.simulations.get(name);
        if (!simulation) return;
        simulation.cache.dispose();
        simulation.cache = this.createCache(simulation.definition);
        this.emitChange();
    }

    rebalanceMemory () {
        const count = Math.max(1, this.simulations.size);
        for (const simulation of this.simulations.values()) {
            simulation.cache.memoryLimit = this.memoryLimit / count;
            simulation.cache.enforceMemory();
        }
    }

    createCache (definition) {
        const solverOf = state => (state.solverId ? this.getSolver(state.solverId) : null);
        const makeContext = (state, context, phase) => {
            let calls = 0;
            const random = seed => createSeededRandom(hashParts(definition.name, seed, context.stepIndex, calls++))();
            return {
                ...context,
                name: definition.name,
                phase,
                state,
                random,
                createWorld: (solverId, settings) => {
                    const solver = this.getSolver(solverId);
                    if (!solver) throw new Error(`The solver ${solverId} is not available.`);
                    if (state.world && state.solver) state.solver.dispose(state.world);
                    state.solver = solver;
                    state.solverId = solverId;
                    state.world = solver.create(settings || {});
                    return state.world;
                },
                getWorld: () => state.world
            };
        };
        const recordPoses = state => {
            const solver = solverOf(state);
            if (!solver || !state.world) return;
            for (const bodyName of state.handles.keys()) {
                state.set(`${POSE_PREFIX}${bodyName}`, poseToArray(solver.readPose(state.world, bodyName)), 'pose');
            }
        };
        return new SimulationCache({
            start: definition.start,
            rate: definition.rate,
            memoryLimit: this.memoryLimit / Math.max(1, this.simulations.size + 1),
            now: this.now,
            getSolver: id => this.getSolver(id),
            initialize: (state, context) => {
                this.executor.initialize(definition, state, makeContext(state, context, 'initialize'));
                recordPoses(state);
            },
            step: (state, context) => {
                const stepContext = makeContext(state, context, 'step');
                const solver = solverOf(state);
                if (solver && state.world) solver.beforeStep(state.world, stepContext);
                this.executor.step(definition, state, stepContext);
                if (solver && state.world) solver.step(state.world, context.dt);
                recordPoses(state);
            }
        });
    }

    names () {
        return Array.from(this.simulations.keys());
    }

    getSimulation (name) {
        const simulation = this.simulations.get(String(name));
        return simulation ? simulation.cache : null;
    }

    /**
     * Compute every simulation up to `time` (and any times requested by reads), within `budgetMs`.
     * @returns {{ready: boolean, progress: number, errors: Array}} ready when everything needed is available.
     */
    ensureAll (time, budgetMs = Infinity) {
        const requests = this.names().map(name => ({name, time}));
        return this.ensureTimes(requests, budgetMs);
    }

    ensureTimes (requests, budgetMs = Infinity) {
        const deadline = budgetMs === Infinity ? Infinity : this.now() + budgetMs;
        let ready = true;
        let done = 0;
        const errors = [];
        const before = this.rangesKey();
        for (const simulation of this.simulations.values()) simulation.cache.beginBatch();
        for (const {name, time} of requests) {
            const cache = this.getSimulation(name);
            if (!cache) {
                done++;
                continue;
            }
            if (cache.ensureTime(time, deadline, {batch: true})) {
                done++;
            } else {
                ready = false;
                if (cache.error) errors.push({name, error: cache.error});
            }
        }
        if (this.rangesKey() !== before) this.emitChange();
        return {ready, progress: requests.length ? done / requests.length : 1, errors};
    }

    isAvailable (name, time) {
        const cache = this.getSimulation(name);
        return Boolean(cache && cache.isAvailable(time));
    }

    requestTime (name, time) {
        if (!this.requestedTimes.some(request => request.name === name && request.time === time)) {
            this.requestedTimes.push({name: String(name), time: Number(time)});
        }
    }

    // Times that reads asked for but were not computed, since the last call.
    takeRequestedTimes () {
        const requests = this.requestedTimes;
        this.requestedTimes = [];
        return requests;
    }

    hasRequestedTimes () {
        return this.requestedTimes.length > 0;
    }

    /**
     * S(t) of `key`. Unavailable reads are recorded with requestTime and return the nearest computed value.
     * @returns {*} The value, or undefined when the simulation or key does not exist.
     */
    sample (name, key, time) {
        const cache = this.getSimulation(name);
        if (!cache) return;
        if (cache.error) return cache.sample(key, cache.start).value;
        const result = cache.sample(key, time);
        if (!result.available) this.requestTime(name, time);
        return result.value;
    }

    // Interpolated pose of a solver body: {position, quaternion}, or null.
    readPose (name, bodyName, time) {
        return poseFromArray(this.sample(name, `${POSE_PREFIX}${bodyName}`, time));
    }

    getCachedRanges () {
        const ranges = {};
        for (const [name, simulation] of this.simulations) ranges[name] = simulation.cache.getRanges();
        return ranges;
    }

    getErrors () {
        const errors = [];
        for (const [name, simulation] of this.simulations) {
            if (simulation.cache.error) errors.push({name, error: simulation.cache.error});
        }
        return errors;
    }

    rangesKey () {
        return JSON.stringify(this.getCachedRanges());
    }

    // Stop work in progress (a step computation away from the live state). Computed steps stay cached.
    cancel () {
        for (const simulation of this.simulations.values()) simulation.cache.cancelTemporary();
        this.requestedTimes = [];
    }

    emitChange () {
        if (typeof this.onChange === 'function') this.onChange(this.getCachedRanges());
    }

    dispose () {
        for (const simulation of this.simulations.values()) simulation.cache.dispose();
        this.simulations.clear();
        this.requestedTimes = [];
    }
}

export {
    DEFAULT_RATE,
    MAX_RATE,
    MIN_RATE,
    POSE_PREFIX,
    SimulationRuntime,
    clampRate,
    poseFromArray,
    poseToArray
};
