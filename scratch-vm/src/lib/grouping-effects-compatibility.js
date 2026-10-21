/**
 * Move the effects of a retired two-slot grouping into its single substack.
 * Grouping was an E-shaped block whose second slot (SUBSTACK2) held effects applied to the first slot. It is now a
 * C-block in which effects apply to what is drawn above them, so the effects stack is appended to the objects stack.
 * This runs only while importing blocks.
 */

const GROUPING_OPCODE = 'objects_grouping';
const EFFECTS_INPUT = 'SUBSTACK2';

/**
 * Convert a deserialized SB3 block map in place.
 * @param {object} blocks Block ID to deserialized block.
 * @returns {boolean} Whether any blocks changed.
 */
const mergeGroupingEffects = blocks => {
    let changed = false;
    for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        if (!block || block.opcode !== GROUPING_OPCODE || !block.inputs || !block.inputs[EFFECTS_INPUT]) continue;
        const effectsId = block.inputs[EFFECTS_INPUT].block;
        delete block.inputs[EFFECTS_INPUT];
        changed = true;
        const effects = effectsId && blocks[effectsId];
        if (!effects) continue;

        const objects = block.inputs.SUBSTACK;
        let last = objects && objects.block ? blocks[objects.block] : null;
        while (last && last.next && blocks[last.next]) last = blocks[last.next];
        if (last) {
            last.next = effectsId;
            effects.parent = last.id;
        } else {
            block.inputs.SUBSTACK = {name: 'SUBSTACK', block: effectsId, shadow: null};
            effects.parent = blockId;
        }
    }
    return changed;
};

module.exports = {mergeGroupingEffects};
