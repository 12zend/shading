// Computed steps of one simulation. S0 = initialize(), S(k + 1) = step(S(k)). The cache keeps:
// - the live state: the furthest step computed, stepped forward in place;
// - a checkpoint every `checkpointSeconds` of simulation time (S0 is always kept);
// - a ring buffer of every step in the last `ringSeconds` behind the live state (echo and small backward seeks);
// - single steps computed away from the live state (a time read inside reverse or posterize, for example).
// Everything is bounded by `memoryLimit` bytes: the least recently used extra steps, then checkpoints (never S0),
// then the oldest ring entries are dropped first. A dropped step is recomputed from the nearest earlier snapshot.
import {SimulationState} from './simulation-state';
import {interpolateSnapshots} from './simulation-interp';

const DEFAULT_MEMORY_LIMIT = 256 * 1024 * 1024;
const STEP_EPSILON = 1e-9;

const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

class SimulationCache {
    /**
     * @param {object} options Cache options.
     * @param {Function} options.initialize (state, context) => void: fills S0.
     * @param {Function} options.step (state, context) => void: advances the state by one step, in place.
     * @param {Function} options.getSolver solver ID -> solver, to restore snapshots with solver state.
     * @param {number} options.start Simulation start time t0 in seconds.
     * @param {number} options.rate Steps per second.
     * @param {number} options.memoryLimit Bytes of snapshots to keep.
     * @param {number} options.checkpointSeconds Simulation time between checkpoints.
     * @param {number} options.ringSeconds Simulation time kept step by step behind the live state.
     * @param {Function} options.now Clock for work budgets (never used for simulation results).
     */
    constructor ({
        initialize,
        step,
        getSolver = () => null,
        start = 0,
        rate = 120,
        memoryLimit = DEFAULT_MEMORY_LIMIT,
        checkpointSeconds = 0.5,
        ringSeconds = 2,
        now = defaultNow
    }) {
        this.initializeState = initialize;
        this.stepState = step;
        this.getSolver = getSolver;
        this.start = Number(start) || 0;
        this.rate = rate;
        this.dt = 1 / rate;
        this.memoryLimit = memoryLimit;
        this.checkpointSteps = Math.max(1, Math.round(checkpointSeconds * rate));
        this.ringSteps = Math.max(1, Math.round(ringSeconds * rate));
        this.now = now;
        this.live = null;
        this.checkpoints = new Map();
        this.ring = new Map();
        this.extra = new Map();
        this.temp = null;
        this.maxComputed = -1;
        this.error = null;
        this.memoryBytes = 0;
        this.stepsComputed = 0;
        // Steps of the latest request: never dropped for memory, so a read right after ensuring them succeeds.
        this.protectedSteps = new Set();
    }

    // Step k and how far t is towards step k + 1. Before t0 the simulation is S0.
    locate (time) {
        const position = (Number(time) - this.start) / this.dt;
        if (!(position > 0)) return {index: 0, alpha: 0};
        const index = Math.floor(position + STEP_EPSILON);
        const alpha = position - index;
        return {index, alpha: alpha > STEP_EPSILON ? alpha : 0};
    }

    stepTime (index) {
        return this.start + (index * this.dt);
    }

    getSnapshot (index) {
        const snapshot = this.ring.get(index) || this.checkpoints.get(index) || this.extra.get(index) || null;
        if (snapshot) this.touch(index);
        return snapshot;
    }

    hasStep (index) {
        return this.ring.has(index) || this.checkpoints.has(index) || this.extra.has(index);
    }

    isAvailable (time) {
        const {index, alpha} = this.locate(time);
        return this.hasStep(index) && (!alpha || this.hasStep(index + 1));
    }

    // Mark a step as recently used (Map order is the LRU order).
    touch (index) {
        for (const map of [this.extra, this.checkpoints]) {
            if (!map.has(index) || index === 0) continue;
            const snapshot = map.get(index);
            map.delete(index);
            map.set(index, snapshot);
        }
    }

    context (index) {
        return {stepIndex: index, time: this.stepTime(index), dt: this.dt};
    }

    restore (snapshot) {
        const solver = snapshot.solverId ? this.getSolver(snapshot.solverId) : null;
        const state = SimulationState.fromSnapshot(snapshot, solver);
        state.solverId = snapshot.solverId || null;
        return state;
    }

    snapshotOf (state) {
        const snapshot = state.snapshot();
        return Object.freeze({...snapshot, solverId: state.solverId || null});
    }

    store (map, index, snapshot) {
        if (map.has(index)) this.memoryBytes -= map.get(index).bytes;
        map.set(index, snapshot);
        this.memoryBytes += snapshot.bytes;
    }

    drop (map, index) {
        if (!map.has(index)) return;
        this.memoryBytes -= map.get(index).bytes;
        map.delete(index);
    }

    ensureInitialized () {
        if (this.live) return;
        const state = new SimulationState();
        this.initializeState(state, this.context(0));
        this.live = {state, index: 0};
        const snapshot = this.snapshotOf(state);
        this.store(this.ring, 0, snapshot);
        this.store(this.checkpoints, 0, snapshot);
        this.maxComputed = 0;
    }

    // Advance a cursor ({state, index}) by one step and return the snapshot of the new step.
    advance (cursor) {
        this.stepState(cursor.state, this.context(cursor.index));
        cursor.index++;
        this.stepsComputed++;
        return this.snapshotOf(cursor.state);
    }

