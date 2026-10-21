import JSZip from '@turbowarp/jszip';
import {
    MOVIE_PROJECT_EXTENSION,
    SHADING_PROJECT_KEY,
    SHADING_PROJECT_VERSION,
    assertSupportedProjectFormat,
    getShadingProjectVersion
} from './project-format';

// A saved .shade file carries the editor's browser data next to the project: every localStorage value (addon
// settings, theme, language, ...) and the installed plugin zips. The TurboWarp extension build keeps its storage on
// turbowarp.org, apart from shading.app, so the file is how settings and plugins move between the two.
// Restore points and the backpack stay in the browser: they are projects of their own, not settings.

const PROJECT_FILE_EXTENSION = `.${MOVIE_PROJECT_EXTENSION}`;
const PLUGIN_FILE_PREFIX = 'plugins/';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
// Never written into or read from a file: one lets a project grant itself unsandboxed extensions, the other
// would tell everyone the file is shared with who saved it.
const PRIVATE_STORAGE_KEYS = new Set(['tw:persisted_unsandboxed', 'tw:username']);
const SETTINGS_RESTORED_EVENT = 'SHADING_SETTINGS_RESTORED';

const isProjectFileName = name => typeof name === 'string' &&
    name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION);

/**
 * @param {string} fileName File name.
 * @returns {string} Project title (at most 100 characters), or '' when the file is not a .shade file.
 */
const getProjectTitleFromFileName = fileName => (
    isProjectFileName(fileName) ? fileName.slice(0, -PROJECT_FILE_EXTENSION.length).substring(0, 100) : ''
);

const getLocalStorage = () => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (e) {
        // Access to storage can throw when it is blocked.
        return null;
    }
};

/**
 * @returns {object<string, string>} The editor's localStorage, without private keys.
 */
const collectLocalStorage = () => {
    const storage = getLocalStorage();
    const values = {};
    if (!storage) return values;
    try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key !== null && !PRIVATE_STORAGE_KEYS.has(key)) keys.push(key);
        }
        for (const key of keys.sort()) {
            const value = storage.getItem(key);
            if (value !== null) values[key] = value;
        }
    } catch (e) {
        // ignore
    }
    return values;
};

/**
 * Write a file's localStorage values. Keys the file does not have are left alone.
 * @param {object<string, string>} values Saved values.
 * @returns {Array<string>} Keys whose value changed.
 */
const restoreLocalStorage = values => {
    const storage = getLocalStorage();
    if (!storage || !values || typeof values !== 'object' || Array.isArray(values)) return [];
    const changed = [];
    for (const key of Object.keys(values)) {
        const value = values[key];
        if (typeof value !== 'string' || PRIVATE_STORAGE_KEYS.has(key)) continue;
        try {
            if (storage.getItem(key) !== value) {
                storage.setItem(key, value);
                changed.push(key);
            }
        } catch (e) {
            // Storage is full or blocked; the rest may still fit.
        }
    }
    return changed;
};

const localizedNames = manifest => {
    const locales = manifest && manifest.locales && typeof manifest.locales === 'object' ? manifest.locales : {};
    return Object.keys(locales).reduce((names, locale) => {
        if (locales[locale] && typeof locales[locale].name === 'string') names[locale] = locales[locale].name;
        return names;
    }, {});
};

/**
 * Installed plugins, as the exact zips the user reviewed.
 * @param {VirtualMachine} vm The VM.
 * @returns {Array<{entry: object, data: Uint8Array}>} project.json entries and zip bytes.
 */
const collectInstalledPlugins = vm => {
    const manager = vm && vm.shadingPlugins;
    if (!manager || !manager.records) return [];
    const plugins = [];
    for (const record of manager.records.values()) {
        const stored = record.stored;
        // Plugins loaded for the session only (tests, embedders) have nothing stored to carry.
        if (!stored || !stored.data || !PLUGIN_ID_PATTERN.test(record.id)) continue;
        const manifest = record.manifest || {};
        plugins.push({
            entry: {
                id: record.id,
                name: manifest.name || record.id,
                localizedNames: localizedNames(manifest),
                version: manifest.version || '',
                description: manifest.description || '',
                fileName: stored.fileName || `${record.id}.zip`,
                hash: stored.hash || null,
                enabled: stored.enabled !== false
            },
            data: stored.data instanceof Uint8Array ? stored.data : new Uint8Array(stored.data)
        });
    }
    return plugins;
};

/**
 * @param {VirtualMachine} vm The VM.
 * @returns {object} Options for vm.saveProjectSb3() that add the browser settings and plugins to the file.
 */
