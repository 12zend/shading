jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
    require('../../helpers/mock-rendering-frame-store'));

import fs from 'fs';
import path from 'path';

import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {PLUGINS_DIR, readPluginDirectory, requirePluginModule} from '../../helpers/official-plugins';
import {buildProject, createHarness} from '../../helpers/movie-determinism';

const hasPhysics = fs.existsSync(path.join(PLUGINS_DIR, 'physics', 'shading-plugin.json'));
const describeIfPhysics = hasPhysics ? describe : describe.skip;

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const body = (name, values) => ({
    opcode: 'simulation_physicsAddBody',
    inputs: {
        NAME: name, SHAPE: 'box', PX: 0, PY: 300, PZ: 480, RX: 0, RY: 0, RZ: 0, SX: 50, SY: 50, SZ: 50,
        TYPE: 'dynamic', MASS: 1, RESTITUTION: 0.3, FRICTION: 0.5, ...values
    }
});
const bodyY = name => reporter('simulation_physicsBodyValue', {NAME: name, PROPERTY: 'y'});
const draw = (py, extra = {}) => ({
    opcode: 'objects_draw', fields: {SOURCE: 'costume'}, inputs: {PX: 0, PY: py, PZ: 480, ...extra}
});

// A box falling from y = 300 onto a floor at y = -200, at 120 Hz.
const dropProject = ({floor = true, renderBody = [draw(bodyY('box'))], rate = 120} = {}) => buildProject({
    scripts: [{
        hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'drop', START: 0, RATE: rate}},
        body: [
            {opcode: 'simulation_physicsCreateWorld', inputs: {GX: 0, GY: -980, GZ: 0}},
            body('box', {}),
            ...(floor ? [body('floor', {SHAPE: 'plane', PY: -200, TYPE: 'fixed'})] : []),
            {opcode: 'simulation_setState', inputs: {KEY: 'hits', VALUE: 0}}
        ]
    }, {
        hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'drop'}},
        body: [{
            opcode: 'control_if',
            inputs: {CONDITION: reporter('simulation_physicsHit', {A: 'box', B: 'floor'})},
            substack: [{opcode: 'simulation_changeState', inputs: {KEY: 'hits', VALUE: 1}}]
        }]
    }, {hat: 'event_renderframe', body: renderBody}]
});

const loadPhysics = async vm => {
    const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
    const record = manager.loadArchive(readPluginDirectory('physics'));
    if (record.state === 'error') throw new Error(record.error);
    await record.readyPromise;
    await vm.extensionManager.refreshBlocks('simulation');
};

const drawnY = signature => JSON.parse(signature).children[0].configuration.position.y;

