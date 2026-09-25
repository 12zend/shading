// Installed plugins are kept in IndexedDB as the exact zip the user reviewed, so they load again on the next start
// without another prompt. A plugin whose archive changes is a different install and is reviewed again.

const DB_NAME = 'shading-plugins';
const DB_VERSION = 1;
const STORE = 'plugins';

const promisify = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

class IndexedDBPluginStorage {
    constructor (indexedDB = typeof window === 'undefined' ? null : window.indexedDB) {
        this.indexedDB = indexedDB;
        this.database = null;
    }

    get available () {
        return Boolean(this.indexedDB);
    }

    _open () {
        if (!this.indexedDB) return Promise.reject(new Error('Plugins cannot be saved in this browser.'));
        if (!this.database) {
            this.database = new Promise((resolve, reject) => {
                const request = this.indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, {keyPath: 'id'});
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
            transaction.onabort = () => reject(transaction.error || new Error('Plugin storage was aborted.'));
        });
        return result;
    }

    async list () {
        const records = await this._transaction('readonly', store => promisify(store.getAll()));
        return records.sort((a, b) => (a.installedAt || 0) - (b.installedAt || 0));
    }

    put (record) {
        return this._transaction('readwrite', store => promisify(store.put(record)));
    }

    putAll (records) {
        return this._transaction('readwrite', store =>
            Promise.all(records.map(record => promisify(store.put(record)))));
    }

    remove (id) {
        return this._transaction('readwrite', store => promisify(store.delete(id)));
    }
}

// Used by tests and by environments without IndexedDB: plugins last for the session only.
class MemoryPluginStorage {
    constructor () {
        this.records = new Map();
    }

    get available () {
        return true;
    }

    list () {
        return Promise.resolve(Array.from(this.records.values())
            .sort((a, b) => (a.installedAt || 0) - (b.installedAt || 0)));
    }

    put (record) {
        this.records.set(record.id, record);
        return Promise.resolve();
    }

    remove (id) {
        this.records.delete(id);
        return Promise.resolve();
    }
}

const createDefaultStorage = () => {
    const storage = new IndexedDBPluginStorage();
    return storage.available ? storage : new MemoryPluginStorage();
};

export {IndexedDBPluginStorage, MemoryPluginStorage, createDefaultStorage};