const getProjectFileOptions = vm => {
    const plugins = collectInstalledPlugins(vm);
    return {
        extendProjectJSON: project => {
            project[SHADING_PROJECT_KEY] = Object.assign({version: SHADING_PROJECT_VERSION},
                project[SHADING_PROJECT_KEY], {
                    settings: {
                        localStorage: collectLocalStorage(),
                        plugins: plugins.map(plugin => plugin.entry)
                    }
                });
            return project;
        },
        extraFiles: plugins.map(plugin => ({
            fileName: `${PLUGIN_FILE_PREFIX}${plugin.entry.id}.zip`,
            fileContent: plugin.data
        }))
    };
};

/**
 * Save the project as a .shade file.
 * @param {VirtualMachine} vm The VM.
 * @param {string} [type] JSZip output type.
 * @returns {Promise<unknown>} The file.
 */
const saveProjectFile = (vm, type) => vm.saveProjectSb3(type, getProjectFileOptions(vm));

/**
 * @param {VirtualMachine} vm The VM.
 * @param {string} [type] JSZip output type.
 * @returns {StreamHelper} JSZip stream generating the .shade file.
 */
const saveProjectFileStream = (vm, type) => vm.saveProjectSb3Stream(type, getProjectFileOptions(vm));

/**
 * Read the format version of a project file without loading it.
 * @param {ArrayBuffer|Uint8Array} data The file.
 * @returns {Promise<?string>} The .shade version, or null when the file is not a readable .shade project.
 */
const readProjectFileVersion = async data => {
    try {
        const zip = await JSZip.loadAsync(data);
        // Like the VM's loader, accept a project.json inside a single folder.
        const file = zip.file('project.json') || zip.file(/(^|\/)project\.json$/)[0];
        if (!file) return null;
        return getShadingProjectVersion(JSON.parse(await file.async('string')));
    } catch (error) {
        return null;
    }
};

const createZipFile = (bytes, name) => (typeof File === 'function' ?
    new File([bytes], name, {type: 'application/zip'}) :
    Object.assign(new Blob([bytes], {type: 'application/zip'}), {name}));

const readProjectPlugins = async (entries, zip) => {
    if (!Array.isArray(entries) || !zip || typeof zip.file !== 'function') return [];
    const plugins = [];
    for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !PLUGIN_ID_PATTERN.test(entry.id)) continue;
        const file = zip.file(`${PLUGIN_FILE_PREFIX}${entry.id}.zip`);
        if (!file) continue;
        try {
            const bytes = await file.async('uint8array');
            plugins.push({
                id: entry.id,
                name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
                localizedNames: entry.localizedNames && typeof entry.localizedNames === 'object' ?
                    entry.localizedNames : {},
                version: typeof entry.version === 'string' ? entry.version : '',
                description: typeof entry.description === 'string' ? entry.description : '',
                file: createZipFile(bytes, `${entry.id}.zip`)
            });
        } catch (error) {
            console.error(`[project] Could not read plugin ${entry.id} from the project file:`, error);
        }
    }
    return plugins;
};

/**
 * Only .shade projects load. After a project loads, the browser settings saved in it are restored (the VM emits
 * SHADING_SETTINGS_RESTORED with the changed keys) and its plugins that are not installed are offered for the
 * regular install review: a project file never runs plugin code by itself.
 * @param {VirtualMachine} vm The VM. Install after every other deserializeProject hook so the check runs first.
 */
const installProjectFileHooks = vm => {
    if (!vm || vm.shadingProjectFileHooks || typeof vm.deserializeProject !== 'function') return;
    vm.shadingProjectFileHooks = true;
    const originalDeserialize = vm.deserializeProject.bind(vm);
    vm.deserializeProject = async (projectJSON, zip) => {
        // Rejecting before deserializing keeps the open project intact.
        assertSupportedProjectFormat(projectJSON);
        const format = projectJSON[SHADING_PROJECT_KEY];
        const settings = format && typeof format === 'object' && format.settings &&
            typeof format.settings === 'object' ? format.settings : null;
        const pluginsPromise = settings ? readProjectPlugins(settings.plugins, zip) : Promise.resolve([]);
        const result = await originalDeserialize(projectJSON, zip);
        if (settings) {
            const restored = restoreLocalStorage(settings.localStorage);
            if (restored.length && typeof vm.emit === 'function') vm.emit(SETTINGS_RESTORED_EVENT, restored);
            const plugins = await pluginsPromise;
            if (plugins.length && vm.shadingPlugins && typeof vm.shadingPlugins.offerSharedPlugins === 'function') {
                vm.shadingPlugins.offerSharedPlugins(plugins);
            }
        }
        return result;
    };
};

export {
    PRIVATE_STORAGE_KEYS,
    PROJECT_FILE_EXTENSION,
    SETTINGS_RESTORED_EVENT,
    collectInstalledPlugins,
    collectLocalStorage,
    getProjectFileOptions,
    getProjectTitleFromFileName,
    installProjectFileHooks,
    isProjectFileName,
    readProjectFileVersion,
    restoreLocalStorage,
    saveProjectFile,
    saveProjectFileStream
};
