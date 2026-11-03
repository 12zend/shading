jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {buildProject, createHarness} from '../../helpers/movie-determinism';

const draw = inputs => ({
    opcode: 'objects_draw',
    fields: {SOURCE: 'costume'},
    inputs: {PX: 0, PY: 0, PZ: 480, ...inputs}
});

// Stateless: every value is a function of the timeline time.
const statelessProject = () => buildProject({
    scripts: [{
        hat: 'event_renderframe',
        body: [draw({
            PX: {
                opcode: 'operator_easing',
                fields: {TYPE: 'PowerInOut'},
                inputs: {V0: -200, V1: 200, T0: 0, T1: 1, POWER: 2, SPEED: 0}
            },
            PY: {
                opcode: 'operator_multiply',
                inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: 10}
            }
        })]
    }]
});

// Stateful: the render-frame script integrates a variable, so a frame depends on how many frames ran before it.
const statefulProject = () => buildProject({
    variables: {x: 0},
    scripts: [{
        hat: 'event_initialize',
        body: [{opcode: 'data_setvariableto', fields: {VARIABLE: 'x'}, inputs: {VALUE: 0}}]
    }, {
        hat: 'event_renderframe',
        body: [
            {opcode: 'data_changevariableby', fields: {VARIABLE: 'x'}, inputs: {VALUE: 5}},
            draw({PX: {opcode: 'data_variable', fields: {VARIABLE: 'x'}}})
        ]
    }]
});

const FRAMES = [0, 7, 13, 29];

const expectAllEqual = (ways, only = Object.keys(ways)) => {
    const reference = ways.exportFromStart;
    expect(typeof reference).toBe('string');
    expect(reference).not.toBe('background');
    for (const way of only) {
        expect({way, signature: ways[way]}).toEqual({way, signature: reference});
    }
};

const WITHOUT_PLAYBACK = ['exportFromStart', 'exportFromNear', 'seek', 'exportReusingFrames'];

describe('frame determinism', () => {
    describe.each([true, false])('compiler %s', compiler => {
        let harness;
        afterEach(() => harness && harness.dispose());

        test.each(FRAMES)('a stateless project exports and seeks frame %i the same way', async frame => {
            harness = await createHarness(statelessProject(), {compiler, duration: 1});
            expectAllEqual(await harness.reachFrame(frame), WITHOUT_PLAYBACK);
        });

        // Preview playback evaluates the wall-clock time instead of frame times (fixed in M2).
        test.failing('a stateless project draws frame 13 the same way when playback stops there', async () => {
            harness = await createHarness(statelessProject(), {compiler, duration: 1});
            expectAllEqual(await harness.reachFrame(13));
        });

        test('different frames of a stateless project differ', async () => {
            harness = await createHarness(statelessProject(), {compiler, duration: 1});
            const frames = await harness.exportRange({start: 0, end: 1});
            expect(frames.size).toBe(31);
            expect(new Set(frames.values()).size).toBe(31);
        });

        // A render-frame script that integrates state cannot be deterministic: the time evaluation model v2 moves
        // such state into simulations (M7 makes the simulation version of this test pass).
        test.failing('a render-frame script that integrates state draws frame 13 the same way', async () => {
            harness = await createHarness(statefulProject(), {compiler, duration: 1});
            expectAllEqual(await harness.reachFrame(13));
        });
    });
});