describeIfPhysics('the physics plugin', () => {
    let harness;
    afterEach(() => harness && harness.dispose());
    const load = (project, options = {}) => createHarness(project, {duration: 3, ...options, beforeLoad: loadPhysics});

    test.each([true, false])('a falling body follows free fall (compiler %s)', async compiler => {
        harness = await load(dropProject({floor: false}), {compiler});
        const frames = await harness.exportRange({start: 0, end: 1});
        for (const frame of [0, 10, 20, 30]) {
            const time = frame / 30;
            // y = y0 - g t^2 / 2 in stage units; the integrator is within a few units after one second.
            expect(Math.abs(drawnY(frames.get(frame)) - (300 - (0.5 * 980 * time * time)))).toBeLessThan(6);
        }
        expect(drawnY(frames.get(30))).toBeLessThan(drawnY(frames.get(20)));
    });

    test('computing the same project twice gives identical solver bytes', async () => {
        harness = await load(dropProject());
        harness.runtime.simulationRuntime.ensureAll(2);
        const first = harness.runtime.simulationRuntime.getSimulation('drop').getSnapshot(240).solverBytes;
        harness.dispose();
        harness = await load(dropProject());
        harness.runtime.simulationRuntime.ensureAll(2);
        const second = harness.runtime.simulationRuntime.getSimulation('drop').getSnapshot(240).solverBytes;
        expect(first.length).toBeGreaterThan(100);
        expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    });

    test('a pose after seeking back equals the pose computed forward', async () => {
        harness = await load(dropProject());
        const simulationRuntime = harness.runtime.simulationRuntime;
        simulationRuntime.ensureAll(1.3 + (0.5 / 120));
        const forward = simulationRuntime.readPose('drop', 'box', 1.3 + (0.5 / 120));
        const forwardBytes = simulationRuntime.getSimulation('drop').getSnapshot(156).solverBytes;
        harness.dispose();
        harness = await load(dropProject());
        const seeked = harness.runtime.simulationRuntime;
        seeked.ensureAll(4.5);
        const cache = seeked.getSimulation('drop');
        expect(cache.hasStep(156)).toBe(false);
        expect(seeked.ensureTimes([{name: 'drop', time: 1.3 + (0.5 / 120)}]).ready).toBe(true);
        expect(seeked.readPose('drop', 'box', 1.3 + (0.5 / 120))).toEqual(forward);
        expect(Buffer.from(cache.getSnapshot(156).solverBytes).equals(Buffer.from(forwardBytes))).toBe(true);
    });

    test('the box lands on the floor and the step sees the collision', async () => {
        harness = await load(dropProject());
        const frames = await harness.exportRange({start: 0, end: 3});
        // Resting on the floor (y = -200) with half its size (25) above it.
        expect(drawnY(frames.get(90))).toBeCloseTo(-175, 0);
        expect(harness.runtime.simulationRuntime.sample('drop', 'hits', 3)).toBeGreaterThanOrEqual(1);
        expect(harness.runtime.simulationRuntime.sample('drop', 'hits', 0.2)).toBe(0);
    });

    test('the same time gives the same pose at 30 and 60 fps', async () => {
        harness = await load(dropProject(), {framerate: 30});
        const at30 = await harness.exportRange({start: 0, end: 2});
        harness.dispose();
        harness = await load(dropProject(), {framerate: 60});
        const at60 = await harness.exportRange({start: 0, end: 2});
        for (let frame = 0; frame <= 60; frame += 3) expect(drawnY(at60.get(frame * 2))).toBe(drawnY(at30.get(frame)));
    });

    test('each motion blur sample reads the pose at its own time', async () => {
        harness = await load(dropProject({floor: false, renderBody: [{
            opcode: 'objects_motionBlur',
            inputs: {ANGLE: 180, PHASE: -90, SAMPLES: 4},
            substack: [{opcode: 'simulation_physicsAtBody', inputs: {NAME: 'box'}, substack: [draw(0)]}]
        }]}));
        const graph = JSON.parse(await harness.seekTo(24));
        const [blur] = graph.children;
        const ys = blur.children.map(sample => sample.children[0].transform.position.y);
        expect(new Set(ys.map(y => y.toFixed(6))).size).toBe(4);
        const times = blur.children.map(sample => 0.8 + sample.sample.time);
        const simulationRuntime = harness.runtime.simulationRuntime;
        ys.forEach((y, index) => {
            expect(y).toBeCloseTo(simulationRuntime.readPose('drop', 'box', times[index]).position.y, 9);
        });
    });

    test('rotations use the X, Y, Z order of the transform block', () => {
        const {eulerToQuaternion, quaternionToEuler} = requirePluginModule('physics', 'lib/rotation.js');
        const rotations = [{x: 0, y: 0, z: 0}, {x: 30, y: 20, z: 10}, {x: -45, y: 60, z: 135}, {x: 90, y: 0, z: 0}];
        for (const rotation of rotations) {
            const euler = quaternionToEuler(eulerToQuaternion(rotation));
            for (const axis of ['x', 'y', 'z']) expect(euler[axis]).toBeCloseTo(rotation[axis], 9);
        }
        // Multiples of 90 degrees are exact.
        expect(eulerToQuaternion({x: 180, y: 0, z: 0})).toEqual({x: 1, y: 0, z: 0, w: 0});
    });
});
