import VM from 'scratch-vm';

import installMovieEasing, {EASING_TYPES, calculateEasingValue} from '../../../src/lib/movie-easing';

const calculate = (overrides = {}, timer = 0.5) => calculateEasingValue({
    type: 'PowerIn',
    v0: 0,
    v1: 100,
    t0: 0,
    t1: 1,
    power: 2,
    speed: 0,
    ...overrides
}, timer);

describe('Movie easing', () => {
    test('provides every requested easing type', () => {
        expect(EASING_TYPES).toEqual([
            'PowerIn',
            'PowerOut',
            'PowerInOut',
            'CircIn',
            'CircOut',
            'CircInOut',
            'ExpoIn',
            'ExpoOut',
            'ExpoInOut'
        ]);
    });

    test('uses the timer to interpolate between values', () => {
        expect(calculate({}, -1)).toBe(0);
        expect(calculate({}, 0.5)).toBe(25);
        expect(calculate({}, 2)).toBe(100);
    });

    test('supports in, out, and in-out power curves', () => {
        expect(calculate({type: 'PowerIn'}, 0.25)).toBeCloseTo(6.25);
        expect(calculate({type: 'PowerOut'}, 0.25)).toBeCloseTo(43.75);
        expect(calculate({type: 'PowerInOut'}, 0.25)).toBeCloseTo(12.5);
    });

    test('all easing types preserve both endpoints', () => {
        for (const type of EASING_TYPES) {
            expect(calculate({type}, 0)).toBe(0);
            expect(calculate({type}, 1)).toBe(100);
        }
    });

    test('speed zero is the unmodified easing curve', () => {
        expect(calculate({type: 'PowerIn', speed: 0}, 0.5)).toBe(25);
    });

    test('speed applies elastic oscillation using elapsed seconds', () => {
        const timer = 0.25;
        const speed = Math.PI / timer;
        expect(calculate({type: 'PowerIn', speed}, timer)).toBeCloseTo(193.75);
    });

    test('supports descending value ranges', () => {
        expect(calculate({v0: 100, v1: -100}, 0.5)).toBe(50);
    });

    test('a zero-length time range switches at its start time', () => {
        expect(calculate({t0: 2, t1: 2}, 1)).toBe(0);
        expect(calculate({t0: 2, t1: 2}, 2)).toBe(100);
    });

    test('installs a native operator primitive that reads the Scratch timer', () => {
        const vm = new VM();
        installMovieEasing(vm);
        const util = {
            ioQuery: jest.fn(() => 0.5)
        };

        const result = vm.runtime._primitives.operator_easing({
            TYPE: 'PowerIn',
            V0: 0,
            V1: 100,
            T0: 0,
            T1: 1,
            POWER: 2,
            SPEED: 0
        }, util);

        expect(util.ioQuery).toHaveBeenCalledWith('clock', 'projectTimer');
        expect(result).toBe(25);
    });
});
