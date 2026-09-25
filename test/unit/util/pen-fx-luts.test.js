import fs from 'fs';
import path from 'path';
import {PLUGINS_DIR, createPenFXClass, requirePluginModule} from '../../helpers/official-plugins';

// LUTs are provided by the official LUT plugin (shading-plugins/lut).
const {
    lutLayout, packLUT, pngDimensions, fromDataURL, toDataURL
} = requirePluginModule('lut', 'lib/luts.js');
const installLUTEngine = requirePluginModule('lut', 'lib/engine.js');

const pngHeader = (width, height) => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

// A VM whose project save/load goes through the plugin manager, with the LUT plugin active.
const makeManager = () => {
    const vm = {
        runtime: {renderer: {_gl: {deleteTexture: jest.fn()}}, emitProjectChanged: jest.fn()},
        toJSON: () => JSON.stringify({targets: []}),
        deserializeProject: jest.fn(async () => 'loaded')
    };
    const PenFX = createPenFXClass(vm, ['lut']);
    const penFX = new PenFX();
    const manager = vm.shadingPlugins.getExports('lut').lutManager;
    const decode = jest.fn(async () => new Uint8Array(32));
    const upload = jest.fn(() => ({texture: {}, width: 4, height: 2, columns: 2}));
    manager.decode = decode;
    manager.upload = upload;
    return {manager, vm, decode, upload, penFX};
};

test('recognizes original Tempest dimensions and common tiled LUTs without resizing', () => {
    expect(lutLayout(16384, 128)).toEqual({size: 128, columns: 128, rows: 1});
    expect(lutLayout(512, 512)).toEqual({size: 64, columns: 8, rows: 8});
    expect(lutLayout(16, 256)).toEqual({size: 16, columns: 1, rows: 16});
    expect(() => lutLayout(480, 360)).toThrow();
    expect(() => lutLayout(0, 0)).toThrow();
    expect(() => pngDimensions(new Uint8Array(33))).toThrow();
});

test('repacking preserves every RGB voxel and its red/green/blue orientation', () => {
    for (const [width, height] of [[64, 8], [8, 64], [16, 32]]) {
        const layout = {width, height, ...lutLayout(width, height)};
        const source = new Uint8Array(width * height * 4);
        for (let b = 0; b < 8; b++) {
            for (let g = 0; g < 8; g++) {
                for (let r = 0; r < 8; r++) {
                    const i = ((Math.floor(b / layout.columns) * 8 + g) * width + (b % layout.columns) * 8 + r) * 4;
                    source.set([r * 31, g * 31, b * 31, 255], i);
                }
            }
        }
        const atlas = packLUT(source, layout, 32);
        for (let b = 0; b < 8; b++) {
            for (let g = 0; g < 8; g++) {
                for (let r = 0; r < 8; r++) {
                    const i = ((Math.floor(b / atlas.columns) * 8 + g) * atlas.width + (b % atlas.columns) * 8 + r) * 4;
                    expect(Array.from(atlas.pixels.slice(i, i + 4))).toEqual([r * 31, g * 31, b * 31, 255]);
                }
            }
        }
        expect(() => packLUT(source, layout, 8)).toThrow('GPU');
    }
});

test('preserves PNG bytes through project save/load and clears LUTs for a new project', async () => {
    const {manager, vm, decode} = makeManager();
    const bytes = pngHeader(4, 2);
    const data = toDataURL(bytes);
    expect(fromDataURL(data)).toEqual(bytes);
    await manager.restore([{id: 'lut-one', name: 'Test', data}]);
    const project = JSON.parse(vm.toJSON());
    expect(project.penFXLUTs).toEqual([{id: 'lut-one', name: 'Test', data}]);
    expect(project.mb3.features).toContain('pen-fx-luts');
    manager.rename('lut-one', 'Renamed');
    expect(manager.find('lut-one').name).toBe('Renamed');
    await vm.deserializeProject(project);
    expect(manager.find('lut-one').name).toBe('Test');
    expect(decode).toHaveBeenCalledTimes(2);
    expect(vm.runtime.renderer._gl.deleteTexture).toHaveBeenCalledTimes(1);
    await vm.deserializeProject({targets: []});
    expect(manager.items).toEqual([]);
    expect(JSON.parse(vm.toJSON()).penFXLUTs).toBeUndefined();
});

test('invalid restore preserves existing resources and releases partially loaded replacements', async () => {
    const {manager, vm} = makeManager();
    const descriptor = {id: 'one', name: 'One', data: toDataURL(pngHeader(4, 2))};
    await manager.restore([descriptor]);
    await expect(manager.restore([descriptor, descriptor])).rejects.toThrow('duplicate');
    expect(manager.items).toHaveLength(1);
    expect(vm.runtime.renderer._gl.deleteTexture).toHaveBeenCalledTimes(1);
    manager.remove('one');
    expect(vm.runtime.renderer._gl.deleteTexture).toHaveBeenCalledTimes(2);
});

