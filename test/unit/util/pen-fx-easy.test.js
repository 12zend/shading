import fs from 'fs';
import path from 'path';
import VM from 'scratch-vm';

import {PLUGINS_DIR, installPenFX, listPluginIds, requirePluginModule} from '../../helpers/official-plugins';

// Easy looks are the official plugin shading-plugins/easy; their steps call blocks from the other effect plugins.
const {catalog: genshadeCatalog, genshadeOpcode} = requirePluginModule('genshade', 'lib/blocks.js');
const {easyBlocks, findEasyPreset} = requirePluginModule('easy', 'lib/presets.js');
const effectBlocks = listPluginIds()
    .map(id => path.join(PLUGINS_DIR, id, 'penfx-blocks.json'))
    .filter(file => fs.existsSync(file))
    .flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).blocks);

const createPenFX = () => {
    const vm = new VM();
    vm.runtime.renderer = {};
    installPenFX(vm);
    const penFX = vm.runtime.penFX;
    const calls = [];
    const engineState = {
        blendOpacity: 1,
        _restoreGLState: jest.fn(),
        withProgramOverrides: (overrides, callback) => callback()
    };
    penFX.engine = new Proxy(engineState, {
        get: (target, property) => (property in target ? target[property] : (...args) => {
            calls.push({method: property, args, blendMode: penFX.blendMode});
        })
    });
    return {vm, penFX, calls};
};

const builtinInputs = new Map(effectBlocks.map(block => [
    block.opcode,
    new Set((block.inputs || []).map(input => input.id))
]));
const genshadeParameters = new Map(genshadeCatalog.map(descriptor => [
    descriptor.id,
    new Set(descriptor.parameters.map(parameter => parameter.name))
]));

