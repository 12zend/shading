import bundledVersions from '../../engine-versions.json';

// Every release of the editor (the "engine") is listed in engine-versions.json with the commit it was built from.
// The latest engine is served at the site root; older ones are built from their commits into engines/<version>/
// (scripts/build-engines.cjs). A .shade file records the version that saved it and opens in that engine.

const ENGINE_DIRECTORY = 'engines/';
const VERSIONS_FILE = 'engine-versions.json';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

// The version of this build. Archived engines keep the list from their own commit, so this stays their version.
const CURRENT_ENGINE_VERSION = bundledVersions.current;

/**
 * @param {unknown} list Parsed engine-versions.json.
 * @returns {?{current: string, versions: Array<{version: string, name: string, commit: string}>}} The list, or
 *   null when it is malformed.
 */
const validateEngineVersions = list => {
    if (!list || typeof list !== 'object' || !VERSION_PATTERN.test(list.current) || !Array.isArray(list.versions)) {
        return null;
    }
    const versions = list.versions.filter(entry => entry && typeof entry === 'object' &&
        VERSION_PATTERN.test(entry.version) && COMMIT_PATTERN.test(entry.commit));
    if (!versions.some(entry => entry.version === list.current)) return null;
    return {
        current: list.current,
        versions: versions.map(entry => ({
            version: entry.version,
            name: typeof entry.name === 'string' && entry.name ? entry.name : entry.version,
            commit: entry.commit
        }))
    };
};

// Where the latest engine lives. Archived engines are built with their own ROOT and the site root separately.
const getSiteRoot = () => process.env.SHADING_SITE_ROOT || process.env.ROOT || '/';

// Engines are separate pages of a hosted site; the TurboWarp extension build and file:// have none to switch to.
const canSwitchEngines = () => !process.env.SHADING_EXTENSION && typeof location !== 'undefined' &&
    (location.protocol === 'http:' || location.protocol === 'https:');

let latestVersionsPromise = null;

/**
 * The deployed list from the site root, which knows about versions released after this engine. Falls back to the
 * list bundled with this build.
 * @returns {Promise<object>} Validated engine list.
 */
const loadEngineVersions = () => {
    if (!latestVersionsPromise) {
        const bundled = validateEngineVersions(bundledVersions);
        latestVersionsPromise = (canSwitchEngines() && typeof fetch === 'function' ?
            fetch(`${getSiteRoot()}${VERSIONS_FILE}`, {cache: 'no-cache'})
                .then(response => (response.ok ? response.json() : null))
                .then(validateEngineVersions)
                .catch(() => null) :
            Promise.resolve(null))
            .then(latest => latest || bundled);
    }
    return latestVersionsPromise;
};

/**
 * @param {object} list Validated engine list.
 * @param {string} version Engine version.
 * @returns {?string} URL of that engine's editor, or null when it is not listed.
 */
const getEngineURL = (list, version) => {
    if (!list || !list.versions.some(entry => entry.version === version)) return null;
    const siteRoot = getSiteRoot();
    return version === list.current ? siteRoot : `${siteRoot}${ENGINE_DIRECTORY}${version}/`;
};

/**
 * The engine a project file should open in, when that is not this one.
 * @param {?string} version The file's .shade format version.
 * @returns {Promise<?{version: string, name: string, url: string}>} The engine, or null to open it here.
 */
const findEngineForVersion = async version => {
    if (!version || version === CURRENT_ENGINE_VERSION || !canSwitchEngines()) return null;
    const list = await loadEngineVersions();
    const url = getEngineURL(list, version);
    if (!url) return null;
    const entry = list.versions.find(candidate => candidate.version === version);
    return {version, name: entry.name, url};
};

const resetEngineVersionsCache = () => {
    latestVersionsPromise = null;
};

export {
    CURRENT_ENGINE_VERSION,
    ENGINE_DIRECTORY,
    VERSIONS_FILE,
    canSwitchEngines,
    findEngineForVersion,
    getEngineURL,
    getSiteRoot,
    loadEngineVersions,
    resetEngineVersionsCache,
    validateEngineVersions
};
