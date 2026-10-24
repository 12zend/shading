import {localize} from '../../movie-block-l10n';
import {createPresetActionField} from './preset-picker';
import {EffectPreviewRenderer} from './preview-renderer';

// PenFX blocks whose package lists presets get a "presets" menu next to their name. Picking a preset writes its
// values into the block's inputs as one undo step; the menu itself stores nothing, so projects are unchanged and
// the block keeps running on its inputs.

const PRESET_FIELD_NAME = 'SHADING_PRESETS';
const EXTENSION_ID = 'penfx';

// One WebGL context draws every preset menu's thumbnails; the definitions are rebuilt often.
let sharedRenderer = null;
const getRenderer = penFX => {
    if (!sharedRenderer || sharedRenderer.penFX !== penFX) {
        if (sharedRenderer) sharedRenderer.dispose();
        sharedRenderer = new EffectPreviewRenderer(penFX);
    }
    return sharedRenderer;
};

const firstField = block => {
    for (const input of block.inputList) {
        for (const field of input.fieldRow) {
            if (field.name) return field;
        }
    }
    return null;
};

/**
 * Write values into a block's inputs. Only inputs that hold their own field (a shadow such as a number, color or
 * menu) are changed; an input with a reporter dropped into it keeps the reporter.
 * @param {object} block Blockly block.
 * @param {object} values {inputName: value}.
 * @returns {number} How many inputs changed.
 */
const setBlockInputs = (block, values) => {
    if (!block || !values) return 0;
    let changed = 0;
    for (const name of Object.keys(values)) {
        const input = block.getInput(name);
        const target = input && input.connection && input.connection.targetBlock();
        if (!target || !target.isShadow()) continue;
        const field = firstField(target);
        if (!field) continue;
        const value = String(values[name]);
        if (field.getValue() === value) continue;
        field.setValue(value);
        changed++;
    }
    return changed;
};

const refreshPreview = ScratchBlocks => {
    if (typeof ScratchBlocks.movieNumberScrubChangeCallback_ === 'function') {
        ScratchBlocks.movieNumberScrubChangeCallback_();
    }
};

// Put the menu right after the block's name ("bloom [presets] threshold: ..."), splitting the first label when
// the name and the first input's label share it. Blocks whose text does not start with their name get it first.
const insertPresetField = (ScratchBlocks, block, field, blockName) => {
    for (const input of block.inputList) {
        for (let index = 0; index < input.fieldRow.length; index++) {
            const label = input.fieldRow[index];
            if (!(label instanceof ScratchBlocks.FieldLabel)) continue;
            const text = label.getText();
            if (text === blockName) {
                input.insertFieldAt(index + 1, field, PRESET_FIELD_NAME);
            } else if (text.startsWith(blockName) && /\s/.test(text.charAt(blockName.length))) {
                label.setText(blockName);
                input.insertFieldAt(index + 1, field, PRESET_FIELD_NAME);
                input.insertFieldAt(index + 2, new ScratchBlocks.FieldLabel(text.slice(blockName.length).trim()));
            } else {
                input.insertFieldAt(index, field, PRESET_FIELD_NAME);
            }
            return;
        }
    }
    if (block.inputList.length) block.inputList[0].insertFieldAt(0, field, PRESET_FIELD_NAME);
};

const defaultArguments = inputs => {
    const args = {};
    for (const input of inputs) args[input.id] = input.defaultValue;
    return args;
};

/**
 * Add the presets menu to every PenFX block definition that has presets. Run after the category's blocks are
 * (re)defined.
 * @param {object} ScratchBlocks scratch-blocks.
 * @param {object} vm VM.
 * @param {string} locale Locale.
 */
const installInputPresetFields = (ScratchBlocks, vm, locale) => {
    const penFX = vm && vm.runtime && vm.runtime.penFX;
    const customShaders = penFX && penFX.customShaders;
    if (!customShaders || typeof customShaders.getPresetOpcodes !== 'function' || !ScratchBlocks.FieldDropdown) {
        return;
    }
    for (const opcode of customShaders.getPresetOpcodes()) {
        const definition = ScratchBlocks.Blocks[`${EXTENSION_ID}_${opcode}`];
        const info = customShaders.getInputPresets(opcode, locale);
        if (!definition || !info) continue;
        const baseArguments = defaultArguments(info.inputs);
        const pickerSource = () => ({
            label: localize(locale, `${info.name} presets`, `${info.name}のプリセット`),
            buttonLabel: localize(locale, 'presets', 'プリセット'),
            categories: [{id: 'presets', name: localize(locale, 'Presets', 'プリセット')}],
            presets: info.presets.map(preset => ({id: preset.id, name: preset.name, category: 'presets', preset})),
            thumbnailsPerFrame: 8,
            frameBudgetMs: 12,
            getRenderer: () => getRenderer(penFX),
            drawThumbnail: (previewRenderer, entry, canvas) => previewRenderer.draw(
                instance => instance[opcode](Object.assign({}, baseArguments, entry.preset.values), null),
                canvas
            ),
            onSelect: (entry, block) => {
                if (block && setBlockInputs(block, entry.preset.values)) refreshPreview(ScratchBlocks);
            }
        });
        const PresetField = createPresetActionField(ScratchBlocks, vm, locale, pickerSource);
        // Definitions are rebuilt when the category refreshes; never wrap the same one twice.
        const init = definition.shadingPresetsInit_ || definition.init;
        definition.shadingPresetsInit_ = init;
        definition.init = function () {
            init.call(this);
            insertPresetField(ScratchBlocks, this, new PresetField(), info.name);
        };
    }
};

export {PRESET_FIELD_NAME, installInputPresetFields, setBlockInputs};
