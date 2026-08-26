import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import installPenFX from '../../../src/lib/pen-fx';
import {
    CUSTOM_SHADER_FORMAT,
    CUSTOM_SHADER_PROJECT_KEY,
    CUSTOM_SHADER_VERSION,
    PenFXCustomShaderManager,
    normalizePackage,
    opcodeFor,
    parseShaderZip
} from '../../../src/lib/pen-fx/custom-shaders';

const fragmentSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_amount;
uniform vec3 u_tint;
uniform int u_mode;
uniform float u_mix;
void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    vec3 changed = pixel.rgb + (u_tint * u_amount * 0.01) + vec3(float(u_mode) * 0.0);
    gl_FragColor = vec4(mix(pixel.rgb, changed, u_mix), pixel.a);
}
`;

const manifest = {
    format: CUSTOM_SHADER_FORMAT,
    version: CUSTOM_SHADER_VERSION,
    id: 'test-pack',
    name: 'Test Pack',
    blocks: [{
        id: 'tint-wave',
        name: 'tint wave',
        text: 'tint wave amount: [AMOUNT] tint: [TINT] mode: [MODE] mix: [MIX] %',
        file: 'tint-wave.glsl',
        inputs: [
            {id: 'AMOUNT', label: 'amount', type: 'number', defaultValue: 4, uniform: 'u_amount'},
            {id: 'TINT', label: 'tint', type: 'color', defaultValue: '#204080', uniform: 'u_tint'},
            {id: 'MODE', label: 'mode', type: 'menu', items: ['soft', 'hard'], uniform: 'u_mode'},
            {id: 'MIX', label: 'mix', type: 'number', defaultValue: 100, scale: 0.01, uniform: 'u_mix'}
        ]
    }]
};

const makeManifestZip = async () => {
    const zip = new JSZip();
    zip.file('shader/shading-shader.json', JSON.stringify(manifest));
    zip.file('shader/tint-wave.glsl', fragmentSource);
    return zip.generateAsync({type: 'uint8array'});
};

describe('Pen FX custom shader packages', () => {
    test('loads a manifest and its GLSL from a zip', async () => {
        const descriptor = await parseShaderZip(await makeManifestZip(), 'test-pack.zip');

        expect(descriptor.id).toBe('test-pack');
        expect(descriptor.name).toBe('Test Pack');
        expect(descriptor.blocks).toHaveLength(1);
        expect(descriptor.blocks[0].source).toContain('uniform float u_amount');
        expect(descriptor.blocks[0].inputs[3]).toMatchObject({
            id: 'MIX',
            scale: 0.01,
            uniform: 'u_mix'
        });
    });

    test('auto-discovers GLSL files when a manifest is omitted', async () => {
        const zip = new JSZip();
        zip.file('soft-glow.glsl', fragmentSource);
        zip.file('nested/color-shift.glsl', fragmentSource);
        const descriptor = await parseShaderZip(
            await zip.generateAsync({type: 'uint8array'}),
            'quick-effects.zip'
        );

        expect(descriptor.name).toBe('quick effects');
        expect(descriptor.blocks.map(block => block.name)).toEqual(['soft glow', 'color shift']);
        expect(descriptor.blocks.every(block => block.inputs.length === 0)).toBe(true);
    });

    test('rejects manifest inputs which target standard uniforms', () => {
        const invalid = JSON.parse(JSON.stringify(manifest));
        invalid.blocks[0].source = fragmentSource;
        invalid.blocks[0].inputs[0].uniform = 'u_time';

        expect(() => normalizePackage(invalid)).toThrow('invalid or reserved uniform u_time');
    });

    test('creates native toolbox UI and executes imported command blocks synchronously', async () => {
        const customShader = jest.fn();
        const vm = {
            runtime: {
                movieAssetManager: {timeline: {currentTime: 1.5, framerate: 24}}
            }
        };
        const penFX = {
            blendMode: 'normal',
            engine: null,
            _safe: callback => callback({customShader})
        };
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await manager.restorePackages([descriptor]);

        const toolbox = manager.getToolboxBlocks();
        expect(toolbox[0]).toMatchObject({blockType: 'label', text: 'Custom Shaders'});
        expect(toolbox[1]).toMatchObject({blockType: 'button', text: 'Import shader'});
        expect(toolbox.find(block => block && block.opcode === 'shader_test_pack_tint_wave')).toBeDefined();

        const result = penFX[opcodeFor('test-pack', 'tint-wave')]({
            AMOUNT: 8,
            TINT: '#204080',
            MODE: 'hard',
            MIX: 50
        });

        expect(result).toBeUndefined();
        expect(customShader).toHaveBeenCalledWith('custom:test-pack:tint-wave', {
            u_resolution: [0, 0],
            u_time: 1.5,
            u_frame: 36,
            u_amount: 8,
            u_tint: [32 / 255, 64 / 255, 128 / 255],
            u_mode: 1,
            u_mix: 0.5
        }, ['u_frame', 'u_mode'], 'normal');
    });

    test('registers imported command primitives which return undefined to the Scratch VM', async () => {
        const vm = new VM();
        vm.runtime.renderer = {};
        installPenFX(vm);
        const penFX = vm.runtime.penFX;
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await penFX.customShaders.restorePackages([descriptor]);
        penFX.engine = {
            blendOpacity: 1,
            customShader: jest.fn(),
            _restoreGLState: jest.fn()
        };

        const primitive = vm.runtime._primitives.penfx_shader_test_pack_tint_wave;
        expect(primitive({AMOUNT: 4, TINT: '#ffffff', MODE: 'soft', MIX: 100}, {})).toBeUndefined();
        expect(penFX.engine.customShader).toHaveBeenCalledTimes(1);
    });

    test('embeds packages in project JSON and restores them before project deserialization', async () => {
        const callOrder = [];
        const vm = {
            runtime: {},
            extensionManager: {
                isExtensionLoaded: () => true,
                refreshBlocks: jest.fn(async () => callOrder.push('refresh'))
            },
            toJSON: () => JSON.stringify({targets: []}),
            deserializeProject: async () => callOrder.push('deserialize')
        };
        const penFX = {engine: null};
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await manager.restorePackages([descriptor]);

        const saved = JSON.parse(vm.toJSON());
        expect(saved[CUSTOM_SHADER_PROJECT_KEY]).toHaveLength(1);
        expect(saved.mb3.features).toContain('pen-fx-shaders');

        callOrder.length = 0;
        await vm.deserializeProject(saved);
        expect(callOrder).toEqual(['refresh', 'deserialize']);
    });

});
