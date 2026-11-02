import VM from 'scratch-vm';

import {FontCache, MemoryFontStorage} from '../../../src/lib/font-cache';

const createVM = () => {
    const vm = new VM();
    let nextId = 0;
    // Enough of scratch-storage for fonts.
    vm.runtime.storage = {
        AssetType: {Font: {contentType: 'font/ttf', name: 'Font'}},
        createAsset: (assetType, dataFormat, data) => ({assetType, dataFormat, data, assetId: `asset${nextId++}`})
    };
    return vm;
};

const addFont = (vm, family, bytes = [1, 2, 3]) => {
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(storage.AssetType.Font, 'ttf', new Uint8Array(bytes), null, true);
    vm.runtime.fontManager.addCustomFont(family, 'sans-serif', asset);
};

const flush = cache => cache.queue.then(() => cache.ready);

describe('font cache', () => {
    test('adds fonts loaded before to a fresh editor and to new projects', async () => {
        const storage = new MemoryFontStorage();
        const vm = createVM();
        const cache = new FontCache(vm, storage);
        await cache.init();
        addFont(vm, 'My Font', [4, 5, 6]);
        await flush(cache);
        expect(Array.from(storage.records.keys())).toEqual(['my font']);

        // Reload: a new editor starts with the cached font.
        const reloaded = createVM();
        const changed = jest.fn();
        reloaded.runtime.on('PROJECT_CHANGED', changed);
        const reloadedCache = new FontCache(reloaded, storage);
        await reloadedCache.init();
        const fonts = reloaded.runtime.fontManager.getFonts();
        expect(fonts.map(font => font.name)).toEqual(['My Font']);
        expect(Array.from(fonts[0].data)).toEqual([4, 5, 6]);
        expect(changed).not.toHaveBeenCalled();

        // A new empty project clears the fonts, then gets the cached ones back once it has loaded.
        reloaded.runtime.fontManager.clear();
        reloaded.runtime.emit('PROJECT_LOADED');
        expect(reloaded.runtime.fontManager.getFonts().map(font => font.name)).toEqual(['My Font']);
    });

    test('forgets deleted fonts and follows renames', async () => {
        const storage = new MemoryFontStorage();
        const vm = createVM();
        const cache = new FontCache(vm, storage);
        await cache.init();
        addFont(vm, 'First');
        addFont(vm, 'Second');
        await flush(cache);
        vm.runtime.fontManager.renameFont(0, 'Renamed');
        vm.runtime.fontManager.deleteFont(1);
        await flush(cache);
        expect(Array.from(storage.records.values()).map(record => record.family)).toEqual(['Renamed']);
    });
});
