jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import {buildProject, createHarness} from '../../helpers/movie-determinism';

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const times = (a, b) => reporter('operator_multiply', {NUM1: a, NUM2: b});
const state = key => reporter('simulation_state', {KEY: key});

// A ball under gravity at 120 Hz; the render frame draws y (optionally inside a local time block).
const ballProject = ({localTime = null, rate = 120} = {}) => {
    const drawBall = {
        opcode: 'objects_draw',
        fields: {SOURCE: 'costume'},
        inputs: {PX: 0, PY: reporter('simulation_stateAt', {NAME: 'ball', KEY: 'y', TIME: ''}), PZ: 480}
    };
    const body = localTime ? [{
        opcode: 'objects_localTime',
        fields: {MODE: localTime[0]},
        inputs: {A: localTime[1], B: 0},
        substack: [drawBall]
    }] : [drawBall];
    return buildProject({
        scripts: [{
            hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'ball', START: 0, RATE: rate}},
            body: [
                {opcode: 'simulation_setState', inputs: {KEY: 'y', VALUE: 100}},
                {opcode: 'simulation_setState', inputs: {KEY: 'vy', VALUE: 0}}
            ]
        }, {
            hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'ball'}},
            body: [
                {opcode: 'simulation_changeState', inputs: {KEY: 'vy', VALUE: times(-9.8, reporter('simulation_dt'))}},
                {opcode: 'simulation_changeState', inputs: {KEY: 'y', VALUE: times(state('vy'), reporter('simulation_dt'))}}
            ]
        }, {hat: 'event_renderframe', body}]
    });
};

const ballY = (time, rate = 120) => {
    let y = 100;
    let vy = 0;
    const position = time * rate;
    const steps = Math.floor(position + 1e-9);
    const states = [100];
    for (let step = 0; step <= steps; step++) {
        vy += -9.8 / rate;
        y += vy / rate;
        states.push(y);
    }
    const alpha = position - steps;
    return alpha > 1e-9 ? states[steps] + ((states[steps + 1] - states[steps]) * alpha) : states[steps];
};

const drawnY = signature => JSON.parse(signature).children[0].configuration.position.y;

