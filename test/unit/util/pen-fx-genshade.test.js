import {blocks, catalog, installGenshade} from '../../../scratch-vm/src/lib/pen-fx/genshade';
import {genshadeBaseURL} from '../../../scratch-render/src/pen-fx/genshade/assets';

test('loads Genshade assets from the app root on editor and project routes', () => {
    expect(genshadeBaseURL('/', 'https://shading.app/editor/')).toBe('https://shading.app/genshade/');
    expect(genshadeBaseURL('/', 'https://shading.app/project-id/')).toBe('https://shading.app/genshade/');
    expect(genshadeBaseURL('/app/', 'https://example.com/app/editor/'))
        .toBe('https://example.com/app/genshade/');
});

describe('PenFX Genshade block arguments', () => {
    test('exposes every catalog parameter and component as a block input', () => {
        expect(blocks).toHaveLength(catalog.length);
        blocks.forEach((block, index) => {
            const expectedCount = catalog[index].parameters.reduce((total, parameter) => {
                const count = parameter.rows * parameter.cols;
                return total + (parameter.annotations.ui_type === 'color' && count >= 3 ? count - 2 : count);
            }, 1);
            expect(block.inputs).toHaveLength(expectedCount);
            expect(block.inputs.map(input => input.id)).not.toContain('SETTINGS');
            expect(block.inputs.map(input => input.id)).toHaveLength(new Set(block.inputs.map(input => input.id)).size);
            for (const input of block.inputs) expect(block.text).toContain(`[${input.id}]`);
        });
    });

    test('passes scalar, vector, and color inputs to the renderer in the same tick', () => {
        const descriptorIndex = catalog.findIndex(descriptor =>
            descriptor.parameters.some(parameter => parameter.rows > 1 && parameter.annotations.ui_type !== 'color') &&
            descriptor.parameters.some(parameter => parameter.rows >= 3 && parameter.annotations.ui_type === 'color'));
        expect(descriptorIndex).toBeGreaterThanOrEqual(0);
        const descriptor = catalog[descriptorIndex];
        const block = blocks[descriptorIndex];
        const renderer = {render: jest.fn()};
        const engine = {genshadeRenderer: renderer};
        class PenFX {
            _safe(callback) { callback(engine, {}); }
        }
        installGenshade(PenFX, {runtime: {}});
        const args = Object.fromEntries(block.inputs.map(input => [input.id, input.defaultValue]));
        const vectorIndex = descriptor.parameters.findIndex(parameter =>
            parameter.rows > 1 && parameter.annotations.ui_type !== 'color');
        const colorIndex = descriptor.parameters.findIndex(parameter =>
            parameter.rows >= 3 && parameter.annotations.ui_type === 'color');
        args[`P${vectorIndex}_X`] = 0.25;
        args[`P${colorIndex}`] = '#336699';
        const result = new PenFX()[block.opcode](args, {target: {}});
        expect(result).toBeUndefined();
        const settings = renderer.render.mock.calls[0][1];
        expect(settings[descriptor.parameters[vectorIndex].name][0]).toBe(0.25);
        expect(settings[descriptor.parameters[colorIndex].name].slice(0, 3)).toEqual([0.2, 0.4, 0.6]);
        expect(Object.keys(settings)).toHaveLength(descriptor.parameters.length);
    });

    test('clamps the saved GaussianBlur radius to its 0–4 slider range', () => {
        const block = blocks.find(item => item.id === 'genshade-gaussianblur-gaussianblur');
        const renderer = {render: jest.fn()};
        class PenFX {
            _safe(callback) { callback({genshadeRenderer: renderer}, {}); }
        }
        installGenshade(PenFX, {runtime: {}});
        const result = new PenFX()[block.opcode]({P0: 16, P1: 1, P2: 0.3, MIX: 100}, {target: {}});
        expect(result).toBeUndefined();
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(renderer.render.mock.calls[0][1]).toMatchObject({
            GaussianBlurRadius: [4],
            GaussianBlurOffset: [1],
            GaussianBlurStrength: [0.3]
        });
    });
});
