import {
    PenFXCustomShaderManager,
    opcodeFor
} from '../../../src/lib/pen-fx/custom-shaders';

const source = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_offset;
uniform bool u_enabled;
void main() {
    gl_FragColor = texture2D(u_image, v_uv + u_offset);
}
`;

const makeManager = () => {
    const customShader = jest.fn();
    const engine = {
        customShader,
        registerCustomShader: jest.fn(),
        unregisterCustomShader: jest.fn(),
        validateCustomShader: jest.fn(shaderSource => {
            if (shaderSource.indexOf('// broken') !== -1) throw new Error('compile failed');
        })
    };
    const vm = {
        runtime: {
            emitProjectChanged: jest.fn(),
            movieAssetManager: {timeline: {currentTime: 2, framerate: 30}}
        },
        extensionManager: {
            isExtensionLoaded: () => true,
            refreshBlocks: jest.fn(async () => undefined)
        }
    };
    const penFX = {
        blendMode: 'normal',
        engine: null,
        _getEngine: () => {
            penFX.engine = engine;
            return engine;
        },
        _safe: callback => callback(engine)
    };
    return {customShader, engine, manager: new PenFXCustomShaderManager(vm, penFX), penFX, vm};
};

describe('editable Pen FX shaders', () => {
    test('creates a block and executes its inferred scalar and vector arguments synchronously', async () => {
        const {customShader, manager, penFX} = makeManager();
        const shader = await manager.createShader({name: 'Offset', source});

        expect(shader.inputs.map(input => input.id)).toEqual(['OFFSET_X', 'OFFSET_Y', 'ENABLED']);
        const result = penFX[opcodeFor('offset', 'main')]({
            OFFSET_X: 0.25,
            OFFSET_Y: -0.5,
            ENABLED: true
        });

        expect(result).toBeUndefined();
        expect(result).not.toBeInstanceOf(Promise);
        expect(customShader).toHaveBeenCalledWith('custom:offset:main', {
            u_resolution: [0, 0],
            u_time: 2,
            u_frame: 60,
            u_offset: [0.25, -0.5],
            u_enabled: 1
        }, ['u_frame', 'u_enabled'], 'normal');
    });

    test('updates names, source, and arguments atomically after validation', async () => {
        const {manager, vm} = makeManager();
        const shader = await manager.createShader({name: 'Offset', source});
        const updated = await manager.updateShader(shader.key, {
            name: 'Offset Plus',
            source: source.replace('uniform bool u_enabled;', 'uniform bool u_enabled; uniform float u_amount;')
        });

        expect(updated.name).toBe('Offset Plus');
        expect(updated.inputs.map(input => input.id)).toEqual(['OFFSET_X', 'OFFSET_Y', 'ENABLED', 'AMOUNT']);
        await expect(manager.updateShader(shader.key, {source: `${source}\n// broken`})).rejects.toThrow(
            'compile failed'
        );
        expect(manager.getShader(shader.key).source).toContain('uniform float u_amount');
        expect(vm.runtime.emitProjectChanged).toHaveBeenCalledTimes(2);
    });

    test('duplicates and deletes individual shader blocks', async () => {
        const {manager} = makeManager();
        const shader = await manager.createShader({name: 'Offset', source});
        const duplicate = await manager.duplicateShader(shader.key);

        expect(duplicate.name).toBe('Offset copy');
        expect(manager.getShaders()).toHaveLength(2);
        expect(await manager.deleteShader(shader.key)).toBe(true);
        expect(manager.getShaders().map(item => item.name)).toEqual(['Offset copy']);
    });

    test('adds a numeric suffix when newly created shader names would collide', async () => {
        const {manager} = makeManager();

        await manager.createShader({source});
        await manager.createShader({source});
        await manager.createShader({source});

        expect(manager.getShaders().map(shader => shader.name)).toEqual(['Shader', 'Shader 2', 'Shader 3']);
    });
});
