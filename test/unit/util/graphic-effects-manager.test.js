import installGraphicEffectsManager from '../../../src/lib/graphic-effects-manager';

const makeVm = () => ({
    runtime: {
        _primitives: {},
        on: jest.fn(),
        renderer: null,
        targets: []
    }
});

const makeTarget = () => ({
    getCostumes: () => [],
    id: 'unpatched',
    isStage: false,
    setEffect: jest.fn()
});

describe('Graphic Effects Manager', () => {
    test('effect primitives recover when an opcode runs before the target is patched', () => {
        const manager = installGraphicEffectsManager(makeVm());
        const target = makeTarget();

        expect(manager.rgbShift(target, {COLOR: 'GB', DIR: 45, VALUE: 25})).toBeUndefined();
        expect(manager.pixelStretch(target, {
            ANGLE: 0,
            FALLOFF: 0,
            OFFSET: 10,
            RADIUS: 50,
            SMOOTHNESS: 0,
            X: 100,
            Y: 0
        })).toBeUndefined();
        expect(manager.displacementMap(target, {COSTUME: 'map', TYPE: 'x', VALUE: 5})).toBeUndefined();
        expect(manager.effectWeight(target, 'weights')).toBeUndefined();

        const state = manager.targetStates.get('unpatched');
        expect(state.rgbShiftColor).toBe(1);
        expect(state.pixelStretchB[0]).toBe(1);
        expect(state.displacementCostume).toBe('map');
        expect(state.effectWeightCostume).toBe('weights');
        expect(target.setEffect).toHaveBeenCalledTimes(4);
    });

    test('setScale keeps ignoring targets that have no state yet', () => {
        const manager = installGraphicEffectsManager(makeVm());
        const target = Object.assign(makeTarget(), {
            _getRenderedDirectionAndScale: () => ({direction: 90, scale: [100, 100]})
        });

        expect(() => manager.setScale(target, 'width', 150)).not.toThrow();
        expect(manager.targetStates.has('unpatched')).toBe(false);
    });
});
