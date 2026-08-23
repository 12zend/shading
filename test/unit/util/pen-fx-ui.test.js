import {
    DEFAULT_GRADIENT,
    createGradientField,
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

    test('notifies Blockly when gradient colors change', () => {
        const changes = [];
        const FieldTextInput = function (value) {
            this.text_ = String(value);
        };
        FieldTextInput.prototype.getValue = function () {
            return this.text_;
        };
        FieldTextInput.prototype.setValue = function (value) {
            const oldValue = this.getValue();
            if (oldValue === value) return;
            changes.push({oldValue, newValue: value});
            this.text_ = value;
        };
        FieldTextInput.prototype.setText = function (value) {
            this.text_ = value;
        };
        const GradientField = createGradientField({FieldTextInput});
        const field = new GradientField();
        const nextGradient = {
            stops: [
                {color: '#ff0000', position: 0},
                {color: '#0000ff', position: 1}
            ]
        };

        field.setValue(nextGradient);

        expect(changes).toEqual([{
            oldValue: serializeGradient(DEFAULT_GRADIENT),
            newValue: serializeGradient(nextGradient)
        }]);
        expect(field.getValue()).toBe(serializeGradient(nextGradient));
    });
});
