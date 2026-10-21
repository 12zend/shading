// Build shading.app as one TurboWarp extension file: build-extension/shading-app.js.
// Load it in TurboWarp with Add Extension → Custom Extension → Files, and check
// "Run extension without sandbox". It replaces the TurboWarp page with shading.app.
//
// Usage: node scripts/build-extension.cjs [--no-official-plugins] [--exclude-plugins=id,id]
//
// The official plugins come from SHADING_PLUGINS_DIR or ../shading-plugins when present, otherwise
// from an existing build/official-plugins, otherwise from a fresh clone (build-official-plugins.cjs).
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {build: buildOfficialPlugins} = require('./build-official-plugins.cjs');
const {version: packageVersion} = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build-extension');
const WEBPACK_OUTPUT = path.join(OUTPUT, 'webpack');
const OUTPUT_FILE = path.join(OUTPUT, 'shading-app.js');
const PAGES = ['editor', 'install', 'addons'];

const MIME_TYPES = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.cur': 'image/x-icon',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm'
};

const parseArgs = argv => {
    const options = {officialPlugins: true, excludePlugins: new Set()};
    for (const arg of argv) {
        if (arg === '--no-official-plugins') {
            options.officialPlugins = false;
        } else if (arg.startsWith('--exclude-plugins=')) {
            for (const id of arg.slice('--exclude-plugins='.length).split(',')) {
                if (id) options.excludePlugins.add(id.trim());
            }
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
};

const run = (command, args, env) => {
    execFileSync(command, args, {cwd: ROOT, stdio: 'inherit', env: {...process.env, ...env}});
};

const listFiles = (directory, relative = '') => {
    const result = [];
    for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true})) {
        if (entry.name === '.DS_Store') continue;
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) result.push(...listFiles(directory, name));
        else result.push(name);
    }
    return result.sort();
};

const toDataURL = (file, data) => {
    const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return `data:${type};base64,${data.toString('base64')}`;
};

const officialPluginsSource = async () => {
    const source = process.env.SHADING_PLUGINS_DIR || path.resolve(ROOT, '..', 'shading-plugins');
    if (fs.existsSync(source)) {
        const output = path.join(OUTPUT, 'official-plugins');
        await buildOfficialPlugins(source, output);
        return output;
    }
    const existing = path.join(ROOT, 'build', 'official-plugins');
    if (!fs.existsSync(path.join(existing, 'catalog.json'))) {
        run(process.execPath, [path.join(__dirname, 'build-official-plugins.cjs')]);
    }
    return existing;
};

const addOfficialPlugins = async (files, excludePlugins) => {
    const directory = await officialPluginsSource();
    const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8'))
        .filter(entry => !excludePlugins.has(entry.id));
    for (const entry of catalog) {
        for (const part of entry.parts || [entry.fileName]) {
            files[`official-plugins/${part}`] = toDataURL(part, fs.readFileSync(path.join(directory, part)));
        }
    }
    files['official-plugins/catalog.json'] = toDataURL('catalog.json', Buffer.from(JSON.stringify(catalog)));
    return catalog.map(entry => entry.id);
};

const inlineScript = source => {
    if (/<\/script/i.test(source)) throw new Error('Inline script contains </script');
    return `<script>${source}</script>`;
};

const makePage = (name, preamble) => {
    let html = fs.readFileSync(path.join(WEBPACK_OUTPUT, `${name}.html`), 'utf8');
    html = html
        .replace(/\s*<link rel="(?:apple-touch-icon|manifest)"[^>]*>/g, '')
        .replace(/<script src="((?:simple-)?splash\.js)"><\/script>/, (match, file) => (
            inlineScript(fs.readFileSync(path.join(ROOT, 'static', file), 'utf8'))
        ))
        .replace(/<head>/, () => `<head>\n${inlineScript(preamble.replace('__SHADING_PAGE__', JSON.stringify(name)))}`)
        .replace(/<\/body>/, () => '<script src="__SHADING_APP_URL__"></script>\n</body>');
    if (!html.includes('__SHADING_APP_URL__') || html.includes('splash.js"')) {
        throw new Error(`Could not prepare ${name}.html`);
    }
    return html;
};

const version = () => {
    let commit = 'unknown';
    try {
        commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
    } catch (error) {
        // Not a git checkout.
    }
    return `${packageVersion}+${commit}.${Date.now()}`;
};

const formatSize = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    fs.rmSync(OUTPUT, {recursive: true, force: true});
    fs.mkdirSync(OUTPUT, {recursive: true});

    run(process.execPath, [path.join(__dirname, 'build-scratch-blocks.cjs'), '--if-missing']);
    run(process.execPath, [path.join(ROOT, 'node_modules', 'webpack', 'bin', 'webpack.js'), '--bail'], {
        BUILD_MODE: 'extension',
        NODE_ENV: 'production'
    });

    const files = {};
    const staticDirectory = path.join(WEBPACK_OUTPUT, 'static');
    for (const file of listFiles(staticDirectory)) {
        files[`static/${file}`] = toDataURL(file, fs.readFileSync(path.join(staticDirectory, file)));
    }
    const plugins = options.officialPlugins ? await addOfficialPlugins(files, options.excludePlugins) : [];

    const preamble = fs.readFileSync(path.join(__dirname, 'extension', 'preamble.js'), 'utf8');
    const pages = {};
    for (const name of PAGES) pages[name] = makePage(name, preamble);

    const appSource = fs.readFileSync(path.join(WEBPACK_OUTPUT, 'shading-app.js'), 'utf8');
    const buildVersion = version();
    const values = {
        __SHADING_VERSION__: JSON.stringify(buildVersion),
        __SHADING_PAGES__: JSON.stringify(pages),
        __SHADING_APP_SOURCE__: JSON.stringify(appSource),
        __SHADING_FILES__: JSON.stringify(files)
    };
    const host = fs.readFileSync(path.join(__dirname, 'extension', 'host.js'), 'utf8')
        .replace(/__SHADING_(?:VERSION|PAGES|APP_SOURCE|FILES)__/g, placeholder => values[placeholder]);
    const header = [
        `// shading.app ${buildVersion} as a TurboWarp extension.`,
        '// Load with Custom Extension → Files and check "Run extension without sandbox".',
        '// Source: https://github.com/12zend/shading (GPL-3.0). Generated by scripts/build-extension.cjs.',
        ''
    ].join('\n');
    fs.writeFileSync(OUTPUT_FILE, header + host);

    console.log(`\nWrote ${path.relative(ROOT, OUTPUT_FILE)} (${formatSize(fs.statSync(OUTPUT_FILE).size)})`);
    console.log(`  app: ${formatSize(Buffer.byteLength(appSource))}, static files: ${Object.keys(files).length}`);
    console.log(`  official plugins: ${plugins.length ? plugins.join(', ') : 'none'}`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
