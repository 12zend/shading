import fs from 'fs';
import PenFXLUTManager, {
    lutLayout, packLUT, pngDimensions, fromDataURL, toDataURL
} from '../../../scratch-vm/src/lib/pen-fx/luts';
import {createPenFXClass} from '../../../src/lib/pen-fx';
import installColor from '../../../scratch-render/src/pen-fx/effects/color';

const pngHeader = (width, height) => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

const makeManager = () => {
    const vm = {
        runtime: {renderer: {_gl: {deleteTexture: jest.fn()}}, emitProjectChanged: jest.fn()},
        toJSON: () => JSON.stringify({targets: []}),
        deserializeProject: jest.fn(async () => 'loaded')
    };
    const decode = jest.fn(async () => new Uint8Array(32));
    const upload = jest.fn(() => ({texture: {}, width: 4, height: 2, columns: 2}));
    const manager = new PenFXLUTManager(vm, {decode, upload});
    return {manager, vm, decode, upload};
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
    const vm = {runtime: {renderer: {}}};
    const PenFX = createPenFXClass(vm);
    const penFX = new PenFX();
    const entry = {id: 'test', name: 'Test', gpu: {texture: {}}};
    penFX.luts.items.push(entry);
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
    installColor({Engine});
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
    const source = fs.readFileSync('scratch-render/src/pen-fx/shaders/lut.js', 'utf8');
    expect(source).toContain('pixel.rgb / pixel.a');
    expect(source).toContain('* pixel.a, pixel.a');
});
