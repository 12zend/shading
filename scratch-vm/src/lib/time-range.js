/**
 * @fileoverview
 * Shared helpers for Movie "time" arguments.
 *
 * A single time argument is stored as a plain number string (for example "1.5").
 * A time range argument merges the old T1/T2 inputs into one TIME_RANGE input
 * whose value is "start~end" (for example "0~Infinity").
 */

const TIME_SHADOW_OPCODE = 'math_time';
const TIME_FIELD = 'TIME';
const TIME_RANGE_SHADOW_OPCODE = 'math_time_range';
const TIME_RANGE_FIELD = 'RANGE';
const TIME_RANGE_INPUT = 'TIME_RANGE';
const TIME_RANGE_REPORTER_OPCODE = 'objects_timeRangeValue';
const TIME_RANGE_SEPARATOR = '~';

/**
 * Opcodes that used to take a pair of T1/T2 number inputs and now take one TIME_RANGE input.
 * Values are the default range used when an old block is missing one of the inputs.
 */
const TIME_RANGE_OPCODES = {
    objects_draw: [0, Infinity],
    objects_shape: [0, Infinity],
    objects_arc: [0, Infinity],
    objects_circularSegment: [0, Infinity],
    objects_line: [0, Infinity],
    objects_animate: [1, 2],
    objects_timeWithin: [0, 1],
    objects_interpolateColor: [0, 1],
    objects_interpolateAngle: [0, 1],
    objects_interpolateVector: [0, 1],
    sound_playattime: [0, Infinity]
};

/** Opcodes whose TIME input holds a single time in seconds. */
const TIME_OPCODES = {
    objects_timeFreeze: 'TIME',
    objects_timeOffset: 'TIME',
    objects_repeat: 'TIME'
};

const parseTimeBoundary = (value, fallback) => {
    if (typeof value === 'number') return Number.isNaN(value) ? fallback : value;
    const text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
    if (text === '') return fallback;
    if (/^\+?(∞|inf|infinity)$/i.test(text)) return Infinity;
    if (/^-(∞|inf|infinity)$/i.test(text)) return -Infinity;
    const number = Number(text);
    return Number.isNaN(number) ? fallback : number;
};

/**
 * Parse a time range value.
 * "a~b" gives {start: a, end: b}. A single value gives {start: value, end: Infinity},
 * so a plain number reporter dropped into a range input means "from this time onwards".
 * @param {*} value Range value from a TIME_RANGE input.
 * @param {Array.<number>} [defaults] Fallback [start, end].
 * @returns {{start: number, end: number}} Parsed range.
 */
const parseTimeRange = (value, defaults = [0, Infinity]) => {
    const text = String(value === null || typeof value === 'undefined' ? '' : value);
    const separator = text.indexOf(TIME_RANGE_SEPARATOR);
    if (separator < 0) {
        return {
            start: parseTimeBoundary(text, defaults[0]),
            end: Infinity
        };
    }
    return {
        start: parseTimeBoundary(text.slice(0, separator), defaults[0]),
        end: parseTimeBoundary(text.slice(separator + 1), defaults[1])
    };
};

const formatTimeBoundary = value => {
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    const text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
    return text === '' ? '0' : text;
};

/**
 * @param {*} start Range start.
 * @param {*} end Range end.
 * @returns {string} Serialized "start~end" range.
 */
const formatTimeRange = (start, end) => `${formatTimeBoundary(start)}${TIME_RANGE_SEPARATOR}${formatTimeBoundary(end)}`;

/**
 * Give block implementations that were written for T1/T2 the values from a merged TIME_RANGE argument.
 * Arguments without TIME_RANGE (direct calls, old tests) are returned unchanged.
 * @param {object} args Block arguments.
 * @param {Array.<number>} [defaults] Fallback [start, end].
 * @returns {object} Arguments with T1 and T2.
 */
const withTimeRangeArgs = (args, defaults) => {
    if (!args || !Object.prototype.hasOwnProperty.call(args, TIME_RANGE_INPUT)) return args;
    const range = parseTimeRange(args[TIME_RANGE_INPUT], defaults);
    return Object.assign({}, args, {T1: range.start, T2: range.end});
};

const NUMBER_SHADOW_OPCODES = [
    'math_number',
    'math_positive_number',
    'math_whole_number',
    'math_integer',
    'math_angle',
    'text',
    TIME_SHADOW_OPCODE
];

const getLiteralValue = (blocks, blockId) => {
    const block = blockId && blocks[blockId];
    if (!block || !NUMBER_SHADOW_OPCODES.includes(block.opcode)) return null;
    const fieldNames = Object.keys(block.fields || {});
    if (fieldNames.length !== 1) return null;
    const value = block.fields[fieldNames[0]].value;
    return value === null || typeof value === 'undefined' ? null : value;
};

const deleteBlockTree = (blocks, blockId) => {
    const block = blockId && blocks[blockId];
    if (!block) return;
    for (const inputName of Object.keys(block.inputs || {})) {
        const input = block.inputs[inputName];
        deleteBlockTree(blocks, input.block);
        if (input.shadow && input.shadow !== input.block) deleteBlockTree(blocks, input.shadow);
    }
    delete blocks[blockId];
};

