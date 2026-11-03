// Drives a real VM, MovieAssetManager and Objects blocks without a WebGL renderer, so tests can check that a
// timeline frame comes out the same however the editor reached it (export, export from mid-range, seek, play and
// stop, export with frame reuse). A frame's "image" is the serialized frame graph that the frame transaction
// committed: the renderer is replaced by a stub that records each executed graph instead of drawing it.
//
// Test files that use this helper must mock the rendering frame store (it needs IndexedDB):
//   jest.mock('../../../scratch-vm/src/lib/movie-rendering-frame-store', () =>
//       require('../../helpers/mock-rendering-frame-store'));
import crypto from 'crypto';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../scratch-vm/src/lib/movie-asset-manager';
import installMovieEasing from '../../scratch-vm/src/lib/movie-easing';
import installObjectBlocks from '../../scratch-vm/src/lib/object-blocks';
import {buildProject} from './project-builder';
import {createTimelineDriver} from './timeline-driver';

// Keys whose values depend on how many frames or camera edits came before, not on what the frame shows.
const PATH_DEPENDENT_KEYS = new Set([
    'cameraVersion', 'frameId', 'generation', 'id', 'timelineFrame', 'timelineTime'
]);

const serializeFrameGraph = graph => JSON.stringify(graph, (key, value) => {
    if (PATH_DEPENDENT_KEYS.has(key)) return;
    if (value && typeof value === 'object' && typeof value.getName === 'function') return `target:${value.getName()}`;
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
});

const hashText = text => crypto.createHash('sha256').update(String(text))
    .digest('hex');

// ---- harness ---------------------------------------------------------------------------------------------

// Any renderer method is a no-op; properties the Movie code reads have neutral values.
const createFakeRenderer = () => new Proxy({
    _allDrawables: [],
    _allSkins: [],
    _backgroundColor4f: [1, 1, 1, 1],
    canvas: null,
    movieFrameGraph: null
}, {
    get: (target, property) => {
        if (property in target || typeof property === 'symbol' || property === 'then') return target[property];
        return () => {};
    }
});

/**
 * Load a project into a VM with Movie, Objects and easing installed and the renderer stubbed out.
 * @param {object} project sb3 project JSON (see buildProject).
 * @param {object} options {compiler: boolean, framerate: number, duration: number}.
 * @returns {Promise<object>} Timeline driver (see timeline-driver.js) with vm, runtime, manager and frames.
 */
const createHarness = async (project, {compiler = true, framerate = 30, duration = 10} = {}) => {
    // Runtime._step reads document.hidden before drawing; a hidden document skips the (stubbed) draw.
    if (typeof document === 'undefined') global.document = {hidden: true};
    const vm = new VM();
    const runtime = vm.runtime;
    runtime.renderer = createFakeRenderer();
    installObjectBlocks(vm);
    installMovieEasing(vm);
    const manager = installMovieAssetManager(vm);

    const frames = {staged: null, committed: null, executed: []};
    manager.penFX = {
        beginFrame: () => {
            frames.staged = 'background';
            return true;
        },
        commitFrame: () => {
            frames.committed = frames.staged;
            frames.staged = null;
            return true;
        },
        cancelFrame: () => {
            frames.staged = null;
            return true;
        },
        drawDefaultBackground: () => {}
    };
    manager.usesDefaultBackdrop = () => false;
    manager.renderFrameGraph = graph => {
        const serialized = serializeFrameGraph(graph);
        frames.executed.push(serialized);
        if (frames.staged !== null) frames.staged = serialized;
    };
    manager.captureRenderingFrame = () => frames.committed;

    await vm.loadProject(JSON.stringify(project));
    vm.setCompilerOptions({enabled: compiler});
    manager.updateTimelineSettings({...manager.getTimelineSettings(), duration, framerate});
    clearTimeout(manager.timelinePreviewRefreshTimeout);
    manager.timelinePreviewRefreshTimeout = null;

    const driver = createTimelineDriver({
        vm,
        readFrame: () => frames.committed,
        readExportedFrame: frame => frame.signature
    });
    return Object.assign(driver, {vm, runtime, manager, frames});
};

export {
    buildProject,
    createHarness,
    hashText,
    serializeFrameGraph
};
