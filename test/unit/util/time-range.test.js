jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import installObjectBlocks from '../../../src/lib/object-blocks';
import installMovieEasing from '../../../src/lib/movie-easing';
import {
    formatTimeRange,
    migrateTimeInputs,
    parseTimeRange,
    withTimeRangeArgs
} from '../../../scratch-vm/src/lib/time-range';
import {normalizeRange, normalizeSingle} from '../../../src/lib/time-field';

const numberShadow = (id, parent, value) => ({
    id,
    opcode: 'math_number',
    next: null,
    parent,
    inputs: {},
    fields: {NUM: {name: 'NUM', value}},
    shadow: true,
    topLevel: false
});

const makeIds = () => {
    let next = 0;
    return () => `new${next++}`;
};

describe('time argument values', () => {
    test('parses and formats time ranges', () => {
        expect(parseTimeRange('1.5~10')).toEqual({start: 1.5, end: 10});
        expect(parseTimeRange(' 0 ~ Infinity ')).toEqual({start: 0, end: Infinity});
        expect(parseTimeRange('2~∞')).toEqual({start: 2, end: Infinity});
        expect(parseTimeRange('-1~2')).toEqual({start: -1, end: 2});
        expect(parseTimeRange(3)).toEqual({start: 3, end: Infinity});
        expect(parseTimeRange('~', [0, 1])).toEqual({start: 0, end: 1});
        expect(formatTimeRange(0, Infinity)).toBe('0~Infinity');
        expect(formatTimeRange('1.5', 10)).toBe('1.5~10');
    });

    test('passes plain T1/T2 arguments through and expands TIME_RANGE', () => {
        const legacy = {T1: 1, T2: 2};
        expect(withTimeRangeArgs(legacy)).toBe(legacy);
        const args = {TIME_RANGE: '1~4', OTHER: 'x'};
        expect(withTimeRangeArgs(args)).toEqual({TIME_RANGE: '1~4', OTHER: 'x', T1: 1, T2: 4});
        expect(args).toEqual({TIME_RANGE: '1~4', OTHER: 'x'});
    });

    test('normalizes typed field values', () => {
        expect(normalizeSingle('1.50')).toBe('1.5');
        expect(normalizeSingle('')).toBe('0');
        expect(normalizeSingle('abc')).toBeNull();
        expect(normalizeRange('0 ~ inf')).toBe('0~Infinity');
        expect(normalizeRange('1.25~3')).toBe('1.25~3');
        expect(normalizeRange('2')).toBe('2~Infinity');
        expect(normalizeRange('1~2~3')).toBeNull();
        expect(normalizeRange('a~2')).toBeNull();
    });
});

