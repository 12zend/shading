jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';
import sb3 from 'scratch-vm/src/serialization/sb3';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';

import installObjectBlocks, {createObjectBlocksClass} from '../../../src/lib/object-blocks';
import installMovieEasing from '../../../src/lib/movie-easing';
import {restoreNumberTimeInputs} from '../../../scratch-vm/src/lib/time-input-compatibility';

const node = (opcode, inputs = {}, fields = {}, parent = null) => ({
    opcode, inputs, fields, parent, next: null, shadow: false, topLevel: parent === null
});
const time = (parent, value) => ({...node('math_time', {}, {TIME: [value, null]}, parent), shadow: true});
const range = (parent, value) => ({...node('math_time_range', {}, {RANGE: [value, null]}, parent), shadow: true});
const makeIds = () => {
    let id = 0;
    return () => `restored${id++}`;
};
const assertOrdinaryInputs = blocks => {
    for (const block of Object.values(blocks)) {
        expect(['math_time', 'math_time_range', 'objects_timeRangeValue']).not.toContain(block.opcode);
        expect(block.inputs.TIME_RANGE).toBeUndefined();
        for (const input of Object.values(block.inputs)) {
            for (const id of [input.block, input.shadow]) {
                if (id) expect(blocks[id].parent).toBe(block.id);
            }
        }
    }
};

