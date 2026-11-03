/* eslint-env browser */
// Browser side of `render-frame-hashes.cjs --physics-benchmark`: 100 rigid bodies falling onto a floor for 10 s at
// 120 Hz, drawn as shapes, with and without an 8-sample motion blur. The physics plugin is loaded from the
// shading-plugins checkout through the plugin module loader, with the parts of the plugin API it uses.
import ArgumentType from '../../scratch-vm/src/extension-support/argument-type';
import BlockType from '../../scratch-vm/src/extension-support/block-type';
import Cast from '../../scratch-vm/src/util/cast';
import {getEvaluationTime} from '../../scratch-vm/src/lib/object-animation';
import {runBranchWithTransform} from '../../scratch-vm/src/lib/object-blocks';
import {getSimulationContext, registerSimulationBlocks} from '../../scratch-vm/src/lib/simulation-blocks';
import {localize} from '../../scratch-vm/src/lib/movie-block-l10n';
import {createModuleSystem} from '../../src/lib/plugins/module-loader';
import {BODIES, physicsProject} from './physics-project';
import physicsFiles from 'shading-plugin-files:physics';

const decodeBase64 = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));

const loadPhysicsPlugin = async vm => {
    const files = new Map(Object.keys(physicsFiles).map(name => [name, decodeBase64(physicsFiles[name])]));
    const runtime = vm.runtime;
    const api = {
        runtime,
        vm,
        scratch: {ArgumentType, BlockType, Cast},
        l10n: {getLocale: () => 'en', localize},
        objects: {
            getTime: util => getEvaluationTime(runtime, util),
            runWithTransform: (util, transform) => runBranchWithTransform(runtime, util, transform)
        },
        simulation: {
            registerSolver: solver => runtime.simulationRuntime.registerSolver(solver),
            addBlocks: contribution => registerSimulationBlocks(vm, {...contribution, id: 'physics'}),
            getContext: util => getSimulationContext(util),
            readPose: (name, body, time, util) => runtime.simulationRuntime.readPose(name, body,
                typeof time === 'number' ? time : getEvaluationTime(runtime, util))
        }
    };
    const plugin = createModuleSystem({pluginId: 'physics', files, api}).require('./main.js');
    await plugin.activate(api);
    await vm.extensionManager.refreshBlocks('simulation');
};

const median = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const runPhysicsBenchmark = async (createVM, costume) => {
    const results = {};
    for (const motionBlur of [false, true]) {
        const {vm, renderer, driver} = await createVM(physicsProject({costume, motionBlur}), {
            compiler: true, framerate: 30, duration: 10, beforeLoad: loadPhysicsPlugin
        });
        const gl = renderer.gl;
        const simulationRuntime = vm.runtime.simulationRuntime;
        const manager = vm.runtime.movieAssetManager;
        manager.syncSimulationDefinitions();
        console.log(`[benchmark] loaded (motion blur: ${motionBlur})`);
        if (motionBlur) {
            simulationRuntime.ensureAll(10);
        } else {
            const start = performance.now();
            const computed = simulationRuntime.ensureAll(10);
            results.bodies = BODIES;
            results.initialComputeMs = performance.now() - start;
            results.initialComputeReady = computed.ready;
            results.errors = computed.errors.map(error => String(error.error && error.error.message));
            console.log(`[benchmark] computed in ${results.initialComputeMs.toFixed(0)} ms`);
        }
        // Seek to frames spread over the 10 s (the simulation is cached): time to evaluate, draw and finish.
        const frames = [12, 287, 45, 233, 150, 9, 299, 77, 190, 120, 260, 33];
        const timings = [];
        for (const frame of frames) {
            const start = performance.now();
            manager.seekTimeline(driver.frameTime(frame));
            try {
                await driver.settle(100000);
            } catch (error) {
                const t = manager.timeline;
                throw new Error(`${error.message} ${JSON.stringify({pending: t.pendingFrame,
                    waitingForFrame: t.waitingForFrame,
                    waitingForSimulation: t.waitingForSimulation,
                    initializing: t.initializing,
                    errors: simulationRuntime.getErrors().map(e => String(e.error.message)),
                    threads: vm.runtime.threads.length})}`);
            }
            gl.finish();
            timings.push(performance.now() - start);
            console.log(`[benchmark] frame ${frame}: ${timings[timings.length - 1].toFixed(1)} ms`);
        }
        results[motionBlur ? 'frameMsMotionBlur8' : 'frameMs'] = {median: median(timings), samples: timings};
        if (motionBlur) results.accumulation = vm.runtime.penFX.getAccumulationPrecision();
        const cache = simulationRuntime.getSimulation('boxes');
        results.cacheMegabytes = cache ? cache.memoryBytes / 1024 / 1024 : 0;
        driver.dispose();
    }
    return results;
};

export {runPhysicsBenchmark};
