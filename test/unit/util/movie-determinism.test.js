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

// The stateful project's state as a simulation: x grows by 150 per second (5 per 30 fps frame), at 120 Hz.
const simulationProject = () => buildProject({
    scripts: [{
        hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'counter', START: 0, RATE: 120}},
        body: [{opcode: 'simulation_setState', inputs: {KEY: 'x', VALUE: 0}}]
    }, {
        hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'counter'}},
        body: [{opcode: 'simulation_changeState', inputs: {KEY: 'x', VALUE: 1.25}}]
    }, {
        hat: 'event_renderframe',
        body: [draw({PX: {opcode: 'simulation_stateAt', inputs: {NAME: 'counter', KEY: 'x', TIME: ''}}})]
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

        // Preview playback evaluates whole frames, so stopping playback on a frame shows what export renders.
        test('a stateless project draws frame 13 the same way when playback stops there', async () => {
            harness = await createHarness(statelessProject(), {compiler, duration: 1});
            expectAllEqual(await harness.reachFrame(13));
        });

        test('different frames of a stateless project differ', async () => {
            harness = await createHarness(statelessProject(), {compiler, duration: 1});
            const frames = await harness.exportRange({start: 0, end: 1});
            expect(frames.size).toBe(31);
            expect(new Set(frames.values()).size).toBe(31);
        });

        // The same state, integrated by a simulation: every way of reaching a frame draws it the same.
        test.each([0, 13, 29])('a project whose state is a simulation draws frame %i the same way', async frame => {
            harness = await createHarness(simulationProject(), {compiler, duration: 1});
            const ways = await harness.reachFrame(frame);
            expectAllEqual(ways);
            const x = JSON.parse(ways.seek).children[0].configuration.position.x;
            expect(x).toBeCloseTo(5 * frame, 6);
        });

        // A render-frame script that integrates a variable stays path-dependent (it depends on which frames were
        // evaluated before): such state belongs in a simulation, as above.
        test.failing('a render-frame script that integrates a variable draws frame 13 the same way', async () => {
            harness = await createHarness(statefulProject(), {compiler, duration: 1});
            expectAllEqual(await harness.reachFrame(13));
        });
    });
});

// The frame index each render-frame evaluation drew: the project draws at x = timeline time * fps.
const frameIndexProject = () => buildProject({
    variables: {initialized: 0},
    scripts: [{
        hat: 'event_initialize',
        body: [{opcode: 'data_changevariableby', fields: {VARIABLE: 'initialized'}, inputs: {VALUE: 1}}]
    }, {
        hat: 'event_renderframe',
        body: [draw({
            PX: {opcode: 'operator_multiply', inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: 30}},
            PY: {
                opcode: 'operator_multiply',
                inputs: {
                    NUM1: {
                        opcode: 'operator_easing',
                        fields: {TYPE: 'PowerIn'},
                        inputs: {V0: 0, V1: 1, T0: 0, T1: 1, POWER: 1, SPEED: 0}
                    },
                    NUM2: 30
                }
            }
        })]
    }]
});

const drawnFrames = harness => harness.frames.executed.map(graph => {
    const draws = JSON.parse(graph).children;
    return {x: draws[0].configuration.position.x, y: draws[0].configuration.position.y};
});

const initializeCount = harness => Number(harness.runtime.getTargetForStage().lookupVariableByNameAndType(
    'initialized', ''
).value);

describe('preview playback timing', () => {
    let harness;
    afterEach(() => harness && harness.dispose());

    test.each([
        ['a 120 Hz clock', 1 / 120],
        ['an irregular clock', 0.013],
        ['a clock that falls behind', 0.1]
    ])('evaluates whole frames at k / fps with %s', async (name, stepSeconds) => {
        harness = await createHarness(frameIndexProject(), {duration: 1});
        await harness.seekTo(0);
        harness.frames.executed.length = 0;
        await harness.playUntil(30, {stepSeconds, seek: false});
        const drawn = drawnFrames(harness);
        expect(drawn.length).toBeGreaterThan(0);
        for (const {x, y} of drawn) {
            // Both the timeline time and easing (which reads the project timer) see exactly k / fps.
            expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
            expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-9);
        }
        const indexes = drawn.map(({x}) => Math.round(x));
        expect(new Set(indexes).size).toBe(indexes.length);
        expect(indexes).toEqual(indexes.slice().sort((a, b) => a - b));
        expect(indexes[indexes.length - 1]).toBe(30);
        if (stepSeconds > 1 / 30) expect(indexes.length).toBeLessThan(31);
        else expect(indexes).toEqual(Array.from({length: 31}, (value, index) => index));
    });

    test('does not evaluate a frame again while the clock stays within it', async () => {
        harness = await createHarness(frameIndexProject(), {duration: 1});
        await harness.seekTo(0);
        await harness.startPlayback();
        const startHats = jest.spyOn(harness.runtime, 'startHats');
        const renderFrames = () => startHats.mock.calls.filter(([opcode]) => opcode === 'event_renderframe').length;
        // Playback evaluated frame 0 when it started. Eight more ticks within the first 1/30 s are still frame 0.
        expect(harness.manager.timeline.previewFrameIndex).toBe(0);
        for (let tick = 0; tick < 8; tick++) {
            harness.setClock(tick / 240);
            harness.step();
        }
        expect(renderFrames()).toBe(0);
        harness.setClock(1 / 30);
        harness.step();
        harness.step();
        expect(renderFrames()).toBe(1);
        expect(harness.manager.timeline.currentTime).toBe(1 / 30);
    });

    test('runs initialize before the first preview frame after opening and at every play, not on seeks', async () => {
        harness = await createHarness(frameIndexProject(), {duration: 1});
        expect(initializeCount(harness)).toBe(0);
        await harness.seekTo(10);
        expect(initializeCount(harness)).toBe(1);
        await harness.seekTo(20);
        await harness.seekTo(3);
        expect(initializeCount(harness)).toBe(1);
        await harness.playUntil(12, {from: 5});
        expect(initializeCount(harness)).toBe(2);
        await harness.playUntil(20, {from: 15});
        expect(initializeCount(harness)).toBe(3);
        await harness.seekTo(4);
        expect(initializeCount(harness)).toBe(3);
    });

    test('holds the playback clock until initialize has finished', async () => {
        const project = frameIndexProject();
        // initialize waits one tick, so the clock must not start running before it ends.
        const blocks = project.targets[1].blocks;
        const initialize = Object.keys(blocks).find(id => blocks[id].opcode === 'event_initialize');
        blocks.wait = {
            opcode: 'control_wait', next: null, parent: initialize, inputs: {DURATION: [1, [5, '0']]},
            fields: {}, shadow: false, topLevel: false
        };
        blocks[blocks[initialize].next].parent = 'wait';
        blocks.wait.next = blocks[initialize].next;
        blocks[initialize].next = 'wait';
        harness = await createHarness(project, {duration: 1});
        await harness.seekTo(6);
        harness.manager.playTimeline();
        expect(harness.manager.timeline.initializing).toBe(true);
        expect(harness.runtime.ioDevices.clock._paused).toBe(true);
        await harness.settle();
        expect(harness.runtime.ioDevices.clock._paused).toBe(false);
        expect(harness.manager.timeline.currentTime).toBe(6 / 30);
    });
});