describe('migrating old T1/T2 inputs', () => {
    test('merges literal T1/T2 shadows into one time range shadow', () => {
        const blocks = {
            draw: {
                id: 'draw',
                opcode: 'objects_draw',
                next: null,
                parent: null,
                inputs: {
                    T1: {name: 'T1', block: 't1', shadow: 't1'},
                    T2: {name: 'T2', block: 't2', shadow: 't2'},
                    PX: {name: 'PX', block: 'px', shadow: 'px'}
                },
                fields: {},
                shadow: false,
                topLevel: true
            },
            t1: numberShadow('t1', 'draw', '1.5'),
            t2: numberShadow('t2', 'draw', 'Infinity'),
            px: numberShadow('px', 'draw', '10')
        };

        expect(migrateTimeInputs(blocks, makeIds())).toBe(true);

        expect(blocks.draw.inputs.T1).toBeUndefined();
        expect(blocks.draw.inputs.T2).toBeUndefined();
        expect(blocks.t1).toBeUndefined();
        expect(blocks.t2).toBeUndefined();
        expect(blocks.draw.inputs.PX).toEqual({name: 'PX', block: 'px', shadow: 'px'});
        const range = blocks.draw.inputs.TIME_RANGE;
        expect(range.block).toBe(range.shadow);
        expect(blocks[range.shadow]).toEqual(expect.objectContaining({
            opcode: 'math_time_range',
            parent: 'draw',
            shadow: true,
            fields: {RANGE: {name: 'RANGE', value: '1.5~Infinity'}}
        }));

        // Running it again (an already-migrated project) changes nothing.
        const snapshot = JSON.stringify(blocks);
        expect(migrateTimeInputs(blocks, makeIds())).toBe(false);
        expect(JSON.stringify(blocks)).toBe(snapshot);
    });

    test('keeps reporters plugged into T1/T2 inside a range reporter', () => {
        const blocks = {
            within: {
                id: 'within',
                opcode: 'objects_timeWithin',
                next: null,
                parent: null,
                inputs: {
                    T1: {name: 'T1', block: 'keyframe', shadow: 't1'},
                    T2: {name: 'T2', block: 't2', shadow: 't2'}
                },
                fields: {},
                shadow: false,
                topLevel: true
            },
            keyframe: {
                id: 'keyframe',
                opcode: 'objects_keyframeTime',
                next: null,
                parent: 'within',
                inputs: {ID: {name: 'ID', block: 'id', shadow: 'id'}},
                fields: {},
                shadow: false,
                topLevel: false
            },
            id: numberShadow('id', 'keyframe', '2'),
            t1: numberShadow('t1', 'within', '0.5'),
            t2: numberShadow('t2', 'within', '3')
        };

        migrateTimeInputs(blocks, makeIds());

        const range = blocks.within.inputs.TIME_RANGE;
        const reporter = blocks[range.block];
        expect(reporter.opcode).toBe('objects_timeRangeValue');
        expect(reporter.parent).toBe('within');
        expect(reporter.inputs.T1).toEqual({name: 'T1', block: 'keyframe', shadow: 't1'});
        expect(reporter.inputs.T2).toEqual({name: 'T2', block: 't2', shadow: 't2'});
        expect(blocks.keyframe.parent).toBe(reporter.id);
        expect(blocks.t1).toEqual(expect.objectContaining({
            opcode: 'math_time',
            parent: reporter.id,
            fields: {TIME: {name: 'TIME', value: '0.5'}}
        }));
        // The obscured shadow comes back with the old literal values if the reporter is removed.
        expect(blocks[range.shadow].fields.RANGE.value).toBe('0.5~3');
    });

    test('fills in defaults when an old block is missing one side', () => {
        const blocks = {
            within: {
                id: 'within',
                opcode: 'objects_timeWithin',
                next: null,
                parent: null,
                inputs: {T1: {name: 'T1', block: 't1', shadow: 't1'}},
                fields: {},
                shadow: false,
                topLevel: true
            },
            t1: numberShadow('t1', 'within', '2')
        };
        migrateTimeInputs(blocks, makeIds());
        expect(blocks[blocks.within.inputs.TIME_RANGE.shadow].fields.RANGE.value).toBe('2~1');
    });

    test('converts single time inputs and leaves the legacy TIME sound block alone', () => {
        const blocks = {
            freeze: {
                id: 'freeze',
                opcode: 'objects_timeFreeze',
                next: null,
                parent: null,
                inputs: {TIME: {name: 'TIME', block: 'time', shadow: 'time'}},
                fields: {},
                shadow: false,
                topLevel: true
            },
            time: numberShadow('time', 'freeze', '1.25'),
            sound: {
                id: 'sound',
                opcode: 'sound_playattime',
                next: null,
                parent: null,
                inputs: {TIME: {name: 'TIME', block: 'offset', shadow: 'offset'}},
                fields: {},
                shadow: false,
                topLevel: true
            },
            offset: numberShadow('offset', 'sound', '3')
        };

        migrateTimeInputs(blocks, makeIds());

        expect(blocks.time).toEqual(expect.objectContaining({
            opcode: 'math_time',
            fields: {TIME: {name: 'TIME', value: '1.25'}}
        }));
        expect(blocks.sound.inputs).toEqual({TIME: {name: 'TIME', block: 'offset', shadow: 'offset'}});
        expect(blocks.offset.opcode).toBe('math_number');
    });
});

