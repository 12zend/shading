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
        const vhs = info.blocks.find(block => block.opcode === 'vhs');
        const glitch = info.blocks.find(block => block.opcode === 'glitch');
        expect(vhs).toBeDefined();
        expect(glitch).toBeDefined();
        expect(vhs.arguments.SEED.defaultValue).toBe(0);
        expect(glitch.arguments.SEED.defaultValue).toBe(0);
        expect(vhs.arguments.EVOLUTION.defaultValue).toBe(0);
        expect(glitch.arguments.EVOLUTION.defaultValue).toBe(0);
        expect(info.menus.stretchType.items).toEqual(['x', 'y', 'size', 'dir']);
        expect(info.menus.sortAxis.items).toEqual(['x', 'y', 'size', 'dir']);
        expect(info.menus.turbulenceType.items).toEqual(['both', 'x', 'y', 'size', 'dir']);
        expect(info.blocks.find(block => block.opcode === 'bufferStackSize')).toBeDefined();
    });

    test('routes deterministic VHS and glitch controls to the GPU engine', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            vhs: jest.fn(),
            digitalGlitch: jest.fn()
        };

        penFX.vhs({TRACKING: 8, CHROMA: 4, NOISE: 20, SCANLINES: 30, SEED: 91, EVOLUTION: 12, MIX: 75});
        penFX.glitch({SLICES: 32, SHIFT: 40, RGB: 7, DENSITY: 45, SEED: 92, EVOLUTION: 13, MIX: 80});

        expect(penFX.engine.vhs).toHaveBeenCalledWith(8, 4, 0.2, 0.3, 91, 12, 0.75, 'normal');
        expect(penFX.engine.digitalGlitch).toHaveBeenCalledWith(32, 40, 7, 0.45, 92, 13, 0.8, 'normal');
    });

    test('routes polar stretch, sort, and turbulent wavy controls to the GPU engine', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            pixelStretch: jest.fn(),
            pixelSort: jest.fn(),
            wavy: jest.fn()
        };

        penFX.pixelStretch({TYPE: 'size', POSITION: 20, SIZE: 140, SAMPLE: 5, CENTERX: 12, CENTERY: -8, MIX: 70});
        penFX.pixelSort({TYPE: 'dir', SPAN: 80, MIN: 0.2, MAX: 0.8, INVERT: 'false', SORTBY: 'hue',
            REVERSE: 'true', GAMMA: 1.2, CENTERX: 10, CENTERY: -5, MIX: 65});
        penFX.wavy({TYPE: 'dir', VALUE: 14, SIZE: 72, COMPLEXITY: 5, EVOLUTION: 180, SEED: 4,
            X: 8, Y: -3, CENTERX: 16, CENTERY: 9, MIX: 90});

        expect(penFX.engine.pixelStretch).toHaveBeenCalledWith('size', 20, 140, 5, 12, -8, 0.7, 'normal');
        expect(penFX.engine.pixelSort).toHaveBeenCalledWith('dir', 80, false, 0.2, 0.8, 'hue', true, 1.2,
            10, -5, 0.65, 'normal');
        expect(penFX.engine.wavy).toHaveBeenCalledWith(14, 4, 8, -3, 72, 5, 180, 'dir', 16, 9, 0.9, 'normal');
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
