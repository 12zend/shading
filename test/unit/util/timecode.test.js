import formatTimecode from '../../../src/lib/timecode';

describe('formatTimecode', () => {
    test('formats minutes, seconds and hundredths', () => {
        expect(formatTimecode(0)).toBe('00:00.00');
        expect(formatTimecode(1.5)).toBe('00:01.50');
        expect(formatTimecode(65.25)).toBe('01:05.25');
        expect(formatTimecode(29 / 30)).toBe('00:00.97');
    });

    test('adds hours only from one hour', () => {
        expect(formatTimecode(3599.99)).toBe('59:59.99');
        expect(formatTimecode(3725.5)).toBe('1:02:05.50');
    });

    test('carries rounding into the next second', () => {
        expect(formatTimecode(59.999)).toBe('01:00.00');
    });

    test('clamps invalid and negative values to zero', () => {
        expect(formatTimecode(-3)).toBe('00:00.00');
        expect(formatTimecode(NaN)).toBe('00:00.00');
    });
});