const createShadow = (blocks, parentId, opcode, fieldName, value, makeId) => {
    const id = makeId();
    blocks[id] = {
        id,
        opcode,
        next: null,
        parent: parentId,
        inputs: {},
        fields: {[fieldName]: {name: fieldName, value: String(value)}},
        shadow: true,
        topLevel: false
    };
    return id;
};

/** Turn a number shadow into a single-time shadow in place. */
const convertShadowToTime = (blocks, shadowId) => {
    const shadow = shadowId && blocks[shadowId];
    if (!shadow || shadow.opcode === TIME_SHADOW_OPCODE) return;
    const value = getLiteralValue(blocks, shadowId);
    if (value === null) return;
    shadow.opcode = TIME_SHADOW_OPCODE;
    shadow.fields = {[TIME_FIELD]: {name: TIME_FIELD, value: String(value)}};
};

const convertInputToTime = (blocks, input) => {
    if (!input) return;
    convertShadowToTime(blocks, input.shadow);
};

/**
 * Upgrade blocks saved before the time argument types existed. Mutates the
 * deserialized sb3 block map in place:
 * - T1/T2 pairs become one TIME_RANGE input with a "start~end" time-range shadow.
 *   If a reporter was plugged into T1 or T2, it is kept inside a
 *   "[T1] ~ [T2]" range reporter so the project behaves exactly as before.
 * - Single TIME number shadows become time shadows (the value is unchanged).
 * @param {object} blocks Deserialized block map (id => block).
 * @param {function(): string} makeId Creates a new unique block id.
 * @returns {boolean} true if anything changed.
 */
const migrateTimeInputs = (blocks, makeId) => {
    let changed = false;
    for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        if (!block || typeof block !== 'object' || !block.inputs) continue;

        const singleInput = Object.prototype.hasOwnProperty.call(TIME_OPCODES, block.opcode) &&
            block.inputs[TIME_OPCODES[block.opcode]];
        if (singleInput) {
            const shadow = blocks[singleInput.shadow];
            if (shadow && shadow.opcode !== TIME_SHADOW_OPCODE) {
                convertInputToTime(blocks, singleInput);
                changed = true;
            }
            continue;
        }

        if (!Object.prototype.hasOwnProperty.call(TIME_RANGE_OPCODES, block.opcode)) continue;
        if (block.inputs[TIME_RANGE_INPUT]) continue;
        const t1 = block.inputs.T1;
        const t2 = block.inputs.T2;
        // sound_playattime also has an older TIME-only form; that one is not a range.
        if (!t1 && !t2) continue;

        const defaults = TIME_RANGE_OPCODES[block.opcode];
        const shadowValue = (input, fallback) => {
            const value = input ? getLiteralValue(blocks, input.shadow) : null;
            return value === null ? fallback : value;
        };
        const isPlainShadow = input => !input || !input.block || input.block === input.shadow;
        const rangeValue = formatTimeRange(shadowValue(t1, defaults[0]), shadowValue(t2, defaults[1]));

        const rangeShadowId = createShadow(
            blocks, blockId, TIME_RANGE_SHADOW_OPCODE, TIME_RANGE_FIELD, rangeValue, makeId
        );
        let rangeBlockId = rangeShadowId;

        if (isPlainShadow(t1) && isPlainShadow(t2)) {
            if (t1) deleteBlockTree(blocks, t1.shadow);
            if (t2) deleteBlockTree(blocks, t2.shadow);
        } else {
            // Keep reporters working by moving both old inputs into a range reporter.
            rangeBlockId = makeId();
            const reporterInputs = {};
            const moveInput = (name, input, fallback) => {
                if (input) {
                    if (input.block && blocks[input.block]) blocks[input.block].parent = rangeBlockId;
                    if (input.shadow && blocks[input.shadow]) blocks[input.shadow].parent = rangeBlockId;
                    convertInputToTime(blocks, input);
                    reporterInputs[name] = {name, block: input.block, shadow: input.shadow};
                } else {
                    const id = createShadow(blocks, rangeBlockId, TIME_SHADOW_OPCODE, TIME_FIELD, fallback, makeId);
                    reporterInputs[name] = {name, block: id, shadow: id};
                }
            };
            moveInput('T1', t1, formatTimeBoundary(defaults[0]));
            moveInput('T2', t2, formatTimeBoundary(defaults[1]));
            blocks[rangeBlockId] = {
                id: rangeBlockId,
                opcode: TIME_RANGE_REPORTER_OPCODE,
                next: null,
                parent: blockId,
                inputs: reporterInputs,
                fields: {},
                shadow: false,
                topLevel: false
            };
        }

        delete block.inputs.T1;
        delete block.inputs.T2;
        block.inputs[TIME_RANGE_INPUT] = {
            name: TIME_RANGE_INPUT,
            block: rangeBlockId,
            shadow: rangeShadowId
        };
        changed = true;
    }
    return changed;
};

module.exports = {
    TIME_FIELD,
    TIME_OPCODES,
    TIME_RANGE_FIELD,
    TIME_RANGE_INPUT,
    TIME_RANGE_OPCODES,
    TIME_RANGE_REPORTER_OPCODE,
    TIME_RANGE_SEPARATOR,
    TIME_RANGE_SHADOW_OPCODE,
    TIME_SHADOW_OPCODE,
    formatTimeRange,
    migrateTimeInputs,
    parseTimeRange,
    withTimeRangeArgs
};
