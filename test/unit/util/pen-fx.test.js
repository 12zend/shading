import VM from 'scratch-vm';

import installPenFX, {createPenFXClass} from '../../../src/lib/pen-fx';

describe('built-in Pen FX category', () => {
    test('exposes the Pen FX blocks through an internal category', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const info = new PenFX().getInfo();

        expect(info.id).toBe('penfx');
        expect(info.name).toBe('Pen FX');
        expect(info.blockIconURI).toBeUndefined();
        expect(info.blocks.find(block => block.opcode === 'contrast')).toBeDefined();
        expect(info.blocks.find(block => block.opcode === 'bufferStackSize')).toBeDefined();
    });

    test('loads Pen FX automatically as a built-in extension service', () => {
        const vm = new VM();
        vm.runtime.renderer = {};

        expect(vm.extensionManager.isExtensionLoaded('penfx')).toBe(false);
        expect(installPenFX(vm)).toBe(vm);
        expect(vm.extensionManager.isBuiltinExtension('penfx')).toBe(true);
        expect(vm.extensionManager.isExtensionLoaded('penfx')).toBe(true);
        expect(installPenFX(vm)).toBe(vm);
    });
});
