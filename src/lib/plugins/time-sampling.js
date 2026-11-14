import {MAX_TIME_SAMPLES} from '../../../scratch-vm/src/lib/object-blocks';

const TIME_SAMPLE_OPERATIONS = ['add', 'over', 'under', 'max'];
const TIME_COMPOSER_NAME = /^[a-z][a-z0-9-]{0,47}$/;
const TIME_COMPOSER_HOOKS = ['begin', 'layer', 'end'];

const toFinite = (value, fallback) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string' && value.trim() !== '') {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }
    return fallback;
};

/**
 * Normalize a plugin's time samples for ObjectBlocks.runTimeSampling.
 * @param {object[]} samples [{delta = 0, weight = 1, operation = 'add', order = index, reference}].
 * @returns {object[]} At most MAX_TIME_SAMPLES samples {delta, weight, operation, order, reference} in evaluation
 *     order (the array order) with exactly one reference sample, last. Empty when no samples were given.
 */
const normalizeTimeSamples = samples => {
    const list = Array.isArray(samples) ? samples : [];
    const normalized = list.map((sample, index) => {
        const source = sample && typeof sample === 'object' ? sample : {};
        const operation = String(source.operation || '').toLowerCase();
        return {
            delta: toFinite(source.delta, 0),
            weight: Math.max(0, toFinite(source.weight, 1)),
            operation: TIME_SAMPLE_OPERATIONS.includes(operation) ? operation : 'add',
            order: toFinite(source.order, index),
            requested: source.reference === true,
            index
        };
    });
    if (!normalized.length) return [];
    // The first sample marked as the reference, or the last sample.
    const reference = normalized.find(sample => sample.requested) || normalized[normalized.length - 1];
    let others = normalized.filter(sample => sample !== reference);
    if (others.length > MAX_TIME_SAMPLES - 1) {
        // Keep the samples composited first; the reference sample always stays.
        const kept = new Set(others.slice().sort((a, b) => (a.order - b.order) || (a.index - b.index))
            .slice(0, MAX_TIME_SAMPLES - 1));
        others = others.filter(sample => kept.has(sample));
    }
    return others.concat([reference]).map(sample => ({
        delta: sample.delta,
        weight: sample.weight,
        operation: sample.operation,
        order: sample.order,
        reference: sample === reference
    }));
};

// Composer params travel in the frame graph, so they are plain JSON data.
const toPlainParams = params => {
    if (typeof params === 'undefined') return {};
    const plain = JSON.parse(JSON.stringify(params));
    return plain && typeof plain === 'object' ? plain : {};
};

const validateTimeComposer = (name, composer) => {
    if (!TIME_COMPOSER_NAME.test(String(name))) {
        throw new TypeError(`Invalid time composer name "${name}": use lowercase letters, digits and "-".`);
    }
    if (!composer || typeof composer !== 'object' || typeof composer.layer !== 'function') {
        throw new TypeError('A time composer needs a layer(ctx) function.');
    }
    for (const hook of TIME_COMPOSER_HOOKS) {
        if (typeof composer[hook] !== 'undefined' && typeof composer[hook] !== 'function') {
            throw new TypeError(`The time composer's ${hook} must be a function.`);
        }
    }
};

export {
    MAX_TIME_SAMPLES,
    TIME_SAMPLE_OPERATIONS,
    normalizeTimeSamples,
    toPlainParams,
    validateTimeComposer
};