describe('restoring number inputs after removing time fields', () => {
    test.each([
        ['objects_draw', 'T1', 'T2'],
        ['objects_shape', 'T1', 'T2'],
        ['objects_arc', 'T1', 'T2'],
        ['objects_circularSegment', 'T1', 'T2'],
        ['objects_line', 'T1', 'T2'],
        ['objects_animate', 'T1', 'T2'],
        ['objects_timeWithin', 'T1', 'T2'],
        ['objects_interpolateColor', 'T1', 'T2'],
        ['objects_interpolateAngle', 'T1', 'T2'],
        ['objects_interpolateVector', 'T1', 'T2'],
        ['sound_playattime', 'T1', 'T2'],
        ['operator_easing', 'T0', 'T1']
    ])('restores the literal input names for %s', (opcode, first, second) => {
        const blocks = sb3.deserializeBlocks({
            command: node(opcode, {TIME_RANGE: [1, 'range'], OTHER: [1, [4, '7']]}),
            range: range('command', '1.5~Infinity')
        });
        const other = blocks.command.inputs.OTHER;
        expect(restoreNumberTimeInputs(blocks, makeIds())).toBe(true);
        expect(blocks[blocks.command.inputs[first].shadow].fields.NUM.value).toBe('1.5');
        expect(blocks[blocks.command.inputs[second].shadow].fields.NUM.value).toBe('Infinity');
        expect(blocks.command.inputs.OTHER).toBe(other);
        expect(blocks.range).toBeUndefined();
        assertOrdinaryInputs(blocks);
        const snapshot = JSON.stringify(blocks);
        expect(restoreNumberTimeInputs(blocks, makeIds())).toBe(false);
        expect(JSON.stringify(blocks)).toBe(snapshot);
    });

    test('unwraps calculated endpoints and preserves their obscured number shadows and IDs', () => {
        const blocks = sb3.deserializeBlocks({
            easing: node('operator_easing', {TIME_RANGE: [3, 'pair', 'range']}),
            range: range('easing', '7.5~10'),
            pair: node('objects_timeRangeValue', {T1: [3, 'add', 'start'], T2: [3, 'timer', 'end']}, {}, 'easing'),
            start: time('pair', '7.5'),
            end: time('pair', '10'),
            add: node('operator_add', {NUM1: [1, [4, '7.5']], NUM2: [1, [4, '1']]}, {}, 'pair'),
            timer: node('sensing_timer', {}, {}, 'pair')
        });
        const add = blocks.add;
        restoreNumberTimeInputs(blocks, makeIds());
        expect(blocks.easing.inputs.T0).toEqual({name: 'T0', block: 'add', shadow: 'start'});
        expect(blocks.easing.inputs.T1).toEqual({name: 'T1', block: 'timer', shadow: 'end'});
        expect(blocks.add).toBe(add);
        expect(blocks.start.fields.NUM.value).toBe('7.5');
        expect(blocks.end.fields.NUM.value).toBe('10');
        expect(blocks.pair).toBeUndefined();
        expect(blocks.range).toBeUndefined();
        assertOrdinaryInputs(blocks);
    });

    test('restores single time fields without changing old sound blocks or number inputs', () => {
        const blocks = sb3.deserializeBlocks({
            freeze: node('objects_timeFreeze', {TIME: [1, 'time']}),
            time: time('freeze', '1.25'),
            sound: node('sound_playattime', {TIME: [1, [4, '3']]}),
            within: node('objects_timeWithin', {T1: [1, [4, '2']], T2: [1, [4, '3']]})
        });
        const sound = JSON.stringify(blocks.sound);
        const within = JSON.stringify(blocks.within);
        restoreNumberTimeInputs(blocks, makeIds());
        expect(blocks.time).toEqual(expect.objectContaining({
            opcode: 'math_number', fields: {NUM: {name: 'NUM', value: '1.25'}}
        }));
        expect(JSON.stringify(blocks.sound)).toBe(sound);
        expect(JSON.stringify(blocks.within)).toBe(within);
        assertOrdinaryInputs(blocks);
    });

    test('keeps a numeric reporter in the start input with an infinite end', () => {
        const blocks = sb3.deserializeBlocks({
            within: node('objects_timeWithin', {TIME_RANGE: [3, 'timer', 'range']}),
            range: range('within', '2~3'),
            timer: node('sensing_timer', {}, {}, 'within')
        });
        restoreNumberTimeInputs(blocks, makeIds());
        expect(blocks.within.inputs.T1.block).toBe('timer');
        expect(blocks[blocks.within.inputs.T1.shadow].fields.NUM.value).toBe('2');
        expect(blocks[blocks.within.inputs.T2.shadow].fields.NUM.value).toBe('Infinity');
        assertOrdinaryInputs(blocks);
    });

    test.each([false, true])('restores shared/backpack blocks and extension URLs (%s)', withURLs => {
        const blocks = sb3.deserializeBlocks({
            draw: node('objects_draw', {TIME_RANGE: [1, 'range']}),
            range: range('draw', '2~4')
        });
        const source = Object.values(blocks);
        const before = JSON.stringify(source);
        const input = withURLs ? {blocks: source, extensionURLs: {custom: 'https://example.com/custom.js'}} : source;
        const restored = sb3.deserializeStandaloneBlocks(input);
        expect(restored.blocks[0].id).toBe('draw');
        assertOrdinaryInputs(Object.fromEntries(restored.blocks.map(block => [block.id, block])));
        if (withURLs) expect(restored.extensionURLs.get('custom')).toBe('https://example.com/custom.js');
        else expect(restored.extensionURLs.has('custom')).toBe(false);
        expect(JSON.stringify(source)).toBe(before);
    });

    test('registers the original number argument definitions', () => {
        const ObjectBlocks = createObjectBlocksClass({runtime: {}});
        const blocks = new ObjectBlocks().getInfo().blocks;
        expect(ArgumentType.TIME).toBeUndefined();
        expect(ArgumentType.TIME_RANGE).toBeUndefined();
        expect(blocks.some(block => block.opcode === 'timeRangeValue')).toBe(false);
        expect(blocks.find(block => block.opcode === 'timeWithin').arguments).toEqual({
            T1: {type: ArgumentType.NUMBER, defaultValue: 0},
            T2: {type: ArgumentType.NUMBER, defaultValue: 1}
        });
    });
});

