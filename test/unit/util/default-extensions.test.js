import installDefaultExtensions, {DEFAULT_EXTENSION_IDS} from '../../../src/lib/default-extensions';

describe('default Movie extensions', () => {
    test('loads Pen without relying on an add-on setting', () => {
        const loadedExtensions = new Set();
        const vm = {
            extensionManager: {
                isExtensionLoaded: jest.fn(extensionId => loadedExtensions.has(extensionId)),
                loadExtensionIdSync: jest.fn(extensionId => loadedExtensions.add(extensionId))
            }
        };

        expect(DEFAULT_EXTENSION_IDS).toEqual(['pen']);
        expect(vm.extensionManager.isExtensionLoaded('pen')).toBe(false);
        expect(installDefaultExtensions(vm)).toBe(vm);
        expect(vm.extensionManager.isExtensionLoaded('pen')).toBe(true);
        expect(installDefaultExtensions(vm)).toBe(vm);
        expect(vm.extensionManager.loadExtensionIdSync).toHaveBeenCalledTimes(1);
        expect(vm.extensionManager.loadExtensionIdSync).toHaveBeenCalledWith('pen');
    });
});
