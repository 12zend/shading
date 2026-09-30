/**
 * Restore ordinary number inputs in projects saved with the retired Movie time fields.
 * This runs only while importing blocks; execution and the editor use the original inputs.
 */

const RANGE_INPUTS = {
    objects_draw: ['T1', 'T2', 0, Infinity],
    objects_shape: ['T1', 'T2', 0, Infinity],
    objects_arc: ['T1', 'T2', 0, Infinity],
    objects_circularSegment: ['T1', 'T2', 0, Infinity],
    objects_line: ['T1', 'T2', 0, Infinity],
    objects_animate: ['T1', 'T2', 1, 2],
    objects_timeWithin: ['T1', 'T2', 0, 1],
    objects_interpolateColor: ['T1', 'T2', 0, 1],
    objects_interpolateAngle: ['T1', 'T2', 0, 1],
    objects_interpolateVector: ['T1', 'T2', 0, 1],
    sound_playattime: ['T1', 'T2', 0, Infinity],
    operator_easing: ['T0', 'T1', 0, 1]
};

const parseBoundary = (value, fallback) => {
    const text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
    if (!text) return fallback;
    if (/^\+?(∞|inf|infinity)$/i.test(text)) return Infinity;
    if (/^-(∞|inf|infinity)$/i.test(text)) return -Infinity;
    const number = Number(text);
    return Number.isNaN(number) ? fallback : number;
};

const parseRange = (value, start, end) => {
    const text = String(value === null || typeof value === 'undefined' ? '' : value);
    const separator = text.indexOf('~');
    return separator < 0 ? [parseBoundary(text, start), Infinity] : [
        parseBoundary(text.slice(0, separator), start),
        parseBoundary(text.slice(separator + 1), end)
    ];
};

/**
 * Convert a deserialized SB3 block map in place. Paired reporters are unwrapped
 * so calculations, their obscured number shadows, and their IDs survive.
 * @param {object} blocks Block ID to deserialized block.
 * @param {function(): string} makeId Generate an unused block ID.
 * @returns {boolean} Whether any blocks changed.
 */
const restoreNumberTimeInputs = (blocks, makeId) => {
    let changed = false;
    const createBlock = (parent, opcode, shadow) => {
        let id;
        do {
            id = makeId();
        } while (Object.prototype.hasOwnProperty.call(blocks, id));
        blocks[id] = {
            id,
            opcode,
            next: null,
            parent,
            inputs: {},
            fields: {},
            shadow,
            topLevel: false
        };
        return blocks[id];
    };
    const numberInput = (parent, name, value) => {
        const block = createBlock(parent, 'math_number', true);
        block.fields = {NUM: {name: 'NUM', value: String(value)}};
        return {name, block: block.id, shadow: block.id};
    };
    const moveInput = (parent, name, input, fallback) => {
        if (!input) return numberInput(parent, name, fallback);
        const moved = Object.assign({}, input, {name});
        for (const id of [moved.block, moved.shadow]) {
            if (id && blocks[id]) blocks[id].parent = parent;
        }
        return moved;
    };

    for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        if (!block || !block.inputs || !Object.prototype.hasOwnProperty.call(RANGE_INPUTS, block.opcode)) continue;
        const input = block.inputs.TIME_RANGE;
        if (!input) continue;
        const [startName, endName, start, end] = RANGE_INPUTS[block.opcode];
        const range = blocks[input.block];
        const shadow = blocks[input.shadow];
        const defaults = shadow && shadow.opcode === 'math_time_range' ?
            parseRange(shadow.fields.RANGE && shadow.fields.RANGE.value, start, end) : [start, end];

        if (range && range.opcode === 'objects_timeRangeValue') {
            block.inputs[startName] = moveInput(blockId, startName, range.inputs.T1, defaults[0]);
            block.inputs[endName] = moveInput(blockId, endName, range.inputs.T2, defaults[1]);
            delete blocks[input.block];
        } else if (range && range.opcode === 'math_time_range') {
            const values = parseRange(range.fields.RANGE && range.fields.RANGE.value, start, end);
            block.inputs[startName] = numberInput(blockId, startName, values[0]);
            block.inputs[endName] = numberInput(blockId, endName, values[1]);
            delete blocks[input.block];
        } else {
            // A numeric reporter in a range meant "from this time onwards".
            block.inputs[startName] = moveInput(blockId, startName, {
                block: input.block,
                shadow: numberInput(blockId, startName, defaults[0]).shadow
            }, defaults[0]);
            block.inputs[endName] = numberInput(blockId, endName, Infinity);
        }
        if (shadow && shadow.opcode === 'math_time_range') delete blocks[input.shadow];
        delete block.inputs.TIME_RANGE;
        changed = true;
    }

    for (const block of Object.values(blocks)) {
        if (block.opcode === 'math_time') {
            block.opcode = 'math_number';
            block.fields = {NUM: {name: 'NUM', value: String(block.fields.TIME.value)}};
            changed = true;
        } else if (block.opcode === 'math_time_range') {
            // Preserve a detached literal as an ordinary string reporter.
            block.opcode = 'text';
            block.fields = {TEXT: {name: 'TEXT', value: String(block.fields.RANGE.value)}};
            changed = true;
        } else if (block.opcode === 'objects_timeRangeValue') {
            // A detached pair can still produce its original string using Scratch's join reporters.
            const suffix = createBlock(block.id, 'operator_join', false);
            const suffixId = suffix.id;
            const separator = numberInput(suffixId, 'STRING1', '~');
            blocks[separator.block].opcode = 'text';
            blocks[separator.block].fields = {TEXT: {name: 'TEXT', value: '~'}};
            suffix.inputs = {
                STRING1: separator,
                STRING2: moveInput(suffixId, 'STRING2', block.inputs.T2, Infinity)
            };
            block.opcode = 'operator_join';
            block.inputs = {
                STRING1: moveInput(block.id, 'STRING1', block.inputs.T1, 0),
                STRING2: {name: 'STRING2', block: suffixId, shadow: null}
            };
            changed = true;
        }
    }
    return changed;
};

module.exports = {restoreNumberTimeInputs};
