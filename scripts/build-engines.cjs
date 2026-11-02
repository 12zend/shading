// Builds the editor of every older version in engine-versions.json into build/engines/<version>/, so a .shade file
// saved by that version can open in the engine that saved it. Run after `npm run build`, with the same ROOT.
//
// Each version is built from its commit in a git worktree under .engine-cache/<commit>/ (kept between runs, so a
// version is checked out and installed only once).
//
// An archived engine never changes, so its finished build is also kept under
// .engine-builds/<environment>/<version>-<commit>/ and copied instead of rebuilt next time. <environment> is a hash of
// the variables the build reads (ROOT and friends), so a build for another ROOT is never reused. CI keeps
// .engine-builds/ between runs (actions/cache), so a deploy only builds the engines that are new since the last one.
// Stored builds for this environment that are no longer listed are removed.
// Options:
//   --only=1.0.0,1.1.0   build just these versions
//   --no-reuse           ignore .engine-builds/ and build everything again (the results are still stored)
// Environment:
//   ENGINE_BUILD_CACHE   where to keep finished builds (default: .engine-builds/)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');

const repository = path.resolve(__dirname, '..');
const cacheDirectory = path.join(repository, '.engine-cache');
const buildCacheDirectory = path.resolve(repository, process.env.ENGINE_BUILD_CACHE || '.engine-builds');
const outputDirectory = path.join(repository, 'build', 'engines');
const list = require('../engine-versions.json');

// Written last into a stored build, so an interrupted copy is never mistaken for a finished one.
const COMPLETE_MARKER = '.engine-build-complete';

// Environment variables that change what webpack.config.js produces. ROOT and SHADING_SITE_ROOT are set per engine
// from ROOT below.
const BUILD_ENVIRONMENT = [
    'NODE_ENV', 'ROOT', 'STATIC_PATH', 'EXTRA_META', 'SOURCEMAP', 'DEBUG', 'ENABLE_SERVICE_WORKER',
    'ROUTING_STYLE', 'ENABLE_WINDCHIMES', 'SHADING_EXTENSION', 'BUILD_MODE'
];

const root = process.env.ROOT || '';
if (root.length > 0 && !root.endsWith('/')) throw new Error('If ROOT is defined, it must have a trailing slash.');

const onlyArgument = process.argv.find(argument => argument.startsWith('--only='));
const only = onlyArgument ? onlyArgument.slice('--only='.length).split(',')
    .filter(Boolean) : null;
const reuse = !process.argv.includes('--no-reuse');

// Production builds run with NODE_ENV=production, which makes npm leave out devDependencies: webpack and the Closure
// packages scratch-blocks compiles with. Older commits cannot be changed, so ask npm for them through the environment.
const buildEnvironment = Object.assign({}, process.env, {npm_config_include: 'dev'});

const run = (command, args, options = {}) => {
    const where = options.cwd ? `  (in ${path.relative(repository, options.cwd)})` : '';
    console.log(`> ${command} ${args.join(' ')}${where}`);
    execFileSync(command, args, Object.assign({stdio: 'inherit'}, options));
};

const environmentDirectory = (() => {
    const environment = {};
    for (const name of BUILD_ENVIRONMENT) environment[name] = process.env[name] || '';
    const hash = crypto.createHash('sha256')
        .update(JSON.stringify(environment))
        .digest('hex')
        .slice(0, 16);
    return path.join(buildCacheDirectory, hash);
})();

const buildKey = entry => `${entry.version}-${entry.commit}`;

const checkout = commit => {
    const directory = path.join(cacheDirectory, commit);
    if (!fs.existsSync(path.join(directory, 'package.json'))) {
        fs.mkdirSync(cacheDirectory, {recursive: true});
        run('git', ['worktree', 'prune'], {cwd: repository});
        run('git', ['worktree', 'add', '--force', '--detach', directory, commit], {cwd: repository});
    }
    if (!fs.existsSync(path.join(directory, 'node_modules'))) {
        run('npm', ['ci'], {cwd: directory, env: buildEnvironment});
    }
    return directory;
};

const assertEngine = (directory, entry) => {
    // The engine has to accept files handed over from other engines, or switching to it loses the file.
    if (!fs.existsSync(path.join(directory, 'src', 'lib', 'engine-handoff.js'))) {
        throw new Error(`${entry.version} (${entry.commit}) predates engine switching; list a later commit.`);
    }
    const own = JSON.parse(fs.readFileSync(path.join(directory, 'engine-versions.json'), 'utf8'));
    if (own.current !== entry.version) {
        throw new Error(`${entry.commit} is engine ${own.current}, but engine-versions.json lists it as ` +
            `${entry.version}.`);
    }
};

const build = entry => {
    const directory = checkout(entry.commit);
    assertEngine(directory, entry);
    run('npm', ['run', 'build'], {
        cwd: directory,
        env: Object.assign({}, buildEnvironment, {
            ROOT: `${root}engines/${entry.version}/`,
            SHADING_SITE_ROOT: root
        })
    });
    return path.join(directory, 'build');
};

const store = (source, stored) => {
    fs.rmSync(stored, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(stored), {recursive: true});
    fs.cpSync(source, stored, {recursive: true});
    fs.writeFileSync(path.join(stored, COMPLETE_MARKER), '');
};

const pruneStoredBuilds = keep => {
    if (!fs.existsSync(environmentDirectory)) return;
    for (const name of fs.readdirSync(environmentDirectory)) {
        if (keep.has(name)) continue;
        console.log(`Removing stored engine build ${name} (no longer listed)`);
        fs.rmSync(path.join(environmentDirectory, name), {recursive: true, force: true});
    }
};

const main = () => {
    const archived = list.versions.filter(entry => entry.version !== list.current &&
        (!only || only.includes(entry.version)));
    if (!archived.length) {
        console.log(`Only the current engine (${list.current}) is listed; nothing to build.`);
        return;
    }
    let built = 0;
    for (const entry of archived) {
        if (!/^[0-9a-f]{7,40}$/.test(entry.commit || '')) {
            throw new Error(`Engine ${entry.version} needs a commit id in engine-versions.json.`);
        }
        const stored = path.join(environmentDirectory, buildKey(entry));
        if (reuse && fs.existsSync(path.join(stored, COMPLETE_MARKER))) {
            console.log(`\nReusing stored build of engine ${entry.version} (${path.relative(repository, stored)})`);
        } else {
            console.log(`\nBuilding engine ${entry.version} from ${entry.commit}`);
            store(build(entry), stored);
            built++;
        }
        const destination = path.join(outputDirectory, entry.version);
        fs.rmSync(destination, {recursive: true, force: true});
        fs.mkdirSync(outputDirectory, {recursive: true});
        fs.cpSync(stored, destination, {recursive: true});
        fs.rmSync(path.join(destination, COMPLETE_MARKER), {force: true});
    }
    // With --only the rest of the list was not looked at, so keep its stored builds.
    if (!only) pruneStoredBuilds(new Set(archived.map(buildKey)));
    console.log(`\nArchived engines: ${archived.length - built} reused, ${built} built.`);
};

main();
