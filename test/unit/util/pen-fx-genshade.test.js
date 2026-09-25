import fs from 'fs';
import path from 'path';
import {PLUGINS_DIR, requirePluginModule} from '../../helpers/official-plugins';

// Genshade is the official plugin shading-plugins/genshade; its assets travel inside the plugin zip.
const {blocks, catalog, install} = requirePluginModule('genshade', 'lib/blocks.js');
const {resolveGenshadeTexture} = requirePluginModule('genshade', 'lib/assets.js');
const GenshadeRenderer = requirePluginModule('genshade', 'lib/renderer.js');
const installGenshade = PenFX => install({PenFX, vm: {runtime: {}}});

const genshadeRoot = path.join(PLUGINS_DIR, 'genshade', 'assets');

test('ships the compiler, shader sources and texture list inside the plugin', () => {
    for (const file of ['compiler.js', 'compiler.wasm', 'modules.json', 'sources.json', 'textures.json']) {
        expect(fs.existsSync(path.join(genshadeRoot, file))).toBe(true);
    }
});

test('resolves every referenced texture to a shipped file on a case-sensitive host', () => {
    // macOS dev servers match names case-insensitively; the production host does not.
    const modules = JSON.parse(fs.readFileSync(path.join(genshadeRoot, 'modules.json'), 'utf8'));
    const files = JSON.parse(fs.readFileSync(path.join(genshadeRoot, 'textures.json'), 'utf8'));
    const shipped = fs.readdirSync(path.join(genshadeRoot, 'Textures')).filter(name => !name.startsWith('.'));
    expect(files.slice().sort()).toEqual(shipped.sort());
    const names = new Set(Object.values(modules).flatMap(module => module.textures
        .map(texture => texture.annotations.source).filter(Boolean)));
    expect(names).toContain('Cursor.png');
    expect(names).toContain('cursor.png');
    const missing = Array.from(names).filter(name => !files.includes(resolveGenshadeTexture(files, name)));
    expect(missing).toEqual([]);
    expect(resolveGenshadeTexture(files, 'Cursor.png')).toBe(resolveGenshadeTexture(files, 'cursor.png'));
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
        installGenshade(PenFX);
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
        installGenshade(PenFX);
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

test('never feeds ReShade timer or frame-count uniforms a zero seed on the first frame', () => {
    const gl = {UNIFORM_BUFFER: 1, DYNAMIC_DRAW: 2, bindBuffer: jest.fn(), bufferData: jest.fn(),
        bindBufferBase: jest.fn(), getExtension: jest.fn()};
    const renderer = new GenshadeRenderer({gl});
    const effect = {values: new ArrayBuffer(16), ubo: {}, module: {uniforms: [
        {name: 'Timer', type: 'float', rows: 1, cols: 1, offset: 0, annotations: {source: 'timer'}},
        {name: 'FrameCount', type: 'int', rows: 1, cols: 1, offset: 4, annotations: {source: 'framecount'}}
    ]}};
    renderer.uniforms(effect, {}, {time: 0, fps: 30, frame: 0});
    const first = new DataView(effect.values.slice(0));
    renderer.uniforms(effect, {}, {time: 1, fps: 30, frame: 30});
    const second = new DataView(effect.values);
    expect(first.getFloat32(0, true)).toBeGreaterThan(0);
    expect(first.getInt32(4, true)).toBeGreaterThan(0);
    // The offset is fixed, so exported frames stay deterministic and advance with the timeline.
    expect(second.getFloat32(0, true) - first.getFloat32(0, true)).toBeCloseTo(1000, 1);
    expect(second.getInt32(4, true) - first.getInt32(4, true)).toBe(30);
});
