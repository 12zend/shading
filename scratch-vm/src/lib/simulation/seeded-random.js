// Deterministic pseudo-random numbers for simulations. Simulations never use Math.random: a value depends only on
// its seed, so recomputing a step (after a seek, on another machine or at another frame rate) gives the same value.

// 32-bit string/number hash (FNV-1a over the UTF-16 code units, then an avalanche finalizer).
const hashParts = (...parts) => {
    let hash = 0x811c9dc5;
    for (const part of parts) {
        const text = `${typeof part}:${String(part)}\u0000`;
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
};

// mulberry32: a small, fast generator with a 32-bit state. Returns numbers in [0, 1).
const createSeededRandom = seed => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * One random number from the simulation's seed parts: hash(simulation name, user seed, step index, call index).
 * @param {string} name Simulation name.
 * @param {*} userSeed Seed given by the block.
 * @param {number} stepIndex Step being computed (or a frame-derived index outside simulations).
 * @param {number} callIndex How many random numbers this step drew before.
 * @returns {number} A number in [0, 1).
 */
const seededRandomValue = (name, userSeed, stepIndex, callIndex) => (
    createSeededRandom(hashParts(name, userSeed, stepIndex, callIndex))()
);

// Map a [0, 1) sample to the range like Scratch's `pick random`: whole numbers when both ends are whole numbers.
const randomInRange = (sample, from, to) => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (Number.isInteger(low) && Number.isInteger(high)) return low + Math.floor(sample * ((high - low) + 1));
    return low + (sample * (high - low));
};

export {
    createSeededRandom,
    hashParts,
    randomInRange,
    seededRandomValue
};
