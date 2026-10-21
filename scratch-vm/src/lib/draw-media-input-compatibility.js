/**
 * Move the Objects draw media from its retired ASSET field into a reporter-accepting menu input.
 * This runs only while importing blocks; execution and the editor read the ASSET input.
 */

const DRAW_MEDIA_MENU = 'objects_menu_media';

/**
 * Convert a deserialized SB3 block map in place. The menu keeps the stored value, so the
 * draw block still decodes it with its SOURCE field.
 * @param {object} blocks Block ID to deserialized block.
 * @param {function(): string} makeId Generate an unused block ID.
 * @returns {boolean} Whether any blocks changed.
 */
const restoreDrawMediaInputs = (blocks, makeId) => {
    let changed = false;
    for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        if (!block || block.opcode !== 'objects_draw' || !block.fields || !block.fields.ASSET) continue;
        const field = block.fields.ASSET;
        delete block.fields.ASSET;
        if (!block.inputs) block.inputs = {};
        if (!block.inputs.ASSET) {
            let id;
            do {
                id = makeId();
            } while (Object.prototype.hasOwnProperty.call(blocks, id));
            const value = field.value === null || typeof field.value === 'undefined' ? '' : String(field.value);
            blocks[id] = {
                id,
                opcode: DRAW_MEDIA_MENU,
                next: null,
                parent: blockId,
                inputs: {},
                fields: {ASSET: {name: 'ASSET', value}},
                shadow: true,
                topLevel: false
            };
            block.inputs.ASSET = {name: 'ASSET', block: id, shadow: id};
        }
        changed = true;
    }
    return changed;
};

module.exports = {DRAW_MEDIA_MENU, restoreDrawMediaInputs};