describe.each([true, false])('simulations on the timeline (compiler %s)', compiler => {
    let harness;
    afterEach(() => harness && harness.dispose());

    test('the same time reads the same state at 30 and 60 fps', async () => {
        harness = await createHarness(ballProject(), {compiler, duration: 2, framerate: 30});
        const at30 = await harness.exportRange({start: 0, end: 2});
        harness.dispose();
        harness = await createHarness(ballProject(), {compiler, duration: 2, framerate: 60});
        const at60 = await harness.exportRange({start: 0, end: 2});
        for (let frame = 0; frame <= 60; frame++) {
            expect(drawnY(at60.get(frame * 2))).toBe(drawnY(at30.get(frame)));
            expect(drawnY(at30.get(frame))).toBeCloseTo(ballY(frame / 30), 9);
        }
    });

    test('an export from mid-range computes the simulation from its start first', async () => {
        harness = await createHarness(ballProject(), {compiler, duration: 4});
        const frames = await harness.exportRange({start: 3, end: 3.5});
        expect(frames.size).toBe(16);
        expect(drawnY(frames.get(90))).toBeCloseTo(ballY(3), 9);
    });

    test.each([
        ['reverse', 4, time => 4 - time],
        ['posterize', 12, time => Math.floor((time * 12) + 1e-9) / 12],
        ['offset', 3, time => time - 3]
    ])('inside local time %s the simulation reads S at the local time', async (mode, amount, map) => {
        harness = await createHarness(ballProject({localTime: [mode, amount]}), {compiler, duration: 4});
        const commits = [];
        const commitFrame = harness.manager.penFX.commitFrame;
        harness.manager.penFX.commitFrame = () => {
            const result = commitFrame();
            commits.push(harness.frames.committed);
            return result;
        };
        const frames = await harness.exportRange({start: 0, end: 4});
        for (let frame = 0; frame <= 120; frame += 7) {
            expect(drawnY(frames.get(frame))).toBeCloseTo(ballY(Math.max(0, map(frame / 30))), 9);
        }
        // Frames that read a time that was not computed were discarded, never committed with a fallback value.
        expect(commits).toHaveLength(121);
        commits.forEach((signature, frame) => {
            expect(drawnY(signature)).toBeCloseTo(ballY(Math.max(0, map(frame / 30))), 9);
        });
        // Seeking back to a frame whose local time is far from the computed steps works the same way.
        expect(drawnY(await harness.seekTo(110))).toBeCloseTo(ballY(Math.max(0, map(110 / 30))), 9);
    });

    test('a frame that read uncomputed times is evaluated again once, then committed', async () => {
        harness = await createHarness(ballProject({localTime: ['reverse', 4]}), {compiler, duration: 4});
        const redo = jest.spyOn(harness.manager, 'redoFrameForSimulation');
        const startHats = jest.spyOn(harness.runtime, 'startHats');
        await harness.seekTo(117);
        // The frame computes the simulation to 3.9 s (keeping every step since 1.9 s); 117 / 30 s reverses to
        // 0.1 s, which was not kept: one discarded evaluation, then the frame commits.
        const evaluations = startHats.mock.calls.filter(([opcode]) => opcode === 'event_renderframe').length;
        expect(evaluations).toBe(2);
        expect(redo.mock.results.map(result => result.value)).toEqual([true, false]);
        expect(drawnY(harness.frames.committed)).toBeCloseTo(ballY(4 - (117 / 30)), 9);
    });

    test('a frame waits, without advancing time, until its simulations are computed', async () => {
        harness = await createHarness(ballProject({rate: 1000}), {compiler, duration: 5});
        const simulationRuntime = harness.runtime.simulationRuntime;
        let clock = 0;
        simulationRuntime.now = () => clock;
        const cache = () => simulationRuntime.getSimulation('ball');
        harness.manager.syncSimulationDefinitions();
        const step = cache().stepState;
        cache().stepState = (...args) => {
            clock += 0.01;
            step(...args);
        };
        const commits = [];
        const commitFrame = harness.manager.penFX.commitFrame;
        harness.manager.penFX.commitFrame = () => {
            commits.push(harness.manager.timeline.currentTime);
            return commitFrame();
        };
        harness.manager.seekTimeline(4);
        let ticks = 0;
        while (harness.manager.timeline.pendingFrame || harness.manager.timeline.waitingForSimulation) {
            harness.step();
            ticks++;
            if (harness.manager.timeline.waitingForSimulation) expect(harness.manager.timeline.currentTime).toBe(4);
        }
        // 8 ms per preview tick at 0.01 ms per step: 4000 steps take several ticks.
        expect(ticks).toBeGreaterThan(3);
        expect(commits).toEqual([4]);
        expect(drawnY(harness.frames.committed)).toBeCloseTo(ballY(4, 1000), 6);
    });

    test('editing only a render-frame script keeps the computed steps', async () => {
        harness = await createHarness(ballProject(), {compiler, duration: 2});
        await harness.exportRange({start: 0, end: 2});
        const simulationRuntime = harness.runtime.simulationRuntime;
        const cache = simulationRuntime.getSimulation('ball');
        const computed = cache.stepsComputed;
        const keyBefore = harness.manager.getRenderingFrameCacheKey(3);
        const blocks = harness.runtime.targets[1].blocks;
        const draw = Object.values(blocks._blocks).find(block => block.opcode === 'objects_draw');
        blocks.getBlock(draw.inputs.PZ.shadow).fields.NUM.value = '400';
        harness.runtime.emitProjectChanged();
        expect(simulationRuntime.getSimulation('ball')).toBe(cache);
        await harness.exportRange({start: 0, end: 2});
        expect(cache.stepsComputed).toBe(computed);
        expect(harness.manager.getRenderingFrameCacheKey(3).split(':')[4])
            .toBe(keyBefore.split(':')[4]);

        // Editing a step script is a different simulation.
        const change = Object.values(blocks._blocks).find(block => block.opcode === 'simulation_changeState');
        const factor = blocks.getBlock(blocks.getBlock(change.inputs.VALUE.block).inputs.NUM1.shadow);
        factor.fields.NUM.value = '-5';
        harness.runtime.emitProjectChanged();
        expect(simulationRuntime.getSimulation('ball')).not.toBe(cache);
        expect(harness.manager.getRenderingFrameCacheKey(3).split(':')[4]).not.toBe(keyBefore.split(':')[4]);
    });

    test('reusing frames skips evaluation but keeps the state of later frames', async () => {
        harness = await createHarness(ballProject(), {compiler, duration: 2});
        const first = await harness.exportRange({start: 0, end: 1, reuseFrames: true});
        const startHats = jest.spyOn(harness.runtime, 'startHats');
        const second = await harness.exportRange({start: 0, end: 2, reuseFrames: true});
        expect(startHats.mock.calls.filter(([opcode]) => opcode === 'event_renderframe')).toHaveLength(30);
        for (const frame of [0, 15, 30]) expect(second.get(frame)).toBe(first.get(frame));
        expect(drawnY(second.get(45))).toBeCloseTo(ballY(1.5), 9);
    });

    test('notifies computed ranges and stops work on seeks', async () => {
        harness = await createHarness(ballProject(), {compiler, duration: 2});
        const changes = [];
        harness.manager.on('simulationCacheChanged', ranges => changes.push(ranges));
        await harness.seekTo(30);
        expect(changes.length).toBeGreaterThan(0);
        expect(harness.manager.getSimulationCacheRanges().ball[0]).toEqual({start: 0, end: 1});
        const cancel = jest.spyOn(harness.runtime.simulationRuntime, 'cancel');
        harness.manager.seekTimeline(0.5);
        harness.manager.stopTimeline();
        expect(cancel).toHaveBeenCalledTimes(2);
    });
});
