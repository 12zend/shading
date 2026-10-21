// Records a new engine version after its features are committed (see docs/ENGINE_VERSIONS.md):
//   - the entry that is `current` gets the last commit of its version (`base`), so build:engines can build it;
//   - a new entry is appended with the commit that introduced the new version's features;
//   - `current` and SHADING_PROJECT_VERSION move to the new version.
// The edits are left uncommitted; review them and commit them as `chore(engine): release Shading <version>`.
//
// Usage: node scripts/release-engine.cjs [version] [--name=<name>] [--base=<commit>] [--commit=<commit>] [--dry-run]
//   version      new version (default: next minor version)
//   --name       display name shown when switching engines (default: "Shading <version>")
//   --base       last commit of the outgoing version (default: parent of the oldest feat commit since the list
//                last changed)
//   --commit     commit to record for the new version (default: newest feat commit since the list last changed)
//   --dry-run    print the new list without writing anything
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const repository = path.resolve(__dirname, '..');
const LIST_FILE = 'engine-versions.json';
const FORMAT_FILE = path.join('scratch-vm', 'src', 'lib', 'project-format.js');
const HANDOFF_FILE = 'src/lib/engine-handoff.js';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FORMAT_VERSION_PATTERN = /const SHADING_PROJECT_VERSION = '([^']*)';/;
const FEAT_SUBJECT = /^feat(\([^)]*\))?!?:/;

const git = (...args) => execFileSync('git', args, {cwd: repository, encoding: 'utf8'}).trim();

const parseVersion = version => version.split('.').map(Number);
const compareVersions = (a, b) => {
    const left = parseVersion(a);
    const right = parseVersion(b);
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
};
const nextMinor = version => {
    const [major, minor] = parseVersion(version);
    return `${major}.${minor + 1}.0`;
};

const resolveCommit = reference => {
    try {
        return git('rev-parse', '--verify', '--quiet', `${reference}^{commit}`);
    } catch (error) {
        throw new Error(`${reference} is not a commit in this repository.`);
    }
};

// feat commits since engine-versions.json last changed, oldest first.
const findFeatureCommits = () => {
    const listCommit = git('log', '-1', '--format=%H', '--', LIST_FILE);
    const range = listCommit ? `${listCommit}..HEAD` : 'HEAD';
    return git('log', '--reverse', '--format=%H %s', range)
        .split('\n')
        .filter(Boolean)
        .map(line => ({hash: line.slice(0, 40), subject: line.slice(41)}))
        .filter(commit => FEAT_SUBJECT.test(commit.subject));
};

const readAt = (commit, file) => {
    try {
        return git('show', `${commit}:${file}`);
    } catch (error) {
        return null;
    }
};

const main = () => {
    const args = process.argv.slice(2);
    const option = name => {
        const found = args.find(argument => argument.startsWith(`--${name}=`));
        return found ? found.slice(name.length + 3) : null;
    };
    const dryRun = args.includes('--dry-run');
    const positional = args.filter(argument => !argument.startsWith('--'));

    const listPath = path.join(repository, LIST_FILE);
    const formatPath = path.join(repository, FORMAT_FILE);
    if (git('status', '--porcelain', '--', LIST_FILE, FORMAT_FILE)) {
        throw new Error(`${LIST_FILE} or ${FORMAT_FILE} has uncommitted changes; commit or stash them first.`);
    }
    const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    const formatSource = fs.readFileSync(formatPath, 'utf8');
    const formatMatch = formatSource.match(FORMAT_VERSION_PATTERN);
    if (!formatMatch) throw new Error(`SHADING_PROJECT_VERSION was not found in ${FORMAT_FILE}.`);
    if (formatMatch[1] !== list.current) {
        throw new Error(`SHADING_PROJECT_VERSION (${formatMatch[1]}) and current (${list.current}) differ.`);
    }
    const outgoing = list.versions.find(entry => entry.version === list.current);
    if (!outgoing) throw new Error(`current (${list.current}) is not listed in ${LIST_FILE}.`);

    const version = positional[0] || nextMinor(list.current);
    if (!VERSION_PATTERN.test(version)) throw new Error(`${version} is not MAJOR.MINOR.PATCH.`);
    for (const entry of list.versions) {
        if (compareVersions(version, entry.version) <= 0) {
            throw new Error(`${version} must be higher than every listed version (${entry.version} is listed).`);
        }
    }

    const features = findFeatureCommits();
    const baseReference = option('base') || (features.length ? `${features[0].hash}^` : null);
    const commitReference = option('commit') || (features.length ? features[features.length - 1].hash : null);
    if (!baseReference || !commitReference) {
        throw new Error(`No feat commit since ${LIST_FILE} last changed. Pass --base and --commit explicitly.`);
    }
    const base = resolveCommit(baseReference);
    const commit = resolveCommit(commitReference);

    // build:engines will check out `base` as the archived engine, so it has to be a working engine of that version.
    const baseList = readAt(base, LIST_FILE);
    if (!baseList || JSON.parse(baseList).current !== list.current) {
        throw new Error(`${base} is not engine ${list.current}; --base must be the last commit of that version.`);
    }
    if (readAt(base, HANDOFF_FILE) === null) {
        throw new Error(`${base} predates engine switching (${HANDOFF_FILE}); pick a later --base.`);
    }

    const updated = {
        current: version,
        versions: list.versions
            .map(entry => (entry === outgoing ? Object.assign({}, entry, {commit: base}) : entry))
            .concat({
                version,
                name: option('name') || `Shading ${version}`,
                commit,
                date: git('log', '-1', '--format=%cs', commit)
            })
    };
    const json = `${JSON.stringify(updated, null, 2)}\n`;

    console.log(`Engine ${list.current} is built from ${base}`);
    console.log(`Engine ${version} records ${commit}`);
    if (dryRun) {
        console.log(json);
        return;
    }
    fs.writeFileSync(listPath, json);
    fs.writeFileSync(formatPath, formatSource.replace(FORMAT_VERSION_PATTERN,
        `const SHADING_PROJECT_VERSION = '${version}';`));
    console.log(`Updated ${LIST_FILE} and ${FORMAT_FILE}. Commit them as "chore(engine): release Shading ${version}".`);
};

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