const legacyProject = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
            check: {
                opcode: 'control_if',
                next: null,
                parent: null,
                inputs: {CONDITION: [2, 'within']},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 0,
                y: 0
            },
            within: {
                opcode: 'objects_timeWithin',
                next: null,
                parent: 'check',
                inputs: {
                    T1: [1, [4, '1.5']],
                    T2: [1, [4, '10']]
                },
                fields: {},
                shadow: false,
                topLevel: false
            },
            sound: {
                opcode: 'sound_playattime',
                next: null,
                parent: null,
                inputs: {
                    SOUND_MENU: [1, 'menu'],
                    T1: [1, [4, '0']],
                    T2: [1, [4, 'Infinity']],
                    SPEED: [1, [4, '1']],
                    VOLUME: [1, [4, '100']]
                },
                fields: {},
                shadow: false,
                topLevel: true,
                x: 0,
                y: 200
            },
            menu: {
                opcode: 'sound_sounds_menu',
                next: null,
                parent: 'sound',
                inputs: {},
                fields: {SOUND_MENU: ['beat', null]},
                shadow: true,
                topLevel: false
            }
        },
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
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

const loadLegacyProject = async () => {
    const vm = new VM();
    installObjectBlocks(vm);
    await vm.loadProject(JSON.stringify(legacyProject()));
    return vm;
};

describe('loading shade files saved with T1/T2 inputs', () => {
    test('converts the time arguments to time range inputs and saves the new format', async () => {
        const vm = await loadLegacyProject();
        const blocks = vm.runtime.targets[0].blocks;

        const within = blocks.getBlock('within');
        expect(Object.keys(within.inputs)).toEqual(['TIME_RANGE']);
        expect(blocks.getBlock(within.inputs.TIME_RANGE.shadow)).toEqual(expect.objectContaining({
            opcode: 'math_time_range',
            fields: {RANGE: {name: 'RANGE', value: '1.5~10'}}
        }));

        const sound = blocks.getBlock('sound');
        expect(Object.keys(sound.inputs).sort()).toEqual(['SOUND_MENU', 'SPEED', 'TIME_RANGE', 'VOLUME']);
        expect(blocks.getBlock(sound.inputs.TIME_RANGE.shadow).fields.RANGE.value).toBe('0~Infinity');

        const saved = JSON.parse(vm.toJSON());
        const savedBlocks = Object.values(saved.targets[0].blocks);
        expect(savedBlocks.some(block => block.inputs && (block.inputs.T1 || block.inputs.T2))).toBe(false);
        expect(savedBlocks.find(block => block.opcode === 'math_time_range')).toEqual(expect.objectContaining({
            fields: {RANGE: ['1.5~10']},
            shadow: true
        }));

        // Reloading the saved project keeps the value unchanged.
        const reloaded = new VM();
        installObjectBlocks(reloaded);
        await reloaded.loadProject(JSON.stringify(saved));
        const reloadedWithin = Object.values(reloaded.runtime.targets[0].blocks._blocks)
            .find(block => block.opcode === 'objects_timeWithin');
        const reloadedShadow = reloaded.runtime.targets[0].blocks.getBlock(reloadedWithin.inputs.TIME_RANGE.shadow);
        expect(reloadedShadow.fields.RANGE.value).toBe('1.5~10');
    });

    test.each([
        ['compiled', true],
        ['interpreted', false]
    ])('passes the migrated range to the block when %s', async (name, compilerEnabled) => {
        const vm = await loadLegacyProject();
        vm.setCompilerOptions({enabled: compilerEnabled});
        const runtime = vm.runtime;
        const stage = runtime.targets[0];
        const timeWithin = jest.fn(() => false);
        runtime._primitives.objects_timeWithin = timeWithin;
        runtime.currentStepTime = 1000 / 30;

        const thread = runtime._pushThread('check', stage);
        runtime.sequencer.stepThreads();

        expect(thread.isCompiled).toBe(compilerEnabled);
        expect(timeWithin).toHaveBeenCalledTimes(1);
        expect(timeWithin.mock.calls[0][0]).toEqual(expect.objectContaining({TIME_RANGE: '1.5~10'}));
    });
});

