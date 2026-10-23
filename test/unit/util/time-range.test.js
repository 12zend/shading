import {getTimeRangeProgress, isTimeInRange} from '../../../scratch-vm/src/lib/time-range';
import {calculateAnimationValue, isTimeWithin} from '../../../src/lib/object-animation';
import {calculateEasingValue} from '../../../src/lib/movie-easing';
import {isWithinTimeWindow} from '../../../src/lib/movie-asset-manager-utils';

const FRAMERATES = [24, 30, 60];
const OFFSETS = [0.1, 0.2, 0.1 + 0.2, 0.7, 1 / 3, 0.25];
const RANGES = [[0, 0.5], [0.1, 1], [0.2, 1.2], [0.5, 2], [1, 1.5]];

const forEachFrame = callback => {
    FRAMERATES.forEach(framerate => {
        for (let frame = 0; frame <= framerate * 4; frame++) callback(frame / framerate);
    });
};

describe('Shared time range', () => {
    test('includes both ends and swaps reversed ends', () => {
        expect(isTimeInRange(1, 1, 2)).toBe(true);
        expect(isTimeInRange(2, 1, 2)).toBe(true);
        expect(isTimeInRange(0.999, 1, 2)).toBe(false);
        expect(isTimeInRange(2.001, 1, 2)).toBe(false);
        expect(isTimeInRange(1.5, 2, 1)).toBe(true);
        expect(isTimeInRange(1e9, 0, Infinity)).toBe(true);
    });

    test('treats floating-point noise at a boundary as the boundary', () => {
        expect(isTimeInRange(0.3, 0.1 + 0.2, 1)).toBe(true);
        expect(isTimeInRange(0.1 + 0.2, 0, 0.3)).toBe(true);
        expect(getTimeRangeProgress(0.3, 0.1 + 0.2, 1)).toBe(0);
        expect(getTimeRangeProgress(0.1 + 0.2, 0, 0.3)).toBe(1);
    });

    test('progress runs from 0 at the start to 1 at the end', () => {
        expect(getTimeRangeProgress(0, 1, 3)).toBe(0);
        expect(getTimeRangeProgress(1, 1, 3)).toBe(0);
        expect(getTimeRangeProgress(2, 1, 3)).toBe(0.5);
        expect(getTimeRangeProgress(3, 1, 3)).toBe(1);
        expect(getTimeRangeProgress(4, 1, 3)).toBe(1);
        expect(getTimeRangeProgress(0.5, 1, 1)).toBe(0);
        expect(getTimeRangeProgress(1, 1, 1)).toBe(1);
        expect(getTimeRangeProgress(1, 2, 1)).toBe(0);
        expect(getTimeRangeProgress(2, 2, 1)).toBe(1);
    });

    test('time within and the object draw range agree on every frame under a time offset', () => {
        const disagreements = [];
        forEachFrame(time => {
            OFFSETS.forEach(offset => {
                RANGES.forEach(([start, end]) => {
                    // Objects shift the draw range by the offset; time within shifts the time instead.
                    const drawn = isWithinTimeWindow({start: start + offset, end: end + offset}, time);
                    const within = isTimeWithin(time - offset, start, end);
                    if (drawn !== within) disagreements.push({time, offset, start, end, drawn, within});
                });
            });
        });
        expect(disagreements).toEqual([]);
    });

    test('the draw range swaps reversed ends like time within', () => {
        expect(isWithinTimeWindow({start: 2, end: 1}, 1.5)).toBe(true);
        expect(isTimeWithin(1.5, 2, 1)).toBe(true);
    });

    test('animation and easing move exactly while time within is true', () => {
        forEachFrame(time => {
            OFFSETS.forEach(offset => {
                RANGES.forEach(([start, end]) => {
                    const local = time - offset;
                    const within = isTimeWithin(local, start, end);
                    const animated = calculateAnimationValue({from: 0, to: 1, start, end, easing: 'Linear'}, local);
                    const eased = calculateEasingValue({
                        type: 'PowerIn',
                        v0: 0,
                        v1: 1,
                        t0: start,
                        t1: end,
                        power: 1,
                        speed: 0,
                        strength: 0
                    }, local);
                    const atStart = isTimeInRange(local, start, start);
                    const atEnd = isTimeInRange(local, end, end);
                    if (atStart) {
                        expect(animated).toBe(0);
                        expect(eased).toBe(0);
                    } else if (atEnd) {
                        expect(animated).toBe(1);
                        expect(eased).toBe(1);
                    } else if (within) {
                        expect(animated).toBeGreaterThan(0);
                        expect(animated).toBeLessThan(1);
                        expect(eased).toBeCloseTo(animated, 12);
                    } else {
                        expect(animated).toBe(local < start ? 0 : 1);
                        expect(eased).toBe(animated);
                    }
                });
            });
        });
    });
});
