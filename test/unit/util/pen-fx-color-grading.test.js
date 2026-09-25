import {createPenFXClass, requirePluginModule} from '../../helpers/official-plugins';
import {getOwnerBlockId} from '../../../src/lib/plugins/ui/preset-picker';

// Color grading is provided by the official plugin shading-plugins/color-grading.
const {CATEGORIES, PRESETS, findPreset} = requirePluginModule('color-grading', 'lib/presets.js');
const {colorGradingUniforms} = requirePluginModule('color-grading', 'lib/uniforms.js');

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

    test('previews the command block that owns the menu shadow', () => {
        const workspace = {isFlyout: false};
        const parent = {id: 'command'};
        const shadow = {workspace, isShadow: () => true, getParent: () => parent, id: 'shadow'};
        expect(getOwnerBlockId(shadow)).toBe('command');
        expect(getOwnerBlockId({...shadow, workspace: {isFlyout: true}})).toBeNull();
    });
});
