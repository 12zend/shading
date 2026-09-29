import formatTimecode from '../../../src/lib/timecode';

describe('formatTimecode', () => {
    test('formats seconds as HH:MM:SS:FF timecode', () => {
        expect(formatTimecode(0, 30)).toBe('00:00:00:00');
        expect(formatTimecode(1.5, 30)).toBe('00:00:01:15');
        expect(formatTimecode(3725 + (29 / 30), 30)).toBe('01:02:05:29');
    });

    test('pads the frame field to the framerate width', () => {
        expect(formatTimecode(0.5, 120)).toBe('00:00:00:060');
        expect(formatTimecode(0, 1)).toBe('00:00:00:0');
    });

    test('treats invalid input as zero', () => {
        expect(formatTimecode(-3, 30)).toBe('00:00:00:00');
        expect(formatTimecode(NaN, 0)).toBe('00:00:00:0');
    });
});
