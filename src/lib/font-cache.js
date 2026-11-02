// Fonts the user has loaded (imported, or brought in by a project) are kept in IndexedDB, and every project — the
// one restored on reload, a new empty one, or an opened file — starts with them in its font list. Deleting a font
// from the Font tab forgets it; renaming it renames the cached copy.

const DB_NAME = 'shading-font-cache';
const DB_VERSION = 1;
const STORE = 'fonts';

const promisify = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

class IndexedDBFontStorage {
    constructor (indexedDB = typeof window === 'undefined' ? null : window.indexedDB) {
        this.indexedDB = indexedDB;
        this.database = null;
    }

    get available () {
        return Boolean(this.indexedDB);
    }

    _open () {
        if (!this.database) {
            this.database = new Promise((resolve, reject) => {
                const request = this.indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, {keyPath: 'key'});
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this.database;
    }

    async _transaction (mode, callback) {
        const database = await this._open();
        const transaction = database.transaction(STORE, mode);
        const result = await callback(transaction.objectStore(STORE));
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Font cache was aborted.'));
        });
        return result;
    }

    list () {
        return this._transaction('readonly', store => promisify(store.getAll()));
    }

    put (record) {
        return this._transaction('readwrite', store => promisify(store.put(record)));
    }

    remove (key) {
        return this._transaction('readwrite', store => promisify(store.delete(key)));
    }
}

// For tests and browsers without IndexedDB: the cache lasts for the session.
class MemoryFontStorage {
    constructor () {
        this.records = new Map();
    }

    get available () {
        return true;
    }

    list () {
        return Promise.resolve(Array.from(this.records.values()));
    }

    put (record) {
        this.records.set(record.key, record);
        return Promise.resolve();
    }

    remove (key) {
        this.records.delete(key);
        return Promise.resolve();
    }
}

const keyOf = family => String(family).toLowerCase();

const logError = (message, error) => console.error(`[fonts] ${message}`, error); // eslint-disable-line no-console

class FontCache {
    /**
     * @param {object} vm VM with a font manager.
     * @param {object} storage Font storage (IndexedDB by default).
     */
    constructor (vm, storage) {
        this.vm = vm;
        this.storage = storage;
        this.records = new Map();
        this.restoring = false;
        this.queue = Promise.resolve();
        this.handleFontsChanged = this.handleFontsChanged.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
    }

    get fontManager () {
        return this.vm.runtime.fontManager;
    }

    /**
     * Read the cache, add its fonts to the current project and start following font changes.
     * @returns {Promise} Resolves when the cached fonts are in the current project.
     */
    init () {
        const fontManager = this.fontManager;
        fontManager.on('change', this.handleFontsChanged);
        this.vm.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
        this.wrapFontManager(fontManager);
        this.ready = this.storage.list()
            .then(records => {
                for (const record of records) {
                    if (record && record.family && record.data) this.records.set(record.key, record);
                }
            })
            .catch(error => logError('Could not read cached fonts:', error))
            .then(() => {
                this.restore();
                // Fonts of the project that loaded before the cache was read.
                this.handleFontsChanged();
            });
        return this.ready;
    }

    // Deleting forgets the font; renaming moves the cached copy to the new name.
    wrapFontManager (fontManager) {
        const deleteFont = fontManager.deleteFont;
        fontManager.deleteFont = index => {
            const font = fontManager.fonts[index];
            if (font && !font.system) this.forget(font.family);
            return deleteFont.call(fontManager, index);
        };
        const renameFont = fontManager.renameFont;
        fontManager.renameFont = (index, family) => {
            const font = fontManager.fonts[index];
            const oldFamily = font && font.family;
            const result = renameFont.call(fontManager, index, family);
            if (font && !font.system && oldFamily && oldFamily !== font.family) this.forget(oldFamily);
            return result;
        };
    }

    _enqueue (operation) {
        this.queue = this.queue.then(operation)
            .catch(error => logError('Could not update the font cache:', error));
        return this.queue;
    }

    forget (family) {
        const key = keyOf(family);
        if (!this.records.delete(key)) return;
        this._enqueue(() => this.storage.remove(key));
    }

    // Remember every custom font that is new or changed.
    handleFontsChanged () {
        if (this.restoring) return;
        for (const font of this.fontManager.fonts) {
            if (font.system || !font.asset || !font.asset.data) continue;
            const key = keyOf(font.family);
            const cached = this.records.get(key);
            if (cached && cached.assetId === font.asset.assetId && cached.family === font.family) continue;
            const record = {
                key,
                family: font.family,
                fallback: font.fallback,
                format: font.asset.dataFormat,
                assetId: font.asset.assetId,
                data: font.asset.data,
                savedAt: Date.now()
            };
            this.records.set(key, record);
            this._enqueue(() => this.storage.put(record));
        }
    }

    handleProjectLoaded () {
        this.restore();
        this.handleFontsChanged();
    }

    // Add the cached fonts the current project does not have yet. This does not mark the project as changed.
    restore () {
        const fontManager = this.fontManager;
        const storage = this.vm.runtime.storage;
        if (!storage || !storage.AssetType) return;
        this.restoring = true;
        try {
            for (const record of this.records.values()) {
                if (fontManager.hasFont(record.family) || !fontManager.isValidCustomFont(record.family)) continue;
                try {
                    const asset = storage.createAsset(storage.AssetType.Font, record.format,
                        new Uint8Array(record.data), null, true);
                    fontManager.addCustomFont(record.family, record.fallback || 'sans-serif', asset);
                } catch (error) {
                    logError(`Could not restore ${record.family}:`, error);
                }
            }
        } finally {
            this.restoring = false;
        }
    }
}

/**
 * Attach the font cache to a VM once.
 * @param {object} vm VM with a font manager.
 * @param {object} [storage] Font storage.
 * @returns {?FontCache} The cache (also vm.shadingFontCache).
 */
const installFontCache = (vm, storage) => {
    if (!vm || !vm.runtime || !vm.runtime.fontManager) return null;
    if (vm.shadingFontCache) return vm.shadingFontCache;
    let selected = storage;
    if (!selected) {
        const indexed = new IndexedDBFontStorage();
        selected = indexed.available ? indexed : new MemoryFontStorage();
    }
    const cache = new FontCache(vm, selected);
    vm.shadingFontCache = cache;
    cache.init();
    return cache;
};

export {FontCache, IndexedDBFontStorage, MemoryFontStorage, installFontCache};
export default installFontCache;
