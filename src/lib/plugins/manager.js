import EventEmitter from 'events';
import {markMovieProject} from '../../../scratch-vm/src/lib/project-format';
import {readPluginArchive} from './archive';
import {scanPlugin} from './security-scan';
import {createModuleSystem} from './module-loader';
import {createPluginAPI} from './api';
import {createDefaultStorage} from './storage';
import legacyOpcodes from './legacy-plugin-opcodes.json';

// Plugins extend shading.app with arbitrary JavaScript: blocks, renderer effects, editor tabs, project data. The
// user reviews each zip (with the static security scan) before it is installed; installed plugins are stored and
// activated again at start-up before any project loads. Projects record which plugins their blocks and data come
// from, so opening a project without them names what is missing instead of losing work.

const PROJECT_KEY = 'shadingPlugins';
// Project keys that belong to shading.app itself and can never be claimed by plugin data.
const RESERVED_PROJECT_KEYS = new Set([
    'targets', 'monitors', 'extensions', 'extensionURLs', 'extensionStorage', 'meta', 'customFonts',
    PROJECT_KEY, 'penFXShaders', 'movie', 'movieAssets', 'movieTimeline', 'timeline'
]);

const LEGACY_OPCODE_OWNERS = new Map();
for (const pluginId of Object.keys(legacyOpcodes.plugins)) {
    for (const opcode of legacyOpcodes.plugins[pluginId]) LEGACY_OPCODE_OWNERS.set(opcode, pluginId);
}
const legacyOwnerOf = opcode => LEGACY_OPCODE_OWNERS.get(opcode) ||
    (new RegExp(legacyOpcodes.genshadePattern).test(opcode) ? 'genshade' : null);

const readFileAsArrayBuffer = file => {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read the plugin file.'));
        reader.readAsArrayBuffer(file);
    });
};

const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const localizedManifest = (manifest, locale) => {
    const localized = manifest.locales && manifest.locales[locale];
    return {
        name: (localized && localized.name) || manifest.name,
        description: (localized && localized.description) || manifest.description
    };
};

// Extension categories registered by plugins go through a proxy that stays registered with the VM. Disabling the
// plugin empties the category instead of unloading it, and a project that needs a missing plugin still loads.
const createExtensionProxy = id => {
    const proxy = {id, delegate: null, pluginId: null, missingName: null, knownFunctions: new Set()};
    proxy.object = new Proxy({}, {
        get: (target, property) => {
            if (property === 'getInfo') {
                return () => {
                    if (proxy.delegate) {
                        const info = Object.assign({}, proxy.delegate.getInfo());
                        info.id = id;
                        // Remember block and menu functions so they stay callable (as no-ops) when disabled.
                        for (const block of info.blocks || []) {
                            if (block && typeof block === 'object') {
                                if (block.opcode) proxy.knownFunctions.add(block.func || block.opcode);
                            }
                        }
                        for (const menu of Object.values(info.menus || {})) {
                            if (menu && typeof menu.items === 'string') proxy.knownFunctions.add(menu.items);
                        }
                        return info;
                    }
                    return {id, name: proxy.missingName || id, blocks: [], menus: {}};
                };
            }
            const delegate = proxy.delegate;
            if (!delegate) {
                // Unknown properties must read as absent (dispatch treats a truthy `isRemote` as a worker).
                if (typeof property === 'string' && proxy.knownFunctions.has(property)) return () => null;
                return target[property];
            }
            const value = delegate[property];
            return typeof value === 'function' ? value.bind(delegate) : value;
        },
        has: (target, property) => Boolean(proxy.delegate && property in proxy.delegate)
    });
    return proxy;
};

class ShadingPluginManager extends EventEmitter {
    /**
     * @param {object} vm VM with Shading features installed.
     * @param {object} [options] Options.
     * @param {object} [options.storage] Plugin storage (IndexedDB by default).
     * @param {object} [options.guiContext] Editor React and components shared with plugins (shading.gui.react).
     */
    constructor (vm, options = {}) {
        super();
        this.setMaxListeners(50);
        this.vm = vm;
        this.storage = options.storage || createDefaultStorage();
        this.guiContext = options.guiContext ? Object.freeze(Object.assign({}, options.guiContext)) : null;
        this.records = new Map();
        this.tabs = [];
        this.menuItems = [];
        this.blockDefiners = new Map();
        this.toolboxFilters = new Map();
        this.projectData = new Map();
        this.loadListeners = new Set();
        this.extensionProxies = new Map();
        this.penFXMethods = new Map();
        this.orphanData = new Map();
        this.projectReferences = [];
        this.missingPlugins = [];
        this.pendingReview = null;
        this.hooksInstalled = false;
        this.installProjectHooks();
        this.ready = Promise.resolve();
    }

