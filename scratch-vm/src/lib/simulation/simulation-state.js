// The state of one simulation at one step. Values are numbers, strings, booleans or lists of those; keys keep their
// insertion order. Solver state (a physics world) lives beside the values: a live world while the state is being
// stepped, and bytes (solver.snapshot) in a snapshot.

const VALUE_TYPES = new Set(['number', 'string', 'boolean']);

const normalizeValue = value => {
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (VALUE_TYPES.has(typeof value)) return typeof value === 'number' && !Number.isFinite(value) ? 0 : value;
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
};

const copyValue = value => (Array.isArray(value) ? value.slice() : value);

const valueBytes = value => {
    if (Array.isArray(value)) return 16 + value.reduce((total, item) => total + valueBytes(item), 0);
    if (typeof value === 'string') return 16 + (value.length * 2);
    return 8;
};

class SimulationState {
    /**
     * @param {object} solver Solver (see simulation-runtime.js) or null.
     */
    constructor (solver = null) {
        this.values = new Map();
        // Interpolation type per key: 'angle' (degrees, shortest arc), 'quaternion' ([x, y, z, w]), 'pose'
        // ([x, y, z, qx, qy, qz, qw]). Other keys are interpolated linearly when they are numbers.
        this.types = new Map();
        // Solver body name -> handle. Restored with the snapshot so names keep pointing at the same bodies.
        this.handles = new Map();
        this.solver = solver;
        this.world = null;
    }

    has (key) {
        return this.values.has(String(key));
    }

    get (key) {
        return this.values.get(String(key));
    }

    set (key, value, type = null) {
        const name = String(key);
        this.values.set(name, normalizeValue(value));
        if (type) this.types.set(name, type);
    }

    delete (key) {
        this.values.delete(String(key));
        this.types.delete(String(key));
    }

    keys () {
        return Array.from(this.values.keys());
    }

    // Deep copy into an immutable snapshot; the world is serialized by the solver.
    snapshot () {
        const values = new Map();
        let bytes = 64;
        for (const [key, value] of this.values) {
            values.set(key, copyValue(value));
            bytes += (key.length * 2) + valueBytes(value);
        }
        const solverBytes = this.solver && this.world ? this.solver.snapshot(this.world) : null;
        if (solverBytes) bytes += solverBytes.byteLength;
        return Object.freeze({
            bytes,
            handles: new Map(this.handles),
            solverBytes: solverBytes ? new Uint8Array(solverBytes) : null,
            types: new Map(this.types),
            values
        });
    }

    // A state that continues from a snapshot. The snapshot itself is not changed.
    static fromSnapshot (snapshot, solver = null) {
        const state = new SimulationState(solver);
        for (const [key, value] of snapshot.values) state.values.set(key, copyValue(value));
        state.types = new Map(snapshot.types);
        state.handles = new Map(snapshot.handles);
        if (solver && snapshot.solverBytes) state.world = solver.restore(new Uint8Array(snapshot.solverBytes));
        return state;
    }

    dispose () {
        if (this.solver && this.world) this.solver.dispose(this.world);
        this.world = null;
    }
}

export {
    SimulationState,
    normalizeValue
};
