import {
    CUSTOM_SHADER_FORMAT,
    CUSTOM_SHADER_VERSION,
    PenFXCustomShaderManager,
    normalizePackage
} from '../../../src/lib/pen-fx/custom-shaders';
import {PRESET_FIELD_NAME, installInputPresetFields, setBlockInputs} from '../../../src/lib/plugins/ui/input-presets';

const presetPackage = (presets, inputs) => ({
    format: CUSTOM_SHADER_FORMAT,
    version: CUSTOM_SHADER_VERSION,
    id: 'preset-pack',
    blocks: [{
        id: 'warm-glow',
        name: 'warm glow',
        text: 'warm glow radius: [RADIUS] color: [COLOR] shape: [SHAPE] mix: [MIX] %',
        implementation: {type: 'penfx', opcode: 'warmGlow'},
        inputs: inputs || [
            {id: 'RADIUS', type: 'number', defaultValue: 8},
            {id: 'COLOR', type: 'color', defaultValue: '#ffffff'},
            {id: 'SHAPE', type: 'menu', items: ['circle', 'hexagon']},
            {id: 'MIX', type: 'number', defaultValue: 100}
        ],
        presets
    }]
});

// Plugins install implementations on the PenFX prototype; the manager puts opcode wrappers on the instance.
const fakePenFX = members => Object.assign(Object.create({setBlendMode: jest.fn(), warmGlow: jest.fn()}), members);

describe('PenFX input presets', () => {
    test('normalizes presets and keeps blocks without presets unchanged', () => {
        const descriptor = normalizePackage(presetPackage([
            {id: 'soft', name: 'Soft', values: {RADIUS: '16', COLOR: '#FFB070', SHAPE: 'hexagon'}},
            {name: 'Big Glow', values: {RADIUS: 40}}
        ]));
        expect(descriptor.blocks[0].presets).toEqual([
            {id: 'soft', name: 'Soft', values: {RADIUS: 16, COLOR: '#FFB070', SHAPE: 'hexagon'}},
            {id: 'big-glow', name: 'Big Glow', values: {RADIUS: 40}}
        ]);
        expect(normalizePackage(presetPackage(undefined)).blocks[0]).not.toHaveProperty('presets');
        expect(normalizePackage(presetPackage([])).blocks[0]).not.toHaveProperty('presets');
    });

    test('rejects presets that do not match the block inputs', () => {
        const reject = (presets, inputs) => expect(() => normalizePackage(presetPackage(presets, inputs))).toThrow();
        reject([{id: 'a', values: {UNKNOWN: 1}}]);
        reject([{id: 'a', values: {COLOR: 'orange'}}]);
        reject([{id: 'a', values: {SHAPE: 'square'}}]);
        reject([{id: 'a', values: {RADIUS: 'wide'}}]);
        reject([{id: 'a', values: {}}]);
        reject([{id: 'a', values: {RADIUS: 1}}, {id: 'a', values: {RADIUS: 2}}]);
        reject({id: 'a'});
        reject([{id: 'a', values: {FLAG: true}}], [
            {id: 'FLAG', type: 'boolean'}, {id: 'RADIUS'}, {id: 'COLOR', type: 'color'}, {id: 'SHAPE', type: 'menu',
                items: ['circle']}, {id: 'MIX'}
        ]);
        reject(Array.from({length: 65}, (unused, index) => ({id: `p${index}`, values: {RADIUS: index}})));
    });

    test('lists localized presets of bound plugin blocks by opcode', () => {
        const vm = {runtime: {renderer: {}}};
        const penFX = fakePenFX({_safe: jest.fn(), hasInputPreviewListener: () => false});
        const manager = new PenFXCustomShaderManager(vm, penFX);
        manager.registerPluginPackage(presetPackage([{id: 'soft', name: 'Soft', values: {RADIUS: 16}}]), {
            translations: {ja: {'warm-glow': {name: '暖かいグロー', presets: {soft: 'ソフト'}}}}
        });
        expect(manager.getPresetOpcodes()).toEqual(['shader_preset_pack_warm_glow']);
        expect(manager.getInputPresets('shader_preset_pack_warm_glow', 'en')).toMatchObject({
            name: 'warm glow',
            presets: [{id: 'soft', name: 'Soft', values: {RADIUS: 16}}]
        });
        expect(manager.getInputPresets('shader_preset_pack_warm_glow', 'ja')).toMatchObject({
            name: '暖かいグロー',
            presets: [{name: 'ソフト'}]
        });
        expect(manager.getInputPresets('setBlendMode', 'en')).toBeNull();
    });

    test('a preset block records its input while a picker previews it, and still returns undefined', () => {
        const vm = {runtime: {renderer: {}}};
        const queued = [];
        const penFX = fakePenFX({
            _safe: (callback, options) => queued.push(options),
            hasInputPreviewListener: blockId => blockId === 'block-1'
        });
        const manager = new PenFXCustomShaderManager(vm, penFX);
        manager.registerPluginPackage(presetPackage([{id: 'soft', values: {RADIUS: 16}}]));
        const target = {};
        const result = penFX.shader_preset_pack_warm_glow({RADIUS: 3}, {target, thread: {peekStack: () => 'block-1'}});
        expect(result).toBeUndefined();
        expect(queued).toEqual([{target}]);
        expect(penFX.warmGlow).toHaveBeenCalledWith({RADIUS: 3}, expect.anything());
        penFX.shader_preset_pack_warm_glow({}, {target, thread: {peekStack: () => 'other'}});
        expect(queued).toHaveLength(1);
    });
});

