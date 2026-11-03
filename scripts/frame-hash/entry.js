/* eslint-env browser */
// Browser side of scripts/frame-hash/render-frame-hashes.cjs: boots a VM with the real renderer, reaches a frame in
// each of the timeline driver's ways and returns the SHA-256 of the pixels that were on screen (or exported).
import ScratchStorage from '@turbowarp/scratch-storage';
import VM from '../../scratch-vm/src/index';
import RenderWebGL from '../../scratch-render/src/index';
import {createTimelineDriver} from '../../test/helpers/timeline-driver';
import {COSTUME, COSTUME_SVG, PROJECTS} from './projects';

const sha256 = async pixels => {
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

const readPixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.slice();

const createVM = async (project, {compiler, framerate, duration}) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    document.body.appendChild(canvas);
    const vm = new VM();
    const renderer = new RenderWebGL(canvas, -240, 240, -180, 180);
    vm.attachRenderer(renderer);
    const storage = new ScratchStorage();
    storage.builtinHelper._store(
        storage.AssetType.ImageVector,
        storage.DataFormat.SVG,
        new TextEncoder().encode(COSTUME_SVG),
        COSTUME.assetId
    );
    vm.attachStorage(storage);
    vm.installShadingFeatures();
    const manager = vm.runtime.movieAssetManager;

    // Keep a copy of every captured frame's pixels; the frame store releases the canvas after encoding it.
    let lastCapture = null;
    const captureRenderingFrame = manager.captureRenderingFrame;
    manager.captureRenderingFrame = function () {
        const frame = captureRenderingFrame.call(this);
        lastCapture = readPixels(frame);
        return frame;
    };
    const addRenderingFrame = manager.addRenderingFrame;
    manager.addRenderingFrame = function () {
        const frame = addRenderingFrame.call(this);
        frame.pixels = lastCapture;
        return frame;
    };

    await vm.loadProject(JSON.stringify(project));
    vm.setCompilerOptions({enabled: compiler});
    manager.updateTimelineSettings({
        ...manager.getTimelineSettings(), duration, framerate, height: 360, width: 480
    });
    clearTimeout(manager.timelinePreviewRefreshTimeout);
    const driver = createTimelineDriver({
        vm,
        readFrame: () => readPixels(manager.captureRenderingFrame()),
        readExportedFrame: frame => frame.pixels
    });
    return {vm, manager, renderer, driver};
};

window.runFrameHash = async ({project, frames, compiler = true, framerate = 30, duration = 1}) => {
    const {renderer, driver} = await createVM(PROJECTS[project](), {compiler, framerate, duration});
    const gl = renderer.gl;
    const results = {};
    for (const frame of frames) {
        const ways = await driver.reachFrame(frame);
        const hashes = {};
        for (const way of Object.keys(ways)) hashes[way] = ways[way] ? await sha256(ways[way]) : null;
        results[frame] = hashes;
    }
    driver.dispose();
    return {
        renderer: gl.getParameter(gl.RENDERER),
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        results
    };
};