    /**
     * Load the installed plugins. Project loading waits for this.
     * @returns {Promise} Resolves when every enabled plugin has activated or failed.
     */
    init () {
        this.ready = (async () => {
            let stored = [];
            try {
                stored = await this.storage.list();
            } catch (error) {
                console.error('[plugins] Could not read installed plugins:', error);
            }
            for (const entry of stored) {
                try {
                    const archive = await readPluginArchive(entry.data, entry.fileName);
                    // The stored bytes are what the user reviewed; a mismatch means storage was tampered with.
                    if (entry.hash && archive.hash !== entry.hash) {
                        throw new Error('The stored plugin does not match the reviewed archive.');
                    }
                    this.records.set(archive.manifest.id, this._createRecord(archive, entry));
                } catch (error) {
                    console.error(`[plugins] Could not load installed plugin ${entry.id}:`, error);
                    this.records.set(entry.id, {
                        id: entry.id,
                        manifest: {id: entry.id,
                            name: entry.id,
                            version: '',
                            description: '',
                            locales: {},
                            dependencies: [],
                            recommends: [],
                            permissions: []},
                        files: new Map(),
                        enabled: false,
                        state: 'error',
                        error: error.message,
                        stored: entry
                    });
                }
            }
            await this._activateAll();
            this.emit('changed');
        })();
        return this.ready;
    }

    _createRecord (archive, stored) {
        return {
            id: archive.manifest.id,
            manifest: archive.manifest,
            files: archive.files,
            hash: archive.hash,
            size: archive.size,
            scan: stored.scan || null,
            enabled: stored.enabled !== false,
            installedAt: stored.installedAt || Date.now(),
            fileName: stored.fileName || archive.fileName,
            state: 'inactive',
            error: null,
            dispose: null,
            exports: null,
            readyPromise: null,
            stored
        };
    }

    // Activate enabled plugins with their dependencies first.
    async _activateAll () {
        const visiting = new Set();
        const ordered = [];
        const visit = record => {
            if (!record || ordered.includes(record) || visiting.has(record.id)) return;
            visiting.add(record.id);
            for (const dependency of record.manifest.dependencies || []) visit(this.records.get(dependency));
            visiting.delete(record.id);
            ordered.push(record);
        };
        for (const record of this.records.values()) visit(record);
        for (const record of ordered) {
            if (record.enabled && record.state !== 'error') this._activate(record);
        }
        await Promise.all(ordered.map(record => record.readyPromise).filter(Boolean));
    }

    _activate (record) {
        if (record.state === 'active' || record.state === 'loading') return record.readyPromise;
        const missing = (record.manifest.dependencies || []).filter(id => !this.isActive(id));
        for (const id of missing) {
            const dependency = this.records.get(id);
            if (dependency && dependency.enabled) this._activate(dependency);
        }
        const stillMissing = (record.manifest.dependencies || []).filter(id => !this.isActive(id));
        if (stillMissing.length) {
            record.state = 'error';
            record.error = `Requires plugin: ${stillMissing.join(', ')}`;
            this.emit('changed');
            return null;
        }
        const {api, dispose} = createPluginAPI(this, record);
        record.dispose = dispose;
        record.error = null;
        let result;
        try {
            const modules = createModuleSystem({pluginId: record.id, files: record.files, api});
            const exports = modules.require(`./${record.manifest.main}`);
            const activate = typeof exports === 'function' ? exports : exports && exports.activate;
            if (typeof activate !== 'function') {
                throw new Error(`${record.manifest.main} must export activate(shading).`);
            }
            record.exports = exports;
            record.state = 'loading';
            result = activate(api);
        } catch (error) {
            console.error(`[plugins] ${record.id} failed to activate:`, error);
            dispose();
            record.dispose = null;
            record.state = 'error';
            record.error = (error && error.message) || String(error);
            this.emit('changed');
            return null;
        }
        record.readyPromise = Promise.resolve(result).then(() => {
            if (record.state === 'loading') record.state = 'active';
            this._afterActivation(record);
            this.emit('changed');
        }, error => {
            // Registrations made before the failure stay in place: the synchronous part already succeeded.
            console.error(`[plugins] ${record.id} failed while loading:`, error);
            if (record.state === 'loading') record.state = 'active';
            record.error = (error && error.message) || String(error);
            this.emit('changed');
        });
        // Blocks are usable as soon as activate() returns; asynchronous loading only delays readiness.
        if (record.state === 'loading') record.state = 'active';
        this.emit('changed');
        return record.readyPromise;
    }

