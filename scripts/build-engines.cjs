// Builds the editor of every older version in engine-versions.json into build/engines/<version>/, so a .shade file
// saved by that version can open in the engine that saved it. Run after `npm run build`, with the same ROOT.
//
// Each version is built from its commit in a git worktree under .engine-cache/<commit>/ (kept between runs, so a
// version is checked out and installed only once). Options:
//   --only=1.0.0,1.1.0   build just these versions
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const repository = path.resolve(__dirname, '..');
const cacheDirectory = path.join(repository, '.engine-cache');
const outputDirectory = path.join(repository, 'build', 'engines');
const list = require('../engine-versions.json');

const root = process.env.ROOT || '';
if (root.length > 0 && !root.endsWith('/')) throw new Error('If ROOT is defined, it must have a trailing slash.');

const onlyArgument = process.argv.find(argument => argument.startsWith('--only='));
const only = onlyArgument ? onlyArgument.slice('--only='.length).split(',')
    .filter(Boolean) : null;

const run = (command, args, options = {}) => {
    const where = options.cwd ? `  (in ${path.relative(repository, options.cwd)})` : '';
    console.log(`> ${command} ${args.join(' ')}${where}`);
    execFileSync(command, args, Object.assign({stdio: 'inherit'}, options));
};

const checkout = commit => {
    const directory = path.join(cacheDirectory, commit);
    if (!fs.existsSync(path.join(directory, 'package.json'))) {
        fs.mkdirSync(cacheDirectory, {recursive: true});
        run('git', ['worktree', 'prune'], {cwd: repository});
        run('git', ['worktree', 'add', '--force', '--detach', directory, commit], {cwd: repository});
    }
    if (!fs.existsSync(path.join(directory, 'node_modules'))) run('npm', ['ci'], {cwd: directory});
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

const main = () => {
    const archived = list.versions.filter(entry => entry.version !== list.current &&
        (!only || only.includes(entry.version)));
    if (!archived.length) {
        console.log(`Only the current engine (${list.current}) is listed; nothing to build.`);
        return;
    }
    for (const entry of archived) {
        if (!/^[0-9a-f]{7,40}$/.test(entry.commit || '')) {
            throw new Error(`Engine ${entry.version} needs a commit id in engine-versions.json.`);
        }
        console.log(`\nBuilding engine ${entry.version} from ${entry.commit}`);
        const directory = checkout(entry.commit);
        assertEngine(directory, entry);
        run('npm', ['run', 'build'], {
            cwd: directory,
            env: Object.assign({}, process.env, {
                ROOT: `${root}engines/${entry.version}/`,
                SHADING_SITE_ROOT: root
            })
        });
        const destination = path.join(outputDirectory, entry.version);
        fs.rmSync(destination, {recursive: true, force: true});
        fs.mkdirSync(outputDirectory, {recursive: true});
        fs.cpSync(path.join(directory, 'build'), destination, {recursive: true});
    }
};

main();