const project = blocks => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {out: ['out', 0], offset: ['offset', 0]},
        lists: {},
        broadcasts: {},
        blocks,
        comments: {},
        costumes: [],
        sounds: [],
        currentCostume: 0,
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: ['objects'],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});
const load = async json => {
    const vm = new VM();
    installObjectBlocks(vm);
    installMovieEasing(vm);
    await vm.loadProject(JSON.stringify(json));
    return vm;
};
const run = (vm, compilerEnabled, timer) => {
    vm.setCompilerOptions({enabled: compilerEnabled});
    const runtime = vm.runtime;
    runtime.ioDevices.clock.projectTimer = () => timer;
    runtime.currentStepTime = 1000 / 30;
    const target = runtime.targets[0];
    const script = Object.values(target.blocks._blocks).find(block => block.opcode === 'data_setvariableto');
    const thread = runtime._pushThread(script.id, target);
    runtime.sequencer.stepThreads();
    expect(thread.isCompiled).toBe(compilerEnabled);
    return target.variables.out.value;
};

describe('loading and executing projects with retired time fields', () => {
    test.each([true, false])('preserves easing after load/save/reload (compiler: %s)', async compilerEnabled => {
        const json = project({
            set: node('data_setvariableto', {VALUE: [3, 'easing', [10, '']]}, {VARIABLE: ['out', 'out']}),
            easing: node('operator_easing', {
                TIME_RANGE: [3, 'pair', 'range'],
                V0: [1, [4, '0']],
                V1: [1, [4, '100']],
                POWER: [1, [4, '2']],
                SPEED: [1, [4, '0']],
                STRENGTH: [1, [4, '0']]
            }, {TYPE: ['PowerIn', null], TYPE2: ['Elastic', null]}, 'set'),
            range: range('easing', '1~3'),
            pair: node('objects_timeRangeValue', {T1: [3, 'add', 'start'], T2: [1, 'end']}, {}, 'easing'),
            start: time('pair', '1'),
            end: time('pair', '3'),
            add: node('operator_add', {NUM1: [1, [4, '1']], NUM2: [3, [12, 'offset', 'offset'], [4, '0']]}, {}, 'pair')
        });
        const vm = await load(json);
        const blocks = vm.runtime.targets[0].blocks._blocks;
        assertOrdinaryInputs(blocks);
        expect(Number(run(vm, compilerEnabled, 2))).toBeCloseTo(25);
        vm.runtime.targets[0].variables.offset.value = 1;
        expect(Number(run(vm, compilerEnabled, 2))).toBe(0);
        vm.runtime.targets[0].variables.offset.value = 0;
        const saved = JSON.parse(vm.toJSON());
        const reloaded = await load(saved);
        assertOrdinaryInputs(reloaded.runtime.targets[0].blocks._blocks);
        expect(Number(run(reloaded, compilerEnabled, 2))).toBeCloseTo(25);
    });

    test.each([true, false])('preserves literal unbounded conditions (compiler: %s)', async compilerEnabled => {
        const vm = await load(project({
            set: node('data_setvariableto', {VALUE: [3, 'within', [10, '']]}, {VARIABLE: ['out', 'out']}),
            within: node('objects_timeWithin', {TIME_RANGE: [1, 'range']}, {}, 'set'),
            range: range('within', '100~Infinity')
        }));
        expect(run(vm, compilerEnabled, 99)).toBe(false);
        expect(run(vm, compilerEnabled, 100)).toBe(true);
        expect(run(vm, compilerEnabled, 120)).toBe(true);
    });

    test.each([true, false])('restores detached ranges (compiler: %s)', async compilerEnabled => {
        const vm = await load(project({
            set: node('data_setvariableto', {VALUE: [3, 'pair', [10, '']]}, {VARIABLE: ['out', 'out']}),
            pair: node('objects_timeRangeValue', {T1: [1, 'start'], T2: [1, 'end']}, {}, 'set'),
            start: time('pair', '1.5'),
            end: time('pair', 'Infinity')
        }));
        assertOrdinaryInputs(vm.runtime.targets[0].blocks._blocks);
        expect(run(vm, compilerEnabled, 0)).toBe('1.5~Infinity');
    });
});