    _afterActivation (record) {
        // A project opened before the plugin was installed may be waiting for it.
        if (this.missingPlugins.some(plugin => plugin.id === record.id)) {
            this.missingPlugins = this.missingPlugins.filter(plugin => plugin.id !== record.id);
            this.emit('missingPlugins', this.missingPlugins);
            this._reloadWorkspaceSoon();
        }
    }

    // Placeholders drawn for the plugin's blocks become real blocks once its definitions are registered.
    _reloadWorkspaceSoon () {
        const penFX = this.vm.runtime.penFX;
        const pending = penFX && penFX.customShaders && penFX.customShaders.refreshPromise;
        Promise.resolve(pending).then(() => setTimeout(() => {
            if (this.vm.editingTarget && typeof this.vm.emitWorkspaceUpdate === 'function') {
                this.vm.emitWorkspaceUpdate();
            }
        }, 0));
    }

    _deactivate (record) {
        if (record.state !== 'active' && record.state !== 'loading') return;
        try {
            if (record.exports && typeof record.exports.deactivate === 'function') record.exports.deactivate();
        } catch (error) {
            console.error(`[plugins] ${record.id} failed to deactivate:`, error);
        }
        if (record.dispose) record.dispose();
        record.dispose = null;
        record.exports = null;
        record.readyPromise = null;
        record.state = 'inactive';
        // Plugins that depend on this one cannot keep running.
        for (const other of this.records.values()) {
            if ((other.manifest.dependencies || []).includes(record.id)) this._deactivate(other);
        }
    }

    isActive (id) {
        const record = this.records.get(id);
        return Boolean(record && record.state === 'active');
    }

    // Module exports of an active plugin, so plugins can offer APIs to each other.
    getExports (id) {
        const record = this.records.get(id);
        return record && record.state === 'active' ? record.exports : null;
    }

    whenReady (id) {
        const record = this.records.get(id);
        return (record && record.readyPromise) || null;
    }

    getPlugins (locale = 'en') {
        return Array.from(this.records.values()).map(record => {
            const localized = localizedManifest(record.manifest, locale);
            return {
                id: record.id,
                name: localized.name,
                description: localized.description,
                version: record.manifest.version,
                author: record.manifest.author,
                homepage: record.manifest.homepage,
                license: record.manifest.license,
                permissions: record.manifest.permissions || [],
                enabled: record.enabled,
                state: record.state,
                error: record.error,
                size: record.size,
                hash: record.hash,
                installedAt: record.installedAt,
                scanLevel: record.scan ? record.scan.level : null,
                missingRecommendations: (record.manifest.recommends || []).filter(id => !this.records.has(id))
            };
        });
    }

    // ---- Installing ----------------------------------------------------------------------------------------

    /**
     * Read and scan a zip without running anything.
     * @param {Blob|ArrayBuffer|Uint8Array} file Plugin archive.
     * @param {string} [fileName] File name.
     * @returns {Promise<object>} Review data: {archive, scan, existing}.
     */
    async inspect (file, fileName = (file && file.name) || 'plugin.zip') {
        const data = file && typeof file.arrayBuffer !== 'function' && typeof Blob !== 'undefined' &&
            file instanceof Blob ? await readFileAsArrayBuffer(file) : file;
        const archive = await readPluginArchive(data, fileName);
        const scan = scanPlugin(archive);
        const existing = this.records.get(archive.manifest.id) || null;
        return {
            archive,
            scan,
            manifest: archive.manifest,
            existing: existing ? {
                version: existing.manifest.version,
                sameArchive: existing.hash === archive.hash
            } : null
        };
    }

