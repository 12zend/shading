#!/usr/bin/env node
/* Compare the framebuffer SHA-256 of timeline frames reached in five ways (export from the start, export from just
 * before the frame, seek, play and stop, export reusing frames) in headless Chromium with the real renderer.
 *
 *   node scripts/frame-hash/render-frame-hashes.cjs [project] [frames] [--interpreter] [--fps=30] [--json=out.json]
 *
 * project is a key of scripts/frame-hash/projects.js (default: stateless); frames is a comma list (default 0,7,13).
 * Exits with status 1 when any way of reaching a frame gives a different image.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const {chromium} = require('playwright-chromium');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
const option = name => {
    const match = args.find(arg => arg.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : null;
};
const project = positional[0] || 'stateless';
const frames = (positional[1] || '0,7,13').split(',').map(Number);

// esbuild does not run webpack loaders: strip loader prefixes (`!raw-loader!./file`), inline base64-loader files,
// leave out modules only exporting needs (mediabunny) and stub the Node built-ins some dependencies mention.
const NODE_BUILTINS = /^(fs|path|crypto|module)$/;
const webpackCompatibility = {
    name: 'webpack-compatibility',
    setup (build) {
        build.onResolve({filter: NODE_BUILTINS}, () => ({path: 'builtin', namespace: 'empty'}));
        build.onResolve({filter: /^mediabunny\//}, () => ({path: 'mediabunny', namespace: 'empty'}));
        build.onResolve({filter: /!/}, resolved => {
            const request = resolved.path.slice(resolved.path.lastIndexOf('!') + 1);
            const file = require.resolve(request, {paths: [resolved.resolveDir]});
            if (/base64-loader!/.test(resolved.path)) return {path: file, namespace: 'base64'};
            if (/tw-load-script-as-plain-text!/.test(resolved.path)) return {path: file, namespace: 'empty'};
            return {path: file};
        });
        build.onLoad({filter: /.*/, namespace: 'empty'}, () => ({contents: 'module.exports = {};', loader: 'js'}));
        build.onLoad({filter: /.*/, namespace: 'base64'}, loaded => ({
            contents: `module.exports = ${JSON.stringify(fs.readFileSync(loaded.path).toString('base64'))};`,
            loader: 'js'
        }));
    }
};

const bundle = async () => {
    const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shading-frame-hash-')), 'bundle.js');
    await esbuild.build({
        entryPoints: [path.join(__dirname, 'entry.js')],
        bundle: true,
        outfile,
        format: 'iife',
        platform: 'browser',
        target: 'es2019',
        logLevel: 'error',
        define: {'process.env.NODE_ENV': '"production"', 'global': 'window'},
        inject: [path.join(__dirname, 'process-shim.js')],
        loader: {
            '.frag': 'text', '.vert': 'text', '.glsl': 'text', '.css': 'text', '.svg': 'text',
            '.png': 'dataurl', '.jpg': 'dataurl', '.wav': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl',
            '.ttf': 'dataurl', '.otf': 'dataurl', '.woff': 'dataurl', '.zip': 'binary', '.wasm': 'binary'
        },
        plugins: [webpackCompatibility]
    });
    return outfile;
};

(async () => {
    const bundleFile = await bundle();
    const browser = await chromium.launch({args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist']});
    try {
        const page = await browser.newPage({deviceScaleFactor: 1, viewport: {width: 800, height: 600}});
        // localhost is a secure context, so crypto.subtle is available; the route answers without a server.
        const origin = 'http://localhost:1';
        await page.route(`${origin}/**`, route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/bundle.js') {
                return route.fulfill({contentType: 'text/javascript', body: fs.readFileSync(bundleFile, 'utf8')});
            }
            return route.fulfill({contentType: 'text/html', body: '<!doctype html><body><script src="/bundle.js"></script></body>'});
        });
        page.on('pageerror', error => console.error('[page]', error));
        await page.goto(`${origin}/`);
        const result = await page.evaluate(options => window.runFrameHash(options), {
            project,
            frames,
            compiler: !args.includes('--interpreter'),
            framerate: Number(option('fps') || 30)
        });
        let mismatches = 0;
        for (const frame of Object.keys(result.results)) {
            const hashes = result.results[frame];
            const reference = hashes.exportFromStart;
            for (const way of Object.keys(hashes)) {
                const same = hashes[way] === reference;
                if (!same) mismatches++;
                console.log(`frame ${frame} ${way.padEnd(20)} ${hashes[way]} ${same ? '' : 'MISMATCH'}`);
            }
        }
        console.log(`renderer: ${result.renderer} (WebGL2: ${result.webgl2})`);
        if (option('json')) fs.writeFileSync(option('json'), JSON.stringify(result, null, 2));
        process.exitCode = mismatches ? 1 : 0;
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(2);
});
