import {
    HANDOFF_PARAM,
    getHandoffURL,
    readHandoffId,
    storeHandoff,
    takeHandoff
} from '../../../src/lib/engine-handoff';

// Just enough of IndexedDB for one object store: requests succeed asynchronously and a transaction completes once
// none of its requests are pending.
const createFakeIndexedDB = () => {
    const records = new Map();
    let upgraded = false;
    const later = callback => setTimeout(callback, 0);
    const createTransaction = () => {
        const tx = {pending: 0, done: false};
        const settle = () => later(() => {
            if (!tx.done && tx.pending === 0) {
                tx.done = true;
                if (tx.oncomplete) tx.oncomplete();
            }
        });
        const request = operation => {
            const req = {};
            tx.pending++;
            later(() => {
                req.result = operation();
                tx.pending--;
                if (req.onsuccess) req.onsuccess();
                settle();
            });
            return req;
        };
        tx.objectStore = () => ({
            put: record => request(() => records.set(record.id, record) && record.id),
            getAll: () => request(() => Array.from(records.values())),
            delete: id => request(() => {
                records.delete(id);
            })
        });
        return tx;
    };
    const database = {
        objectStoreNames: {contains: () => upgraded},
        createObjectStore: () => {
            upgraded = true;
        },
        transaction: createTransaction,
        close: () => {}
    };
    return {
        records,
        open: () => {
            const req = {result: database};
            later(() => {
                if (!upgraded && req.onupgradeneeded) req.onupgradeneeded();
                req.onsuccess();
            });
            return req;
        }
    };
};

describe('engine handoff', () => {
    test('hands a file over once', async () => {
        const indexedDB = createFakeIndexedDB();
        const data = new Uint8Array([1, 2, 3]).buffer;
        const fileHandle = {name: 'movie.shade'};

        const id = await storeHandoff({data, fileName: 'movie.shade', fileHandle}, indexedDB);

        expect(id).toMatch(/^[0-9a-f]{32}$/);
        await expect(takeHandoff(id, indexedDB)).resolves.toEqual({data, fileName: 'movie.shade', fileHandle});
        await expect(takeHandoff(id, indexedDB)).resolves.toBeNull();
        expect(indexedDB.records.size).toBe(0);
    });

    test('removes files that were never picked up', async () => {
        const indexedDB = createFakeIndexedDB();
        indexedDB.records.set('stale', {id: 'stale', data: null, createdAt: Date.now() - (2 * 24 * 60 * 60 * 1000)});
        const id = await storeHandoff({data: new ArrayBuffer(0), fileName: 'a.shade'}, indexedDB);

        await takeHandoff('0'.repeat(32), indexedDB);

        expect(Array.from(indexedDB.records.keys())).toEqual([id]);
    });

    test('puts the id in the engine URL and reads only well-formed ids back', () => {
        const id = 'ab'.repeat(16);
        global.location = {href: 'https://shading.app/'};

        const url = getHandoffURL('/engines/1.0.0/', id);

        expect(url).toBe(`https://shading.app/engines/1.0.0/?${HANDOFF_PARAM}=${id}`);
        expect(readHandoffId(new URL(url).search)).toBe(id);
        expect(readHandoffId(`?${HANDOFF_PARAM}=../../etc`)).toBeNull();
        expect(readHandoffId('')).toBeNull();
        delete global.location;
    });
});