// Minimal Blockly stand-ins: a block's inputs hold fields and shadow blocks with a single field.
class FakeField {
    constructor (value) {
        this.value = value;
    }
    getValue () {
        return this.value;
    }
    setValue (value) {
        this.value = value;
    }
}
class FakeLabel extends FakeField {
    getText () {
        return this.value;
    }
    setText (text) {
        this.value = text;
    }
}
function FakeDropdown (menuGenerator) {
    this.menuGenerator = menuGenerator;
    this.value = menuGenerator()[0][1];
}
FakeDropdown.prototype = Object.create(FakeField.prototype);

const shadow = (name, value) => {
    const field = new FakeField(String(value));
    field.name = name;
    return {isShadow: () => true, inputList: [{fieldRow: [field]}], field};
};

const fakeInput = (name, labels, target = null) => ({
    name,
    fieldRow: labels.map(text => new FakeLabel(text)),
    connection: {targetBlock: () => target},
    insertFieldAt (index, field, fieldName) {
        if (fieldName) field.name = fieldName;
        this.fieldRow.splice(index, 0, field);
    }
});

const fakeBlock = inputs => ({
    inputList: inputs,
    getInput: name => inputs.find(input => input.name === name) || null
});

describe('PenFX preset menus in the editor', () => {
    test('setBlockInputs writes shadow fields and leaves reporters and missing inputs alone', () => {
        const radius = shadow('NUM', 8);
        const color = shadow('COLOUR', '#ffffff');
        const reporter = {isShadow: () => false, inputList: []};
        const block = fakeBlock([
            fakeInput('RADIUS', ['radius:'], radius),
            fakeInput('COLOR', ['color:'], color),
            fakeInput('SHAPE', ['shape:'], reporter)
        ]);
        expect(setBlockInputs(block, {RADIUS: 16, COLOR: '#ffb070', SHAPE: 'hexagon', MISSING: 1})).toBe(2);
        expect(radius.field.getValue()).toBe('16');
        expect(color.field.getValue()).toBe('#ffb070');
        expect(setBlockInputs(block, {RADIUS: 16})).toBe(0);
    });

    const setup = (name, labels) => {
        const ScratchBlocks = {
            FieldLabel: FakeLabel,
            FieldDropdown: FakeDropdown,
            Blocks: {}
        };
        const definition = {init: jest.fn()};
        ScratchBlocks.Blocks.penfx_bloom = definition;
        const vm = {
            runtime: {
                penFX: {
                    customShaders: {
                        getPresetOpcodes: () => ['bloom'],
                        getInputPresets: () => ({
                            name,
                            inputs: [{id: 'RADIUS', defaultValue: 8}],
                            presets: [{id: 'soft', name: 'Soft', values: {RADIUS: 16}}]
                        })
                    }
                }
            }
        };
        return {ScratchBlocks, definition, vm, block: fakeBlock([fakeInput('RADIUS', labels)])};
    };

    test('adds an unsaved presets menu right after the block name', () => {
        const {ScratchBlocks, definition, vm, block} = setup('bloom', ['bloom threshold:']);
        installInputPresetFields(ScratchBlocks, vm, 'en');
        // Running the definers again (the category refreshes) must not add a second menu.
        installInputPresetFields(ScratchBlocks, vm, 'en');
        definition.init.call(block);
        const fieldRow = block.inputList[0].fieldRow;
        expect(fieldRow.map(field => field.name || field.getText())).toEqual(['bloom', PRESET_FIELD_NAME, 'threshold:']);
        const presetField = fieldRow[1];
        expect(presetField.SERIALIZABLE).toBe(false);
        expect(presetField.menuGenerator()).toEqual([['presets', '__presets__']]);
    });

    test('puts the menu first when the text does not start with the block name', () => {
        const {ScratchBlocks, definition, vm, block} = setup('deep glow', ['glow amount:']);
        installInputPresetFields(ScratchBlocks, vm, 'ja');
        definition.init.call(block);
        const fieldRow = block.inputList[0].fieldRow;
        expect(fieldRow[0].name).toBe(PRESET_FIELD_NAME);
        expect(fieldRow[0].menuGenerator()).toEqual([['プリセット', '__presets__']]);
        expect(fieldRow[1].getText()).toBe('glow amount:');
    });
});