test('LUT block uses preloaded resources and returns undefined in the same tick', () => {
    const {manager, penFX} = makeManager();
    const entry = {id: 'test', name: 'Test', gpu: {texture: {}}};
    manager.items.push(entry);
    const engine = {lut: jest.fn()};
    penFX._safe = callback => callback(engine);
    expect(penFX.applyLUT({LUT: 'test', MIX: 25})).toBeUndefined();
    expect(engine.lut).toHaveBeenCalledWith(entry, 0.25, 'normal');
    expect(penFX.applyLUT({LUT: 'missing', MIX: 100})).toBeUndefined();
    expect(engine.lut).toHaveBeenCalledTimes(1);
    expect(penFX.getInfo().menus.lutAssets).toEqual({acceptReporters: true, items: 'getLUTMenu'});
});

test('renderer uses the LUT texture and dimensions independently of stage resolution', () => {
    class Engine {}
    installLUTEngine({Engine});
    const engine = new Engine();
    Object.assign(engine, {
        _isNoOp: amount => amount === 0,
        _prepare: () => 'skin',
        _program: name => name,
        _renderEffect: jest.fn(),
        textures: ['pen']
    });
    const entry = {size: 128, gpu: {texture: 'lut', width: 1536, height: 1408, columns: 12}};
    engine.lut(entry, 1, 'normal');
    expect(engine._renderEffect).toHaveBeenCalledWith('skin', 'lut', [
        {name: 'u_image', texture: 'pen'}, {name: 'u_lut', texture: 'lut'}
    ], {u_lutResolution: [1536, 1408], u_size: 128, u_columns: 12, u_mix: 1}, [], 'normal');
    engine.lut(entry, 0, 'normal');
    expect(engine._renderEffect).toHaveBeenCalledTimes(1);
});

// Keeps the lookup's alpha contract visible even on headless test runners without WebGL.
test('shader looks up straight RGB and restores premultiplied alpha', () => {
    const source = fs.readFileSync(path.join(PLUGINS_DIR, 'lut', 'shaders', 'lut.glsl'), 'utf8');
    expect(source).toContain('pixel.rgb / pixel.a');
    expect(source).toContain('* pixel.a, pixel.a');
});

test('detects every Genshade MultiLUT size and validates atlas selection', () => {
    for (const [width, height, size, count] of [[1024, 544, 32, 17], [4096, 1984, 64, 31],
        [4096, 3200, 64, 50]]) {
        expect(lutLayout(width, height)).toMatchObject({size, count, index: 0});
        expect(lutLayout(width, height, {index: count - 1})).toMatchObject({index: count - 1});
        expect(() => lutLayout(width, height, {index: count})).toThrow('LUT number');
    }
});

test('repacking selects the requested LUT without mixing adjacent atlases', () => {
    const pixels = new Uint8Array(16 * 8 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([Math.floor(i / (16 * 4)), 0, 0, 255], i);
    const layout = {width: 16, height: 8, ...lutLayout(16, 8, {index: 1, flipGreen: true})};
    const packed = packLUT(pixels, layout, 64);
    for (let b = 0; b < 4; b++) {
        for (let g = 0; g < 4; g++) {
            const offset = ((Math.floor(b / 2) * 4 + g) * packed.width + (b % 2) * 4) * 4;
            expect(packed.pixels[offset]).toBe(7 - g);
        }
    }
});

test('Hald lookup preserves linear RGB voxel ordering', () => {
    const layout = {width: 8, height: 8, ...lutLayout(8, 8, {mode: 'hald'})};
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let b = 0; b < 4; b++) for (let g = 0; g < 4; g++) for (let r = 0; r < 4; r++) {
        pixels.set([r, g, b, 255], (b * 16 + g * 4 + r) * 4);
    }
    const packed = packLUT(pixels, layout, 16);
    for (let b = 0; b < 4; b++) for (let g = 0; g < 4; g++) for (let r = 0; r < 4; r++) {
        const offset = ((Math.floor(b / 2) * 4 + g) * packed.width + (b % 2) * 4 + r) * 4;
        expect(Array.from(packed.pixels.slice(offset, offset + 4))).toEqual([r, g, b, 255]);
    }
    expect(() => lutLayout(512, 256, {mode: 'hald'})).toThrow('Hald');
});

test('layout changes reuse decoded pixels, survive save/load, and preserve the resource on invalid input', async () => {
    const {manager, vm, decode, upload} = makeManager();
    await manager.restore([{id: 'multi', name: 'Multi', data: toDataURL(pngHeader(16, 8))}]);
    manager.configure('multi', {mode: 'auto', index: 1, flipGreen: true});
    expect(decode).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    const gpu = manager.find('multi').gpu;
    expect(() => manager.configure('multi', {index: 2})).toThrow();
    expect(manager.find('multi').gpu).toBe(gpu);
    const project = JSON.parse(vm.toJSON());
    await vm.deserializeProject(project);
    expect(manager.find('multi')).toMatchObject({index: 1, count: 2, flipGreen: true});
});
