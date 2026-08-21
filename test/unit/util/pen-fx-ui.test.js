import {
    DEFAULT_GRADIENT,
    gradientToCss,
    normalizeGradient,
    serializeGradient
} from '../../../src/lib/pen-fx-ui';

describe('Pen FX gradient field data', () => {
    test('normalizes and serializes multiple color stops for project storage', () => {
        const gradient = normalizeGradient({
            stops: [
                {color: '#fff', position: 1.2},
                {color: '#123456', position: 0.25},
                {color: '#000', position: -1}
            ]
        });

        expect(gradient).toEqual({
            stops: [
                {color: '#000000', position: 0},
                {color: '#123456', position: 0.25},
                {color: '#ffffff', position: 1}
            ]
        });
        expect(JSON.parse(serializeGradient(gradient))).toEqual(gradient);
        expect(gradientToCss(gradient)).toBe('#000000 0%, #123456 25%, #ffffff 100%');
    });

    test('falls back to a readable two-stop gradient', () => {
        expect(normalizeGradient('not-json')).toEqual(DEFAULT_GRADIENT);
    });
});
