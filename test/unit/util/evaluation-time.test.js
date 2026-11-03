jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import VM from 'scratch-vm';

import installMovieEasing from '../../../scratch-vm/src/lib/movie-easing';
import {getEvaluationTime} from '../../../scratch-vm/src/lib/object-animation';
import PenFXCustomShaderManager, {
    CUSTOM_SHADER_FORMAT,
    CUSTOM_SHADER_VERSION,
    opcodeFor
} from '../../../src/lib/pen-fx/custom-shaders';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const LEGACY_SCOPES = [{type: 'scale', scale: 0.5, legacy: true}, {type: 'offset', offset: 1, legacy: true}];
const offsetScope = offset => ({type: 'offset', offset, legacy: false});

const easingArgs = {TYPE: 'PowerIn', V0: 0, V1: 100, T0: 0, T1: 4, POWER: 1, SPEED: 0};

const makeEasingVM = () => {
    const vm = new VM();
    installMovieEasing(vm);
    return vm;
};

const timerUtil = (thread, timer = 2) => ({ioQuery: jest.fn(() => timer), thread});

describe('evaluation time', () => {
    test('easing reads the project timer outside time scopes and inside legacy time scopes only', () => {
        const vm = makeEasingVM();
        const easing = vm.runtime._primitives.operator_easing;
        expect(easing(easingArgs, timerUtil(null))).toBe(50);
        expect(easing(easingArgs, timerUtil({}))).toBe(50);
        expect(easing(easingArgs, timerUtil({objectTimeScopes: LEGACY_SCOPES, objectTimeOffset: 3}))).toBe(50);
    });

    test('easing follows the non-legacy time scopes of its thread', () => {
        const vm = makeEasingVM();
        const easing = vm.runtime._primitives.operator_easing;
        expect(easing(easingArgs, timerUtil({objectTimeScopes: [offsetScope(1)]}))).toBe(25);
        // Legacy scopes in the same context still do not apply to easing.
        expect(easing(easingArgs, timerUtil({objectTimeScopes: LEGACY_SCOPES.concat([offsetScope(-1)])}))).toBe(75);
    });

    test('Objects readers apply every scope of the thread, legacy ones included', () => {
        const runtime = {movieAssetManager: {timeline: {currentTime: 4}}};
        expect(getEvaluationTime(runtime, {thread: {}})).toBe(4);
        expect(getEvaluationTime(runtime, {thread: {objectTimeScopes: LEGACY_SCOPES}})).toBe(1);
        expect(getEvaluationTime(runtime, {thread: {objectTimeScopes: [offsetScope(1)]}})).toBe(3);
        expect(getEvaluationTime(runtime, {thread: {objectTimeScopes: [offsetScope(1)]}}, {reader: 'timeline'}))
            .toBe(3);
        expect(getEvaluationTime(runtime, {thread: {objectTimeScopes: LEGACY_SCOPES}}, {reader: 'timeline'}))
            .toBe(4);
    });

    test('the timeline reader without a util uses the running thread', () => {
        const runtime = {
            movieAssetManager: {timeline: {currentTime: 4}},
            sequencer: {activeThread: {objectTimeScopes: [offsetScope(0.5)]}}
        };
        expect(getEvaluationTime(runtime, null, {reader: 'timeline'})).toBe(3.5);
    });
});

describe('PenFX shader time', () => {
    const fragmentSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform float u_time;
uniform int u_frame;
uniform float u_amount;
void main() {
    gl_FragColor = texture2D(u_image, v_uv) * u_amount * u_time * float(u_frame);
}
`;
    const manifest = {
        format: CUSTOM_SHADER_FORMAT,
        version: CUSTOM_SHADER_VERSION,
        id: 'time-pack',
        name: 'Time Pack',
        blocks: [{
            id: 'timed',
            name: 'timed',
            text: 'timed [AMOUNT]',
            file: 'timed.glsl',
            inputs: [{id: 'AMOUNT', label: 'amount', type: 'number', defaultValue: 1, uniform: 'u_amount'}]
        }]
    };

    const makeShaderBlock = async () => {
        const customShader = jest.fn();
        const vm = {runtime: {movieAssetManager: {timeline: {currentTime: 1.5, framerate: 24}}}};
        const penFX = {blendMode: 'normal', engine: null, _safe: callback => callback({customShader})};
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await manager.restorePackages([descriptor]);
        const block = penFX[opcodeFor('time-pack', 'timed')];
        const run = util => {
            customShader.mockClear();
            expect(block({AMOUNT: 1}, util)).toBeUndefined();
            const uniforms = customShader.mock.calls[0][1];
            return [uniforms.u_time, uniforms.u_frame];
        };
        return run;
    };

    test('u_time and u_frame keep the timeline time outside scopes and inside legacy scopes', async () => {
        const run = await makeShaderBlock();
        expect(run({})).toEqual([1.5, 36]);
        expect(run({thread: {objectTimeScopes: LEGACY_SCOPES, objectTimeOffset: 2}})).toEqual([1.5, 36]);
    });

    test('u_time and u_frame follow the non-legacy scopes of the block thread', async () => {
        const run = await makeShaderBlock();
        expect(run({thread: {objectTimeScopes: [offsetScope(0.5)]}})).toEqual([1, 24]);
        expect(run({thread: {objectTimeScopes: [offsetScope(-0.5), offsetScope(1.5)]}})).toEqual([0.5, 12]);
    });
});

describe('legacy time blocks in a real VM', () => {
    let harness;
    afterEach(() => harness && harness.dispose());

    // Inside the hidden `time speed` block, the Objects time is scaled but easing keeps the project timer.
    const project = () => buildProject({
        scripts: [{
            hat: 'event_renderframe',
            body: [{
                opcode: 'objects_timeScale',
                inputs: {SCALE: 0.5},
                substack: [{
                    opcode: 'objects_draw',
                    fields: {SOURCE: 'costume'},
                    inputs: {
                        PX: {
                            opcode: 'operator_easing',
                            fields: {TYPE: 'PowerIn'},
                            inputs: {V0: 0, V1: 100, T0: 0, T1: 1, POWER: 1, SPEED: 0}
                        },
                        PY: {opcode: 'objects_timelineTime'},
                        PZ: 480
                    }
                }]
            }]
        }]
    });

    test.each([true, false])('keeps easing on the project timer (compiler %s)', async compiler => {
        harness = await createHarness(project(), {compiler, duration: 1});
        const frames = await harness.exportRange({start: 0, end: 1});
        const position = JSON.parse(frames.get(15)).children[0].configuration.position;
        expect(position.x).toBeCloseTo(50, 9);
        expect(position.y).toBeCloseTo(0.25, 9);
        harness.manager.seekTimeline(0.5);
        await harness.settle();
        const seeked = JSON.parse(harness.frames.committed).children[0].configuration.position;
        expect(seeked).toEqual(position);
    });
});