describe('Easy effect presets', () => {
    test('lists every Easy block first with a localized preset menu', () => {
        const {penFX} = createPenFX();
        const info = penFX.getInfo();
        const opcodes = info.blocks.filter(block => block && block.opcode).map(block => block.opcode);

        expect(opcodes.slice(0, easyBlocks.length)).toEqual(easyBlocks.map(block => block.opcode));
        expect(opcodes).toContain('easyColorGrading');
        for (const block of easyBlocks) {
            const toolboxBlock = info.blocks.find(entry => entry && entry.opcode === block.opcode);
            expect(toolboxBlock.arguments.PRESET).toMatchObject({menu: block.menu, defaultValue: block.presets[0].id});
            expect(info.menus[block.menu].items).toHaveLength(block.presets.length);
        }
        expect(info.menus.easyGlowPresets.items[0]).toEqual({text: 'Soft Glow', value: 'soft-glow'});
    });

    test('defines unique presets whose steps name real blocks, arguments and ReShade uniforms', () => {
        for (const block of easyBlocks) {
            expect(new Set(block.presets.map(preset => preset.id)).size).toBe(block.presets.length);
            for (const category of block.categories) {
                expect(block.presets.some(preset => preset.category === category.id)).toBe(true);
            }
            for (const preset of block.presets) {
                expect(block.categories.some(category => category.id === preset.category)).toBe(true);
                expect(preset.steps.length).toBeGreaterThan(0);
                for (const step of preset.steps) {
                    if (step.args.SETTINGS === undefined) {
                        const inputs = builtinInputs.get(step.method);
                        expect(inputs).toBeDefined();
                        for (const id of Object.keys(step.args)) {
                            if (!inputs.has(id)) throw new Error(`${preset.name}: ${step.method} has no ${id} input`);
                        }
                    } else {
                        const descriptor = genshadeCatalog.find(entry => genshadeOpcode(entry) === step.method);
                        expect(descriptor).toBeDefined();
                        for (const name of Object.keys(JSON.parse(step.args.SETTINGS))) {
                            if (!genshadeParameters.get(descriptor.id).has(name)) {
                                throw new Error(`${preset.name}: ${descriptor.name} has no ${name} uniform`);
                            }
                        }
                    }
                }
            }
        }
    });

    test('accepts the stored id or either displayed name', () => {
        expect(findEasyPreset('easyRetro', 'vhs').name).toBe('VHS');
        expect(findEasyPreset('easyBlur', 'Motion Blur').id).toBe('motion-blur');
        expect(findEasyPreset('easyBlur', 'モーションブラー').id).toBe('motion-blur');
        expect(findEasyPreset('easyBlur', 'unknown')).toBeNull();
        expect(findEasyPreset('missingBlock', 'vhs')).toBeNull();
    });

    test('queues every preset in the same tick and returns undefined', async () => {
        const {vm, penFX} = createPenFX();
        // Plugin blocks reach the VM's primitive table when the category refreshes after activation.
        await penFX.customShaders._scheduleRefresh();
        const queue = jest.spyOn(penFX, '_safe');
        for (const block of easyBlocks) {
            for (const preset of block.presets) {
                queue.mockClear();
                const result = vm.runtime._primitives[`penfx_${block.opcode}`]({PRESET: preset.id, MIX: 100}, {target: {}});
                expect(result).toBeUndefined();
                expect(result).not.toBeInstanceOf(Promise);
                expect(queue).toHaveBeenCalledTimes(preset.steps.length);
            }
        }
        expect(penFX.blendMode).toBe('normal');
    });

    test('scales each step by the Easy mix and skips a zero mix', () => {
        const {penFX, calls} = createPenFX();

        penFX.easyBlur({PRESET: 'soft-focus', MIX: 50}, {target: {}});
        expect(calls.map(call => call.method)).toEqual(['gaussian', 'bloom']);
        // gaussian(type, dir, value, mix): the step's own 45% mix is halved.
        expect(calls[0].args[3]).toBeCloseTo(0.225);
        // bloom has no mix input, so its strength is scaled instead.
        expect(calls[1].args[2]).toBeCloseTo(0.15);

        calls.length = 0;
        penFX.easyBlur({PRESET: 'soft-focus', MIX: 0}, {target: {}});
        penFX.easyBlur({PRESET: 'missing', MIX: 100}, {target: {}});
        expect(calls).toEqual([]);
    });

    test('applies a step blend mode only to that step', () => {
        const {penFX, calls} = createPenFX();
        penFX.blendMode = 'screen';

        penFX.easyStylize({PRESET: 'cartoon', MIX: 100}, {target: {}});

        const edge = calls.find(call => call.method === 'edgeDetection');
        expect(edge.args[edge.args.length - 1]).toBe('mul');
        expect(calls.find(call => call.method === 'kuwahara').args.slice(-1)[0]).toBe('screen');
        expect(penFX.blendMode).toBe('screen');
    });

    test('captures the block input for the picker only while it listens', () => {
        jest.useFakeTimers();
        try {
            const {penFX} = createPenFX();
            const snapshot = {width: 1, height: 1, pixels: new Uint8Array(4)};
            penFX.engine.captureEffectInput = jest.fn(() => snapshot);
            const util = {target: {}, thread: {peekStack: () => 'glow-block'}};

            penFX.easyGlow({PRESET: 'neon', MIX: 100}, util);
            expect(penFX.engine.captureEffectInput).not.toHaveBeenCalled();

            const listener = jest.fn();
            const unsubscribe = penFX.requestInputPreview('glow-block', listener);
            expect(penFX.easyGlow({PRESET: 'neon', MIX: 0}, util)).toBeUndefined();
            expect(penFX.engine.captureEffectInput).toHaveBeenCalledTimes(1);
            expect(listener).not.toHaveBeenCalled();
            jest.runAllTimers();
            expect(listener).toHaveBeenCalledWith(snapshot);
            unsubscribe();
        } finally {
            jest.useRealTimers();
        }
    });

    test('runs a preset for the picker without capturing the block input', () => {
        const {penFX, calls} = createPenFX();
        penFX.engine.captureEffectInput = jest.fn();
        penFX.requestInputPreview('glow-block', jest.fn());

        penFX.beginEffectCapture();
        penFX.runEasyPreset('easyGlow', 'neon-outline', 1, null);
        const effects = penFX.endEffectCapture();

        expect(effects).toHaveLength(2);
        expect(calls).toEqual([]);
        effects.forEach(effect => effect.callback(penFX.engine, null));
        expect(calls.map(call => call.method)).toEqual(['edgeDetection', 'deepGlow']);
        expect(penFX.engine.captureEffectInput).not.toHaveBeenCalled();
    });
});