    /**
     * Install a reviewed archive (replacing an installed plugin with the same id) and activate it.
     * @param {object} review Result of inspect().
     * @returns {Promise<object>} The plugin summary.
     */
    async install (review) {
        const archive = review.archive;
        const id = archive.manifest.id;
        const previous = this.records.get(id);
        if (previous) this._deactivate(previous);
        const stored = {
            id,
            data: toArrayBuffer(archive.bytes),
            hash: archive.hash,
            fileName: archive.fileName,
            enabled: true,
            installedAt: (previous && previous.installedAt) || Date.now(),
            scan: {
                level: review.scan.level,
                summary: review.scan.summary,
                undeclaredPermissions: review.scan.undeclaredPermissions
            }
        };
        try {
            await this.storage.put(stored);
        } catch (error) {
            console.error('[plugins] Could not save the plugin; it will be removed when the editor closes:', error);
        }
        const record = this._createRecord(archive, stored);
        this.records.set(id, record);
        const ready = this._activate(record);
        // Plugins that were waiting for this dependency can start now.
        for (const other of this.records.values()) {
            if (other !== record && other.enabled && other.state === 'error' &&
                (other.manifest.dependencies || []).includes(id)) {
                other.state = 'inactive';
                this._activate(other);
            }
        }
        this.emit('changed');
        if (ready) await ready;
        if (record.state === 'error') throw new Error(record.error);
        return this.getPlugins().find(plugin => plugin.id === id);
    }

    /**
     * Activate an already-read archive for this session only, without review or storage. Used by tests and by
     * embedders that bundle trusted plugins.
     * @param {object} archive Result of readPluginArchive (or an equivalent {manifest, files}).
     * @returns {object} The plugin record.
     */
    loadArchive (archive) {
        const id = archive.manifest.id;
        const previous = this.records.get(id);
        if (previous) this._deactivate(previous);
        const record = this._createRecord(Object.assign({hash: null, size: 0}, archive), {enabled: true});
        this.records.set(id, record);
        this._activate(record);
        this.emit('changed');
        return record;
    }

    async setEnabled (id, enabled) {
        const record = this.records.get(id);
        if (!record) return;
        record.enabled = Boolean(enabled);
        if (record.stored) {
            record.stored.enabled = record.enabled;
            try {
                await this.storage.put(record.stored);
            } catch (error) {
                console.error('[plugins] Could not save the plugin state:', error);
            }
        }
        if (record.enabled) {
            if (record.state === 'error') record.state = 'inactive';
            this._activate(record);
        } else {
            this._deactivate(record);
        }
        this.emit('changed');
    }

    async uninstall (id) {
        const record = this.records.get(id);
        if (!record) return;
        this._deactivate(record);
        this.records.delete(id);
        try {
            await this.storage.remove(id);
        } catch (error) {
            console.error('[plugins] Could not remove the stored plugin:', error);
        }
        this.emit('changed');
    }

