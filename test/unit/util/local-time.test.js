jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {
    LOCAL_TIME_MODES,
    createLocalTimeScope,
    evaluateTimeScopes,
    getEvaluationTime,
    posterizeTime
} from '../../../scratch-vm/src/lib/object-animation';
import {registerObjectBlocks} from '../../../scratch-vm/src/lib/object-blocks';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const at = (mode, a, b, time) => evaluateTimeScopes(time, [createLocalTimeScope(mode, a, b)]);

describe('local time scopes', () => {
    test('map the time for each mode', () => {
        expect(LOCAL_TIME_MODES).toEqual(['offset', 'speed', 'posterize', 'freeze', 'loop', 'reverse', 'remap']);
        expect(at('offset', 0.5, 0, 2)).toBe(1.5);
        expect(at('speed', 2, 0, 1.5)).toBe(3);
        expect(at('speed', 2, 1, 1.5)).toBe(2);
        expect(at('posterize', 12, 0, 0.1)).toBe(1 / 12);
        expect(at('posterize', 12, 0, 1 / 12)).toBe(1 / 12);
        expect(at('posterize', 0, 0, 0.1)).toBe(0.1);
        expect(at('posterize', -4, 0, 0.1)).toBe(0.1);
        expect(at('freeze', 3, 0, 7)).toBe(3);
        expect(at('loop', 2, 0, 5.5)).toBe(1.5);
        expect(at('loop', 2, 1, 5.5)).toBe(1.5);
        expect(at('loop', 2, 0.5, 5.5)).toBe(1.5);
        expect(at('loop', 2, 1, 4)).toBe(2);
        expect(at('reverse', 4, 0, 1)).toBe(3);
        expect(at('remap', '0:0; 2:1', 0, 1)).toBe(0.5);
        expect(at('unknown', 0.25, 0, 1)).toBe(0.75);
    });

    test('posterize uses the same quantization as the posterize time reporter', () => {
        for (const time of [0, 0.04, 1 / 12, 0.5, 0.999, 1, 2.3333333333]) {
            expect(at('posterize', 12, 0, time)).toBe(posterizeTime(time, 12));
        }
    });

    test('are not legacy scopes', () => {
        for (const mode of LOCAL_TIME_MODES) expect(createLocalTimeScope(mode, 1, 0).legacy).toBe(false);
    });
});

// Records, per draw, the time three readers see: easing (project timer), Objects (timeline time reporter) and the
// PenFX reader (what u_time uses), through a probe block contributed to the Objects category.
const probeProject = scopes => {
    let body = [
        {opcode: 'objects_probe'},
        {
            opcode: 'objects_draw',
            fields: {SOURCE: 'costume'},
            inputs: {
                PX: {
                    opcode: 'operator_easing',
                    fields: {TYPE: 'PowerIn'},
                    inputs: {V0: 0, V1: 1, T0: 0, T1: 1, POWER: 1, SPEED: 0}
                },
                PY: {opcode: 'objects_timelineTime'},
                PZ: 480
            }
        }
    ];
    for (let index = scopes.length - 1; index >= 0; index--) {
        const [mode, a, b] = scopes[index];
        body = [{opcode: 'objects_localTime', fields: {MODE: mode}, inputs: {A: a, B: b}, substack: body}];
    }
    return buildProject({scripts: [{hat: 'event_renderframe', body}]});
};

const loadProbe = async (scopes, compiler) => {
    const harness = await createHarness(probeProject(scopes), {compiler, duration: 1});
    const probes = [];
    registerObjectBlocks(harness.vm, {
        id: 'probe',
        blocks: [{opcode: 'probe', blockType: 'command', text: 'probe'}],
        methods: {
            probe: (args, util) => {
                probes.push(getEvaluationTime(harness.runtime, util, {reader: 'timeline'}));
            }
        }
    });
    harness.runtime.getTargetForStage();
    harness.vm.runtime.targets.forEach(target => target.blocks.resetCache());
    return {harness, probes};
};

const drawnAt = (harness, frames, frame) => {
    const configuration = JSON.parse(frames.get(frame)).children[0].configuration;
    return {easing: configuration.position.x, objects: configuration.position.y, draw: configuration.evaluationTime};
};

describe.each([true, false])('the local time block (compiler %s)', compiler => {
    let harness;
    afterEach(() => harness && harness.dispose());

    test('posterize 12 fps quantizes easing, the Objects time, draws and the PenFX time', async () => {
        const loaded = await loadProbe([['posterize', 12, 0]], compiler);
        harness = loaded.harness;
        const frames = await harness.exportRange({start: 0, end: 1});
        for (let frame = 0; frame <= 30; frame++) {
            const expected = posterizeTime(frame / 30, 12);
            const drawn = drawnAt(harness, frames, frame);
            expect(drawn.easing).toBeCloseTo(expected, 12);
            expect(drawn.objects).toBeCloseTo(expected, 12);
            expect(drawn.draw).toBeCloseTo(expected, 12);
            expect(loaded.probes[frame]).toBeCloseTo(expected, 12);
        }
        // 30 fps frames at 12 fps steps: frames 0, 1 and 2 all read 0.
        expect(new Set(loaded.probes.slice(0, 3))).toEqual(new Set([0]));
    });

    test('applies nested local times from the outside in', async () => {
        const outerSpeed = await loadProbe([['speed', 2, 0], ['offset', 0.5, 0]], compiler);
        harness = outerSpeed.harness;
        const speedFirst = await harness.exportRange({start: 0, end: 1});
        harness.dispose();
        const outerOffset = await loadProbe([['offset', 0.5, 0], ['speed', 2, 0]], compiler);
        harness = outerOffset.harness;
        const offsetFirst = await harness.exportRange({start: 0, end: 1});
        // At t = 0.5: (0.5 * 2) - 0.5 = 0.5 with speed outside; (0.5 - 0.5) * 2 = 0 with offset outside.
        expect(drawnAt(harness, speedFirst, 15).objects).toBeCloseTo(0.5, 12);
        expect(drawnAt(harness, offsetFirst, 15).objects).toBeCloseTo(0, 12);
        expect(outerSpeed.probes[15]).toBeCloseTo(0.5, 12);
        expect(outerOffset.probes[15]).toBeCloseTo(0, 12);
    });

    test('finishes the branch and the next block in one VM step and returns undefined', async () => {
        const loaded = await loadProbe([['offset', 0.25, 0]], compiler);
        harness = loaded.harness;
        const objectBlocks = harness.runtime.objectBlocks;
        expect(objectBlocks.localTime({MODE: 'offset', A: 1, B: 0}, {thread: null})).toBeUndefined();
        await harness.seekTo(15);
        // The probe and the draw ran within the seek's single render-frame evaluation.
        expect(loaded.probes).toEqual([0.25]);
        expect(JSON.parse(harness.frames.committed).children[0].configuration.position.y).toBeCloseTo(0.25, 12);
    });
});
