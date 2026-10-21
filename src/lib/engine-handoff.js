// Hands a project file to another engine (a different page on the same origin). The file waits in IndexedDB under a
// random id that travels in the URL; the receiving engine takes it once and deletes it. Every engine must contain
// this receiver, so scripts/build-engines.cjs refuses to build commits without it.

const DB_NAME = 'shading-engine-handoff';
const DB_VERSION = 1;
const STORE = 'files';
const HANDOFF_PARAM = 'engine_handoff';
// A file not picked up by then belongs to a navigation that never finished.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f]{32}$/;

const promisify = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const openDatabase = (indexedDB = typeof window === 'undefined' ? null : window.indexedDB) => {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is not available.'));
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) {
                request.result.createObjectStore(STORE, {keyPath: 'id'});
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const transaction = async (indexedDB, mode, callback) => {
    const database = await openDatabase(indexedDB);
    try {
        const tx = database.transaction(STORE, mode);
        const result = await callback(tx.objectStore(STORE));
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Engine handoff was aborted.'));
        });
        return result;
    } finally {
        database.close();
    }
};

const createId = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * @param {{data: ArrayBuffer, fileName: string, fileHandle: ?FileSystemFileHandle}} file The project file. The
 *   handle (structured-cloneable) lets the other engine save back to the same file.
 * @param {IDBFactory} [indexedDB] IndexedDB.
 * @returns {Promise<string>} The handoff id.
 */
const storeHandoff = async (file, indexedDB) => {
    const id = createId();
    await transaction(indexedDB, 'readwrite', store => promisify(store.put({
        id,
        data: file.data,
        fileName: file.fileName || '',
        fileHandle: file.fileHandle || null,
        createdAt: Date.now()
    })));
    return id;
};

/**
 * Take a waiting file, once. Also removes files that were never picked up.
 * @param {string} id The handoff id.
 * @param {IDBFactory} [indexedDB] IndexedDB.
 * @returns {Promise<?{data: ArrayBuffer, fileName: string, fileHandle: ?FileSystemFileHandle}>} The file.
 */
const takeHandoff = (id, indexedDB) => transaction(indexedDB, 'readwrite', async store => {
    const records = await promisify(store.getAll());
    let found = null;
    for (const record of records) {
        if (record.id === id) found = record;
        if (record.id === id || Date.now() - record.createdAt > MAX_AGE_MS) store.delete(record.id);
    }
    return found && {data: found.data, fileName: found.fileName, fileHandle: found.fileHandle || null};
});

/**
 * @param {string} engineURL The other engine's editor URL.
 * @param {string} id The handoff id.
 * @returns {string} URL that opens the file there.
 */
const getHandoffURL = (engineURL, id) => {
    const url = new URL(engineURL, location.href);
    url.searchParams.set(HANDOFF_PARAM, id);
    return url.href;
};

const readHandoffId = search => {
    const id = typeof URLSearchParams === 'undefined' ? null : new URLSearchParams(search).get(HANDOFF_PARAM);
    return id && ID_PATTERN.test(id) ? id : null;
};

let pendingHandoffId = typeof location === 'undefined' ? null : readHandoffId(location.search);

/**
 * The file this page was opened to load, at most once. The id is removed from the address bar so a reload does
 * not look for it again.
 * @returns {?string} The handoff id.
 */
const takePendingHandoffId = () => {
    const id = pendingHandoffId;
    pendingHandoffId = null;
    if (id && typeof history !== 'undefined') {
        try {
            const url = new URL(location.href);
            url.searchParams.delete(HANDOFF_PARAM);
            history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (error) {
            // The file loads either way.
        }
    }
    return id;
};

/**
 * Open a project file in another engine. The current page is left without asking again: the user already chose
 * to replace the open project.
 * @param {string} engineURL The other engine's editor URL.
 * @param {object} file See storeHandoff().
 * @returns {Promise} Resolves when the navigation has started.
 */
const openInEngine = async (engineURL, file) => {
    const id = await storeHandoff(file);
    window.onbeforeunload = null;
    location.assign(getHandoffURL(engineURL, id));
};

export {
    HANDOFF_PARAM,
    getHandoffURL,
    openInEngine,
    readHandoffId,
    storeHandoff,
    takeHandoff,
    takePendingHandoffId
};
