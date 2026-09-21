/* Compare checked-out revisions with the same native WebGL backend. Never run two GPU samples concurrently. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const output = process.argv[3] || '/tmp/movie-renderer-benchmark.json';
const bootstrap = process.env.MOVIE_BENCHMARK_BOOTSTRAP || path.join(root, 'scripts/benchmarks/native-environment.cjs');
const {canvas} = require(bootstrap);
const VM = require(path.join(root, 'scratch-vm/src'));
const Renderer = require(path.join(root, 'scratch-render/src'));
const Storage = require(path.join(root, 'node_modules/@turbowarp/scratch-storage'));
const THREE = require(path.join(root, 'node_modules/three/build/three.cjs'));

(async () => {
    const vm = new VM();
    const renderer = new Renderer(canvas(), -240, 240, -180, 180);
    vm.attachRenderer(renderer);
    vm.attachStorage(new Storage());
    vm.attachV2BitmapAdapter(new (require(path.join(root,
        'node_modules/@turbowarp/scratch-svg-renderer')).BitmapAdapter)());
    vm.installShadingFeatures();
    // A fixture from the active checkout is used for both revisions.
    await vm.loadProject(fs.readFileSync(path.join(__dirname, '../../test/fixtures/project1.sb3')));
    const manager = vm.runtime.movieAssetManager;
    const target = vm.runtime.targets.find(candidate => !candidate.isStage);
    const pen = vm.runtime.movieDrawing || vm.runtime.ext_pen;
    const penId = renderer.getMovieBufferId ? renderer.getMovieBufferId() : pen._getPenLayerID();
    const gl = renderer.gl;
    const counts = {uploads: 0, draws: 0};
    for (const [method, key] of [['texImage2D', 'uploads'], ['drawArrays', 'draws'], ['drawElements', 'draws']]) {
        const original = gl[method].bind(gl);
        gl[method] = (...args) => { counts[key]++; return original(...args); };
    }
    while (gl.getError()) {}
    const preparedVideo = canvas();
    preparedVideo.width = 160;
    preparedVideo.height = 90;
    preparedVideo.reusable = false;
    const context = preparedVideo.getContext('2d');
    context.fillStyle = '#24a0cc';
    context.fillRect(0, 0, 160, 90);
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100),
        new THREE.MeshBasicMaterial({color: 0xe47236})));
    manager.models.set(target.id, [{assetId: 'bench-model', name: 'bench-model', activeMotion: ''}]);
    manager.modelObjects.set('bench-model', {object});
    const config = {position: {x: 0, y: 0, z: 480}, rotation: {x: 0, y: 0, z: 0},
        scale: {x: 1, y: 1, z: 1}, size: 100, width: 100, height: 100};
    const scenarios = [
        ['trail_direct', 100, () => {
            const attributes = {diameter: 3, color4f: [0.25, 0.5, 1, 0.75]};
            if (renderer.drawMovieStroke) renderer.drawMovieStroke(attributes, -50, -20, 50, 20);
            else renderer.penLine(penId, attributes, -50, -20, 50, 20);
        }],
        ['shape_cached', 1000, () => manager.drawShapeImmediately(target,
            {...config, shape: 'polygon', n: 6, radius: {outer: 100, inner: 0}, color: '#ef6633'})],
        ['line_cached', 1000, () => manager.drawShapeImmediately(target,
            {shape: 'line', position1: {x: -50, y: -20, z: 480},
                position2: {x: 50, y: 20, z: 480}, thickness: 5, color: '#abcdef'})],
        ['text_cached', 1000, () => manager.drawObjectImmediately(target,
            {...config, source: 'text', asset: 'sans-serif', text: 'Movie renderer'})],
        ['video_prepared_upload', 100, () => {
            if (renderer.prepareMovieSource) {
                manager.applyObjectDrawConfiguration(target, config);
                manager.getTargetState(target).objectSource = renderer.prepareMovieSource({kind: 'video', bitmap: preparedVideo, owner: target.id});
                manager.finishObjectDraw(target, config, 'video');
                return;
            }
            manager.applyBitmap(target, preparedVideo, 'video', null, true, 2);
            manager.stampTarget(target);
        }],
        ['model_loaded', 30, () => manager.drawObjectImmediately(target,
            {...config, source: 'model', asset: 'bench-model', frame: 1})]
    ];
    const selected = process.env.MOVIE_BENCHMARK_CASE;
    const results = [];
    for (const [name, iterations, draw] of scenarios) {
        if (selected && name !== selected) continue;
        const samples = [];
        let promiseReturns = 0;
        let operations;
        for (let sample = -3; sample < 7; sample++) {
            if (renderer.clearMovieBuffer) renderer.clearMovieBuffer();
            else renderer.penClear(penId);
            counts.uploads = counts.draws = 0;
            const pending = [];
            const start = performance.now();
            for (let index = 0; index < iterations; index++) {
                const result = draw();
                if (result && typeof result.then === 'function') {
                    if (sample >= 0) promiseReturns++;
                    pending.push(result);
                }
            }
            if (pending.length) await Promise.all(pending);
            renderer._doExitDrawRegion();
            gl.finish();
            if (sample >= 0) {
                samples.push(performance.now() - start);
                operations = {...counts};
            }
        }
        const skin = renderer._allSkins[penId];
        const pixels = new Uint8Array(skin._size[0] * skin._size[1] * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, skin._framebuffer.framebuffer);
        gl.readPixels(0, 0, skin._size[0], skin._size[1], gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const sorted = samples.slice().sort((a, b) => a - b);
        const result = {name, iterations, samples, medianMs: sorted[3], p95Ms: sorted[6],
            promiseReturns, operations,
            sha256: crypto.createHash('sha256').update(pixels).digest('hex'), glError: gl.getError()};
        results.push(result);
        console.log(JSON.stringify(result));
    }
    fs.writeFileSync(output, JSON.stringify({root, node: process.version,
        renderer: gl.getParameter(gl.RENDERER), results}, null, 2));
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
