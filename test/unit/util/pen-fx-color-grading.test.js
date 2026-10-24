import {createPenFXClass, requirePluginModule} from '../../helpers/official-plugins';
import {getOwnerBlockId} from '../../../src/lib/plugins/ui/preset-picker';

// Color grading is provided by the official plugin shading-plugins/color-grading.
const {CATEGORIES, PRESETS, findPreset} = requirePluginModule('color-grading', 'lib/presets.js');
const {colorGradingUniforms} = requirePluginModule('color-grading', 'lib/uniforms.js');
const {LOOK_INPUTS, lookInputValues} = requirePluginModule('color-grading', 'lib/look-inputs.js');

const createPenFX = (runtime = {}) => {
    const PenFX = createPenFXClass({runtime: Object.assign({renderer: {}}, runtime)}, ['color-grading']);
    return new PenFX();
};

describe('Easy color grading', () => {
    test('lists the one-click looks first in the plugin section with one preset menu entry per look', () => {
        const info = createPenFX().getInfo();
        const label = info.blocks.findIndex(block => block.text === 'Color Grading');

        expect(label).toBeGreaterThanOrEqual(0);
        expect(info.blocks[label + 1]).toMatchObject({opcode: 'easyColorGrading'});
        expect(info.blocks[label + 2]).toMatchObject({opcode: 'colorGrade'});
        expect(info.blocks[label + 1].arguments.PRESET.menu).toBe('colorGradingPresets');
        expect(info.menus.colorGradingPresets.items).toHaveLength(PRESETS.length);
        expect(info.menus.colorGradingPresets.items[0]).toEqual({text: 'Teal&Orange', value: 'teal-and-orange'});
    });

    test('defines unique presets for every category', () => {
        expect(PRESETS.length).toBeGreaterThanOrEqual(100);
        expect(new Set(PRESETS.map(preset => preset.id)).size).toBe(PRESETS.length);
        for (const category of CATEGORIES) {
            expect(PRESETS.some(preset => preset.category === category.id)).toBe(true);
        }
        expect(findPreset('Bronze Tan').id).toBe('bronze-tan');
        expect(findPreset('day-f-night').name).toBe('Day f. Night');
        expect(findPreset('unknown')).toBeNull();
    });

    test('converts every preset into finite shader uniforms', () => {
        for (const preset of PRESETS) {
            const uniforms = colorGradingUniforms(preset);
            for (const [name, value] of Object.entries(uniforms)) {
                const values = Array.isArray(value) ? value : [value];
                expect(values.length).toBeLessThanOrEqual(4);
                values.forEach(component => {
                    if (!Number.isFinite(component)) throw new Error(`${preset.name} ${name} is not finite`);
                });
            }
        }
        const neutral = colorGradingUniforms({});
        expect(neutral.u_primaryA).toEqual([0, 0, 0, 1]);
        expect(neutral.u_curveA).toEqual([0, 0.25, 0.5]);
        expect(neutral.u_mixerR).toEqual([1, 0, 0]);
    });

    test('renders in the same tick and returns undefined', () => {
        const penFX = createPenFX();
        penFX.engine = {colorGrading: jest.fn()};

        expect(penFX.easyColorGrading({PRESET: 'golden-hour', MIX: 40}, {target: {}})).toBeUndefined();
        expect(penFX.easyColorGrading({PRESET: 'Sepia', MIX: 100}, {target: {}})).toBeUndefined();
        expect(penFX.easyColorGrading({PRESET: 'missing', MIX: 100}, {target: {}})).toBeUndefined();

        expect(penFX.engine.colorGrading).toHaveBeenCalledTimes(2);
        const [uniforms, mix, blendMode, time] = penFX.engine.colorGrading.mock.calls[0];
        expect(uniforms).toEqual(colorGradingUniforms(findPreset('golden-hour')));
        expect(mix).toBe(0.4);
        expect(blendMode).toBe('normal');
        expect(time).toBe(0);
    });

    test('captures the block input only while a preview is requested', () => {
        jest.useFakeTimers();
        try {
            const penFX = createPenFX();
            const snapshot = {width: 2, height: 1, pixels: new Uint8Array(8)};
            penFX.engine = {colorGrading: jest.fn(), captureEffectInput: jest.fn(() => snapshot)};
            const util = {target: {}, thread: {peekStack: () => 'grade-block'}};

            penFX.easyColorGrading({PRESET: 'vivid', MIX: 100}, util);
            expect(penFX.engine.captureEffectInput).not.toHaveBeenCalled();

            const listener = jest.fn();
            const unsubscribe = penFX.requestInputPreview('grade-block', listener);
            expect(penFX.easyColorGrading({PRESET: 'vivid', MIX: 100}, util)).toBeUndefined();
            expect(penFX.engine.captureEffectInput).toHaveBeenCalledTimes(1);
            expect(penFX.engine.captureEffectInput.mock.invocationCallOrder[0])
                .toBeLessThan(penFX.engine.colorGrading.mock.invocationCallOrder[1]);
            // The UI is notified after the render transaction, never inside it.
            expect(listener).not.toHaveBeenCalled();
            jest.runAllTimers();
            expect(listener).toHaveBeenCalledWith(snapshot);

            unsubscribe();
            jest.advanceTimersByTime(1000);
            penFX.easyColorGrading({PRESET: 'vivid', MIX: 100}, util);
            expect(penFX.engine.captureEffectInput).toHaveBeenCalledTimes(1);

            const reopened = jest.fn();
            penFX.requestInputPreview('grade-block', reopened);
            jest.runAllTimers();
            expect(reopened).toHaveBeenCalledWith(snapshot);
        } finally {
            jest.useRealTimers();
        }
    });

    test('shows the look\'s primary corrections as inputs, filled from the first look', () => {
        const block = createPenFX().getInfo().blocks.find(entry => entry.opcode === 'easyColorGrading');
        expect(block.text).toBe('color grading [PRESET] temp: [TEMP] tint: [TINT] exposure: [EXPOSURE] ' +
            'contrast: [CONTRAST] highlights: [HIGHLIGHTS] shadows: [SHADOWS] saturation: [SATURATION] ' +
            'vibrance: [VIBRANCE] mix: [MIX] %');
        expect(Object.keys(block.arguments)).toEqual(['PRESET'].concat(LOOK_INPUTS.map(input => input.id), 'MIX'));
        expect(block.arguments.TEMP.defaultValue).toBe(4);
        expect(block.arguments.CONTRAST.defaultValue).toBe(15);
        expect(block.arguments.HIGHLIGHTS.defaultValue).toBe(0);
        expect(lookInputValues(findPreset('golden-hour'))).toEqual({
            TEMP: 35, TINT: 5, EXPOSURE: 0.15, CONTRAST: 0, HIGHLIGHTS: -10, SHADOWS: 10, SATURATION: 0, VIBRANCE: 20
        });
    });

    test('grades with the inputs in place of the look\'s primary values and keeps the look for blank inputs', () => {
        const penFX = createPenFX();
        penFX.engine = {colorGrading: jest.fn()};
        const golden = findPreset('golden-hour');
        const lookArgs = Object.assign({PRESET: 'golden-hour', MIX: 100}, lookInputValues(golden));

        penFX.easyColorGrading(lookArgs, {target: {}});
        penFX.easyColorGrading(Object.assign({}, lookArgs, {TEMP: -20, SATURATION: '30'}), {target: {}});
        penFX.easyColorGrading({PRESET: 'golden-hour', MIX: 100, TEMP: '', TINT: ' '}, {target: {}});

        const calls = penFX.engine.colorGrading.mock.calls;
        expect(calls[0][0]).toEqual(colorGradingUniforms(golden));
        expect(calls[1][0]).toEqual(colorGradingUniforms(Object.assign({}, golden, {
            primary: Object.assign({}, golden.primary, {temperature: -20, saturation: 30})
        })));
        expect(calls[2][0]).toEqual(colorGradingUniforms(golden));
    });

    test('fills the inputs of look blocks saved before they existed', () => {
        const vm = {runtime: {renderer: {}}};
        new (createPenFXClass(vm, ['color-grading']))(); // eslint-disable-line no-new
        const project = {targets: [{blocks: {
            look: {opcode: 'penfx_easyColorGrading', inputs: {PRESET: [1, 'menu'], MIX: [1, [4, '100']]}},
            menu: {opcode: 'penfx_menu_colorGradingPresets', shadow: true, fields: {colorGradingPresets: ['vivid', null]}},
            dynamic: {opcode: 'penfx_easyColorGrading', inputs: {PRESET: [3, 'reporter', 'menu2']}},
            current: {opcode: 'penfx_easyColorGrading', inputs: {PRESET: [1, 'menu'], TEMP: [1, [4, '7']]}},
            variable: [12, 'my variable', 'id', 0, 0]
        }}]};
        for (const listener of vm.shadingPlugins.loadListeners) listener(project);

        const {blocks} = project.targets[0];
        const vivid = lookInputValues(findPreset('vivid'));
        for (const input of LOOK_INPUTS) {
            expect(blocks.look.inputs[input.id]).toEqual([1, [4, String(vivid[input.id])]]);
            // A reporter chooses the look at run time, so blank inputs keep whichever look it picks.
            expect(blocks.dynamic.inputs[input.id]).toEqual([1, [4, '']]);
        }
        expect(blocks.current.inputs.TEMP).toEqual([1, [4, '7']]);
        expect(blocks.current.inputs.TINT).toEqual([1, [4, String(vivid.TINT)]]);
    });

    test('previews the command block that owns the menu shadow', () => {
        const workspace = {isFlyout: false};
        const parent = {id: 'command'};
        const shadow = {workspace, isShadow: () => true, getParent: () => parent, id: 'shadow'};
        expect(getOwnerBlockId(shadow)).toBe('command');
        expect(getOwnerBlockId({...shadow, workspace: {isFlyout: true}})).toBeNull();
    });
});
