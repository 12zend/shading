// Build the integrated scratch-blocks checkout so `file:./scratch-blocks` resolves to compiled output.
// Usage: node scripts/build-scratch-blocks.cjs [--if-missing]
const fs = require('fs');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');

const root = path.resolve(__dirname, '..', 'scratch-blocks');
const outputs = [
    'blockly_compressed_vertical.js',
    'blocks_compressed.js',
    'blocks_compressed_vertical.js',
    'msg/scratch_msgs.js',
    'dist/vertical.js'
];

if (process.argv.includes('--if-missing') &&
    outputs.every(file => fs.existsSync(path.join(root, file)))) {
    process.exit(0);
}

// Closure Compiler runs on Java. Fall back to a Homebrew JDK when no system Java is configured.
const env = {...process.env};
for (const bin of ['/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin']) {
    if (fs.existsSync(path.join(bin, 'java'))) {
        env.PATH = `${bin}${path.delimiter}${env.PATH}`;
        break;
    }
}

// Hosted builders (e.g. Cloudflare Pages) have no Java, so the Closure Compiler cannot run there.
// Use the committed compiled output in that case instead of failing the whole build.
const hasJava = spawnSync('java', ['-version'], {env, stdio: 'ignore'}).status === 0;
if (!hasJava && outputs.every(file => fs.existsSync(path.join(root, file)))) {
    console.warn('Java not found; using the prebuilt scratch-blocks output.');
    process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, {cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32'});

// The root `npm ci` links this checkout via `file:./scratch-blocks` and can leave a partial
// scratch-blocks/node_modules behind (its dependencies get hoisted to the root), so check for the
// Closure packages build.py needs rather than only for the directory.
const hasClosure = ['google-closure-library', 'google-closure-compiler']
    .every(name => fs.existsSync(path.join(root, 'node_modules', name)));
if (!hasClosure) {
    // Skip install scripts: chromedriver and friends are only needed for scratch-blocks' own browser tests.
    run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
}
run(['run', 'prepublish']);