    // The code area's add button opens a file picker; the chosen zip is scanned and shown for review.
    openImportPicker () {
        if (typeof document === 'undefined' || !document.body) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip,application/x-zip-compressed';
        input.hidden = true;
        const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            cleanup();
            if (file) this.requestReview(file);
        }, {once: true});
        document.body.appendChild(input);
        input.click();
        if (typeof window !== 'undefined') window.addEventListener('focus', () => setTimeout(cleanup, 0), {once: true});
    }

    async requestReview (file) {
        this.emit('reviewLoading', {fileName: file && file.name});
        try {
            this.pendingReview = await this.inspect(file);
            this.emit('review', this.pendingReview);
        } catch (error) {
            this.pendingReview = null;
            this.emit('reviewError', {fileName: file && file.name, message: error.message});
        }
    }

    confirmReview () {
        const review = this.pendingReview;
        this.pendingReview = null;
        if (!review) return Promise.resolve(null);
        return this.install(review);
    }

    cancelReview () {
        this.pendingReview = null;
        this.emit('reviewClosed');
    }

    openManager () {
        this.emit('openManager');
    }

    notify (pluginId, message) {
        this.emit('notify', {pluginId, message: String(message)});
    }

    // ---- Registries used by the API --------------------------------------------------------------------------

    extendPenFX (methods, pluginId = null) {
        const penFX = this.vm.runtime.penFX;
        if (!penFX) throw new Error('PenFX is not available.');
        const prototype = Object.getPrototypeOf(penFX);
        const names = Object.keys(methods);
        for (const name of names) {
            if (typeof methods[name] !== 'function') throw new TypeError(`PenFX method ${name} must be a function.`);
            if (!this.penFXMethods.has(name) && typeof prototype[name] !== 'undefined') {
                throw new Error(`PenFX.${name} belongs to shading.app and cannot be replaced by a plugin.`);
            }
        }
        const entry = {methods, pluginId};
        for (const name of names) {
            if (!this.penFXMethods.has(name)) this.penFXMethods.set(name, []);
            this.penFXMethods.get(name).push(entry);
            prototype[name] = methods[name];
        }
        return () => {
            for (const name of names) {
                const stack = this.penFXMethods.get(name) || [];
                const index = stack.indexOf(entry);
                if (index >= 0) stack.splice(index, 1);
                if (stack.length) {
                    prototype[name] = stack[stack.length - 1].methods[name];
                } else {
                    this.penFXMethods.delete(name);
                    delete prototype[name];
                }
            }
        };
    }

    registerExtension (pluginId, extensionObject) {
        if (!extensionObject || typeof extensionObject.getInfo !== 'function') {
            throw new TypeError('An extension needs a getInfo() method.');
        }
        const info = extensionObject.getInfo();
        const id = String((info && info.id) || '');
        if (!/^[a-z0-9]+$/i.test(id)) throw new Error('Extension id must use letters and numbers only.');
        const extensionManager = this.vm.extensionManager;
        let proxy = this.extensionProxies.get(id);
        if (!proxy && extensionManager.isExtensionLoaded(id)) {
            throw new Error(`Extension ${id} belongs to shading.app or another extension.`);
        }
        if (proxy && proxy.delegate) throw new Error(`Extension ${id} is already registered by ${proxy.pluginId}.`);
        if (!proxy) proxy = this._ensureExtensionProxy(id);
        proxy.delegate = extensionObject;
        proxy.pluginId = pluginId;
        this.refreshExtension(id);
        return () => {
            if (proxy.delegate !== extensionObject) return;
            proxy.delegate = null;
            proxy.pluginId = null;
            proxy.missingName = `${info.name || id} (plugin disabled)`;
            this.refreshExtension(id);
        };
    }

    _ensureExtensionProxy (id, missingName) {
        let proxy = this.extensionProxies.get(id);
        if (proxy) return proxy;
        proxy = createExtensionProxy(id);
        proxy.missingName = missingName || null;
        this.extensionProxies.set(id, proxy);
        const extensionManager = this.vm.extensionManager;
        // addBuiltinExtension expects a constructor; returning an object from it yields the proxy itself.
        class PluginExtension {
            constructor () {
                return proxy.object;
            }
        }
        extensionManager.addBuiltinExtension(id, PluginExtension);
        extensionManager.loadExtensionIdSync(id);
        return proxy;
    }

    refreshExtension (id) {
        const extensionManager = this.vm.extensionManager;
        if (!extensionManager || !extensionManager.isExtensionLoaded(id)) return Promise.resolve();
        return Promise.resolve(extensionManager.refreshBlocks(id)).catch(error => {
            console.error(`[plugins] Could not refresh extension ${id}:`, error);
        });
    }

    _refreshCategory (categoryId) {
        if (categoryId === 'penfx' && this.vm.runtime.penFX) {
            return this.vm.runtime.penFX.customShaders._scheduleRefresh();
        }
        return this.refreshExtension(categoryId);
    }

    addBlockDefiner (categoryId, callback) {
        if (typeof callback !== 'function') throw new TypeError('blocks.define needs a function.');
        const id = String(categoryId);
        if (!this.blockDefiners.has(id)) this.blockDefiners.set(id, new Set());
        this.blockDefiners.get(id).add(callback);
        this._refreshCategory(id);
        return () => {
            const set = this.blockDefiners.get(id);
            if (set) set.delete(callback);
            this._refreshCategory(id);
        };
    }

    /**
     * Called by the GUI after it defines a category's blocks.
     * @param {string} categoryId Extension/category id.
     * @param {object} ScratchBlocks scratch-blocks.
     * @param {object} context {locale, vm}.
     */
    defineBlocks (categoryId, ScratchBlocks, context) {
        for (const callback of this.blockDefiners.get(categoryId) || []) {
            try {
                callback(ScratchBlocks, context);
            } catch (error) {
                console.error(`[plugins] Could not define blocks for ${categoryId}:`, error);
            }
        }
    }

    addToolboxFilter (categoryId, callback) {
        if (typeof callback !== 'function') throw new TypeError('blocks.filterToolboxXML needs a function.');
        const id = String(categoryId);
        if (!this.toolboxFilters.has(id)) this.toolboxFilters.set(id, new Set());
        this.toolboxFilters.get(id).add(callback);
        this._toolboxChanged();
        return () => {
            const set = this.toolboxFilters.get(id);
            if (set) set.delete(callback);
            this._toolboxChanged();
        };
    }

    // The code area subscribes through the VM because it can mount before the manager exists.
    _toolboxChanged () {
        this.emit('toolboxChanged');
        if (typeof this.vm.emit === 'function') this.vm.emit('SHADING_PLUGINS_TOOLBOX_CHANGED');
    }

    filterToolboxXML (categoryId, xml) {
        let result = xml;
        for (const callback of this.toolboxFilters.get(categoryId) || []) {
            try {
                const next = callback(result);
                if (typeof next === 'string') result = next;
            } catch (error) {
                console.error(`[plugins] Toolbox filter for ${categoryId} failed:`, error);
            }
        }
        return result;
    }

    addTab (pluginId, tab) {
        if (!tab || (typeof tab.mount !== 'function' && typeof tab.component !== 'function')) {
            throw new TypeError('A tab needs a React component or a mount(container) function.');
        }
        const entry = {
            key: `${pluginId}:${tab.id || this.tabs.length}`,
            pluginId,
            label: tab.label || pluginId,
            icon: tab.icon || null,
            component: typeof tab.component === 'function' ? tab.component : null,
            mount: typeof tab.mount === 'function' ? tab.mount : null
        };
        this.tabs.push(entry);
        this.emit('tabsChanged', this.getTabs());
        return () => {
            this.tabs = this.tabs.filter(candidate => candidate !== entry);
            this.emit('tabsChanged', this.getTabs());
        };
    }

    getTabs () {
        return this.tabs.slice();
    }

    addMenuItem (pluginId, item) {
        if (!item || typeof item.onClick !== 'function') throw new TypeError('A menu item needs onClick().');
        const entry = {
            key: `${pluginId}:${item.id || this.menuItems.length}`,
            pluginId,
            label: item.label,
            onClick: item.onClick
        };
        this.menuItems.push(entry);
        this.emit('menuChanged', this.getMenuItems());
        return () => {
            this.menuItems = this.menuItems.filter(candidate => candidate !== entry);
            this.emit('menuChanged', this.getMenuItems());
        };
    }

    getMenuItems () {
        return this.menuItems.slice();
    }

    registerProjectData (pluginId, key, handlers) {
        const name = String(key);
        if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) throw new Error(`Invalid project data key: ${name}`);
        if (RESERVED_PROJECT_KEYS.has(name) || /^movie/i.test(name)) {
            throw new Error(`Project data key ${name} is reserved.`);
        }
        if (this.projectData.has(name)) throw new Error(`Project data key ${name} is already used.`);
        if (!handlers || typeof handlers.serialize !== 'function') {
            throw new TypeError('registerData needs serialize().');
        }
        const entry = {pluginId, key: name, handlers};
        this.projectData.set(name, entry);
        // Data saved by this plugin in the open project arrived before the plugin did: hand it over now.
        if (this.orphanData.has(name)) {
            const value = this.orphanData.get(name);
            this.orphanData.delete(name);
            this._deserializeData(entry, value);
        }
        return () => {
            if (this.projectData.get(name) !== entry) return;
            this.projectData.delete(name);
            // Keep the project's data while the plugin is disabled so saving does not drop it.
            try {
                const value = handlers.serialize();
                if (typeof value !== 'undefined') this.orphanData.set(name, value);
            } catch (error) {
                console.error(`[plugins] Could not keep ${name}:`, error);
            }
        };
    }

    addLoadListener (callback) {
        if (typeof callback !== 'function') throw new TypeError('project.onLoad needs a function.');
        this.loadListeners.add(callback);
        return () => this.loadListeners.delete(callback);
    }

    _deserializeData (entry, value) {
        if (typeof entry.handlers.deserialize !== 'function') return Promise.resolve();
        return Promise.resolve()
            .then(() => entry.handlers.deserialize(value))
            .catch(error => console.error(`[plugins] ${entry.pluginId} could not load ${entry.key}:`, error));
    }

    // ---- Project integration ---------------------------------------------------------------------------------

    installProjectHooks () {
        const vm = this.vm;
        if (this.hooksInstalled || !vm || typeof vm.toJSON !== 'function' ||
            typeof vm.deserializeProject !== 'function') return;
        this.hooksInstalled = true;
        const originalToJSON = vm.toJSON.bind(vm);
        vm.toJSON = (targetId, serializationOptions) => {
            const project = JSON.parse(originalToJSON(targetId, serializationOptions));
            let changed = false;
            if (!targetId) {
                for (const entry of this.projectData.values()) {
                    try {
                        const value = entry.handlers.serialize();
                        if (typeof value === 'undefined') {
                            delete project[entry.key];
                        } else {
                            project[entry.key] = value;
                            changed = true;
                        }
                    } catch (error) {
                        console.error(`[plugins] ${entry.pluginId} could not save ${entry.key}:`, error);
                    }
                }
                for (const [key, value] of this.orphanData) {
                    project[key] = value;
                    changed = true;
                }
            }
            const references = this.collectReferences(project);
            if (references.length) {
                project[PROJECT_KEY] = references;
                changed = true;
            } else {
                delete project[PROJECT_KEY];
            }
            return JSON.stringify(changed && !targetId ? markMovieProject(project) : project);
        };
        const originalDeserialize = vm.deserializeProject.bind(vm);
        vm.deserializeProject = async (projectJSON, zip) => {
            await this.ready;
            this.orphanData.clear();
            const references = projectJSON && Array.isArray(projectJSON[PROJECT_KEY]) ?
                projectJSON[PROJECT_KEY].filter(reference => reference && typeof reference.id === 'string') : [];
            this.projectReferences = references;
            const missing = new Map();
            for (const reference of references) {
                if (this.isActive(reference.id)) continue;
                missing.set(reference.id, {
                    id: reference.id,
                    name: String(reference.name || reference.id),
                    version: String(reference.version || '')
                });
                // Blocks of a missing plugin's own category still need a loaded extension to deserialize.
                for (const extensionId of reference.extensions || []) {
                    if (/^[a-z0-9]+$/i.test(extensionId) && !this.vm.extensionManager.isExtensionLoaded(extensionId)) {
                        this._ensureExtensionProxy(extensionId, `${reference.name || reference.id} (plugin missing)`);
                    }
                }
            }
            for (const opcode of this._unknownPenFXOpcodes(projectJSON)) {
                const owner = legacyOwnerOf(opcode);
                const id = owner || 'unknown';
                if (owner && this.isActive(owner)) continue;
                if (!missing.has(id)) {
                    missing.set(id, {
                        id,
                        name: owner ? (legacyOpcodes.names[owner] || owner) : '',
                        version: '',
                        opcodes: []
                    });
                }
                const entry = missing.get(id);
                entry.opcodes = (entry.opcodes || []).concat(`penfx_${opcode}`);
            }
            this.missingPlugins = Array.from(missing.values());
            const data = [];
            for (const entry of this.projectData.values()) {
                data.push(this._deserializeData(entry, projectJSON ? projectJSON[entry.key] : null));
            }
            for (const reference of references) {
                for (const key of reference.dataKeys || []) {
                    if (!this.projectData.has(key) && projectJSON && typeof projectJSON[key] !== 'undefined' &&
                        !RESERVED_PROJECT_KEYS.has(key)) {
                        this.orphanData.set(key, projectJSON[key]);
                    }
                }
            }
            for (const listener of this.loadListeners) {
                data.push(Promise.resolve().then(() => listener(projectJSON))
                    .catch(error => console.error('[plugins] Project load hook failed:', error)));
            }
            await Promise.all(data);
            const result = await originalDeserialize(projectJSON, zip);
            this.emit('missingPlugins', this.missingPlugins);
            return result;
        };
    }

    _projectOpcodes (project) {
        const opcodes = new Set();
        for (const target of project && Array.isArray(project.targets) ? project.targets : []) {
            const blocks = target && target.blocks;
            if (!blocks || typeof blocks !== 'object') continue;
            for (const id of Object.keys(blocks)) {
                const block = blocks[id];
                if (block && typeof block === 'object' && !Array.isArray(block) && typeof block.opcode === 'string') {
                    opcodes.add(block.opcode);
                }
            }
        }
        return opcodes;
    }

    // Looks blocks that neither shading.app nor an active plugin provides.
    _unknownPenFXOpcodes (project) {
        const penFX = this.vm.runtime.penFX;
        const known = new Set();
        if (penFX) {
            for (const opcodes of penFX.customShaders.getPluginOpcodes().values()) {
                for (const opcode of opcodes) known.add(opcode);
            }
        }
        const unknown = [];
        for (const opcode of this._projectOpcodes(project)) {
            if (!opcode.startsWith('penfx_') || opcode.startsWith('penfx_menu_')) continue;
            const name = opcode.slice('penfx_'.length);
            if (known.has(name) || this.penFXMethods.has(name)) continue;
            // Custom shader packages travel inside the project; core blocks are always present.
            if (/^shader_/.test(name) || (penFX && typeof Object.getPrototypeOf(penFX)[name] === 'function')) continue;
            unknown.push(name);
        }
        return unknown;
    }

    /**
     * Plugins the project depends on: their blocks appear in it or they saved data into it.
     * @param {object} project Serialized project.
     * @returns {Array<object>} References saved as project.shadingPlugins.
     */
    collectReferences (project) {
        const used = new Map();
        const use = (pluginId, patch = {}) => {
            const record = this.records.get(pluginId);
            if (!record) return;
            if (!used.has(pluginId)) {
                used.set(pluginId, {
                    id: pluginId,
                    name: record.manifest.name,
                    version: record.manifest.version,
                    dataKeys: [],
                    extensions: []
                });
            }
            const reference = used.get(pluginId);
            if (patch.dataKey && !reference.dataKeys.includes(patch.dataKey)) reference.dataKeys.push(patch.dataKey);
            if (patch.extension && !reference.extensions.includes(patch.extension)) {
                reference.extensions.push(patch.extension);
            }
        };
        const opcodes = this._projectOpcodes(project);
        for (const opcode of opcodes) {
            if (!opcode.startsWith('penfx_')) continue;
            const stack = this.penFXMethods.get(opcode.slice('penfx_'.length));
            if (stack && stack.length && stack[stack.length - 1].pluginId) use(stack[stack.length - 1].pluginId);
        }
        const penFX = this.vm.runtime.penFX;
        if (penFX) {
            for (const [pluginId, pluginOpcodes] of penFX.customShaders.getPluginOpcodes()) {
                for (const opcode of pluginOpcodes) {
                    if (opcodes.has(`penfx_${opcode}`)) {
                        use(pluginId);
                        break;
                    }
                }
            }
        }
        for (const proxy of this.extensionProxies.values()) {
            if (!proxy.pluginId) continue;
            const prefix = `${proxy.id}_`;
            for (const opcode of opcodes) {
                if (opcode.startsWith(prefix)) {
                    use(proxy.pluginId, {extension: proxy.id});
                    break;
                }
            }
        }
        for (const entry of this.projectData.values()) {
            if (typeof project[entry.key] !== 'undefined') use(entry.pluginId, {dataKey: entry.key});
        }
        const references = Array.from(used.values());
        // Keep references to plugins that are still missing so saving does not forget them.
        for (const reference of this.projectReferences) {
            if (!used.has(reference.id) && !this.isActive(reference.id)) references.push(reference);
        }
        return references;
    }

    getMissingPlugins () {
        return this.missingPlugins.slice();
    }
}

/**
 * Attach the plugin manager to a VM once and start loading installed plugins.
 * @param {object} vm VM with Shading features installed.
 * @param {object} [options] Manager options.
 * @returns {ShadingPluginManager} The manager (also available as vm.shadingPlugins).
 */
const installPluginManager = (vm, options) => {
    if (!vm) return null;
    if (vm.shadingPlugins) return vm.shadingPlugins;
    const manager = new ShadingPluginManager(vm, options);
    vm.shadingPlugins = manager;
    manager.init();
    if (typeof vm.emit === 'function') vm.emit('SHADING_PLUGINS_ATTACHED', manager);
    return manager;
};

export {PROJECT_KEY, RESERVED_PROJECT_KEYS, ShadingPluginManager, installPluginManager, legacyOwnerOf};
export default installPluginManager;