describe('migrating old easing blocks (T0/T1)', () => {
    const easingBlock = inputs => ({
        id: 'easing',
        opcode: 'operator_easing',
        next: null,
        parent: null,
        inputs,
        fields: {TYPE: {name: 'TYPE', value: 'PowerIn'}, TYPE2: {name: 'TYPE2', value: 'Elastic'}},
        shadow: false,
        topLevel: true
    });

    test('merges T0/T1 into a time range and keeps the other inputs', () => {
        const blocks = {
            easing: easingBlock({
                V0: {name: 'V0', block: 'v0', shadow: 'v0'},
                T0: {name: 'T0', block: 't0', shadow: 't0'},
                T1: {name: 'T1', block: 't1', shadow: 't1'}
            }),
            v0: numberShadow('v0', 'easing', '0'),
            t0: numberShadow('t0', 'easing', '0.5'),
            t1: numberShadow('t1', 'easing', '2')
        };
        migrateTimeInputs(blocks, makeIds());
        expect(Object.keys(blocks.easing.inputs).sort()).toEqual(['TIME_RANGE', 'V0']);
        expect(blocks[blocks.easing.inputs.TIME_RANGE.shadow].fields.RANGE.value).toBe('0.5~2');
        expect(blocks.t0).toBeUndefined();
        expect(blocks.t1).toBeUndefined();
    });

    test('keeps a reporter plugged into T0 inside a range reporter', () => {
        const blocks = {
            easing: easingBlock({
                T0: {name: 'T0', block: 'timer', shadow: 't0'},
                T1: {name: 'T1', block: 't1', shadow: 't1'}
            }),
            timer: {
                id: 'timer', opcode: 'sensing_timer', next: null, parent: 'easing',
                inputs: {}, fields: {}, shadow: false, topLevel: false
            },
            t0: numberShadow('t0', 'easing', '0'),
            t1: numberShadow('t1', 'easing', '1')
        };
        migrateTimeInputs(blocks, makeIds());
        const reporter = blocks[blocks.easing.inputs.TIME_RANGE.block];
        expect(reporter.opcode).toBe('objects_timeRangeValue');
        expect(reporter.inputs.T1.block).toBe('timer');
        expect(reporter.inputs.T2.shadow).toBe('t1');
        expect(blocks.timer.parent).toBe(reporter.id);
    });
});

describe('loading shade files with the original easing block', () => {
    // set [out] to (easing PowerIn 0 → 100, time 1 ~ 3, power 2) with the timer at 2 s: 25.
    const easingProject = () => ({
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {out: ['out', 0]},
            lists: {},
            broadcasts: {},
            blocks: {
                set: {
                    opcode: 'data_setvariableto',
                    next: null,
                    parent: null,
                    inputs: {VALUE: [3, 'easing', [10, '']]},
                    fields: {VARIABLE: ['out', 'out']},
                    shadow: false,
                    topLevel: true,
                    x: 0,
                    y: 0
                },
                easing: {
                    opcode: 'operator_easing',
                    next: null,
                    parent: 'set',
                    inputs: {
                        V0: [1, [4, '0']],
                        V1: [1, [4, '100']],
                        T0: [1, [4, '1']],
                        T1: [1, [4, '3']],
                        POWER: [1, [4, '2']],
                        SPEED: [1, [4, '0']],
                        STRENGTH: [1, [4, '0']]
                    },
                    fields: {TYPE: ['PowerIn', null], TYPE2: ['Elastic', null]},
                    shadow: false,
                    topLevel: false
                }
            },
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null
        }],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    });

    test.each([
        ['compiled', true],
        ['interpreted', false]
    ])('evaluates to the same value as before when %s', async (name, compilerEnabled) => {
        const vm = new VM();
        installObjectBlocks(vm);
        installMovieEasing(vm);
        await vm.loadProject(JSON.stringify(easingProject()));
        vm.setCompilerOptions({enabled: compilerEnabled});
        const runtime = vm.runtime;
        const stage = runtime.targets[0];

        const easing = Object.values(stage.blocks._blocks).find(block => block.opcode === 'operator_easing');
        expect(Object.keys(easing.inputs)).not.toContain('T0');
        expect(stage.blocks.getBlock(easing.inputs.TIME_RANGE.shadow).fields.RANGE.value).toBe('1~3');

        runtime.ioDevices.clock.projectTimer = () => 2;
        runtime.currentStepTime = 1000 / 30;
        const thread = runtime._pushThread('set', stage);
        runtime.sequencer.stepThreads();

        expect(thread.isCompiled).toBe(compilerEnabled);
        expect(Number(stage.variables.out.value)).toBeCloseTo(25);
        expect(Number(stage.variables.out.value)).toBeCloseTo(
            runtime._primitives.operator_easing({
                TYPE: 'PowerIn', TYPE2: 'Elastic', V0: 0, V1: 100, T0: 1, T1: 3, POWER: 2, SPEED: 0, STRENGTH: 0
            }, {ioQuery: () => 2})
        );
    });
});