    advanceLive () {
        const snapshot = this.advance(this.live);
        const index = this.live.index;
        this.store(this.ring, index, snapshot);
        for (const old of Array.from(this.ring.keys())) {
            if (old < index - this.ringSteps) this.drop(this.ring, old);
        }
        if (index % this.checkpointSteps === 0) this.store(this.checkpoints, index, snapshot);
        // Steps computed elsewhere that the live state now covers are no longer extra.
        this.drop(this.extra, index);
        this.maxComputed = Math.max(this.maxComputed, index);
        this.enforceMemory();
    }

    // The nearest stored step at or before `index`.
    nearestSnapshotIndex (index) {
        let best = -1;
        for (const map of [this.ring, this.checkpoints, this.extra]) {
            for (const candidate of map.keys()) {
                if (candidate <= index && candidate > best) best = candidate;
            }
        }
        return best;
    }

    /**
     * Make step `index` available, computing for at most until `deadline` (this.now() units).
     * Steps from `keepFrom` on are kept when they are computed away from the live state.
     * @returns {boolean} Whether the step is available.
     */
    ensureStep (index, deadline = Infinity, keepFrom = index) {
        if (this.error) return false;
        try {
            this.ensureInitialized();
            if (this.hasStep(index)) return true;
            if (index > this.live.index) {
                while (this.live.index < index) {
                    if (this.now() > deadline) return false;
                    this.advanceLive();
                }
                return true;
            }
            // Behind the live state and no longer stored: recompute from the nearest earlier snapshot without
            // moving the live state, and keep the requested steps.
            if (!this.temp || this.temp.target !== index || this.temp.keepFrom !== keepFrom) {
                this.cancelTemporary();
                const base = this.nearestSnapshotIndex(index);
                this.temp = {state: this.restore(this.getSnapshot(base)), index: base, target: index, keepFrom};
            }
            const cursor = this.temp;
            while (cursor.index < index) {
                if (this.now() > deadline) return false;
                const snapshot = this.advance(cursor);
                if (cursor.index % this.checkpointSteps === 0 && !this.checkpoints.has(cursor.index)) {
                    this.store(this.checkpoints, cursor.index, snapshot);
                }
                if (cursor.index >= keepFrom) this.store(this.extra, cursor.index, snapshot);
            }
            this.cancelTemporary();
            this.enforceMemory();
            return true;
        } catch (error) {
            this.error = error;
            this.cancelTemporary();
            return false;
        }
    }

    // Make S(t) available: steps k and (when t is between steps) k + 1. With `batch`, the steps of earlier calls in
    // the batch (see beginBatch) stay protected too, so every time of one frame is readable together.
    ensureTime (time, deadline = Infinity, {batch = false} = {}) {
        const {index, alpha} = this.locate(time);
        if (!batch) this.protectedSteps = new Set();
        this.protectedSteps.add(index);
        if (alpha) this.protectedSteps.add(index + 1);
        if (!this.ensureStep(index, deadline)) return false;
        return !alpha || this.ensureStep(index + 1, deadline, index);
    }

    beginBatch () {
        this.protectedSteps = new Set();
    }

    cancelTemporary () {
        if (this.temp) this.temp.state.dispose();
        this.temp = null;
    }

    /**
     * S(t) for `key`. When S(t) is not computed yet, `available` is false and the value comes from the nearest
     * computed step before t (S0 when nothing else is), so the caller can draw something and ask for t.
     * @returns {{available: boolean, value: *}} Result.
     */
    sample (key, time) {
        const {index, alpha} = this.locate(time);
        const from = this.getSnapshot(index);
        const to = alpha ? this.getSnapshot(index + 1) : null;
        if (from && (!alpha || to)) return {available: true, value: interpolateSnapshots(from, to, alpha, key)};
        const nearest = this.nearestSnapshotIndex(index);
        const fallback = nearest >= 0 ? this.getSnapshot(nearest) : null;
        const result = {available: false};
        if (fallback) result.value = fallback.values.get(String(key));
        return result;
    }

    enforceMemory () {
        const evict = (map, keep) => {
            for (const index of Array.from(map.keys())) {
                if (this.memoryBytes <= this.memoryLimit) return;
                if (!keep(index)) this.drop(map, index);
            }
        };
        if (this.memoryBytes <= this.memoryLimit) return;
        const kept = index => this.protectedSteps.has(index);
        evict(this.extra, kept);
        evict(this.checkpoints, index => index === 0 || kept(index));
        const live = this.live ? this.live.index : -1;
        evict(this.ring, index => index === live || index === 0 || kept(index));
    }

    // Time ranges (seconds) that can be read without recomputing more than a checkpoint interval.
    getRanges () {
        if (!this.live) return [];
        const covered = [];
        const checkpoints = Array.from(this.checkpoints.keys()).sort((a, b) => a - b);
        checkpoints.forEach((index, position) => {
            const next = position + 1 < checkpoints.length ? checkpoints[position + 1] : null;
            const end = next !== null && next - index <= this.checkpointSteps ? next :
                Math.min(index + this.checkpointSteps, this.maxComputed);
            if (end >= index) covered.push([index, end]);
        });
        const ringSteps = Array.from(this.ring.keys());
        if (ringSteps.length) covered.push([Math.min(...ringSteps), Math.max(...ringSteps)]);
        for (const index of this.extra.keys()) covered.push([index, index]);
        covered.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [start, end] of covered) {
            const last = merged[merged.length - 1];
            if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
            else merged.push([start, end]);
        }
        return merged.map(([start, end]) => ({start: this.stepTime(start), end: this.stepTime(end)}));
    }

    dispose () {
        this.cancelTemporary();
        if (this.live) this.live.state.dispose();
        this.live = null;
        this.checkpoints.clear();
        this.ring.clear();
        this.extra.clear();
        this.memoryBytes = 0;
    }
}

export {
    DEFAULT_MEMORY_LIMIT,
    SimulationCache,
    defaultNow
};
