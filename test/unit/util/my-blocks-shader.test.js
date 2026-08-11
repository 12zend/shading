import installMyBlocksShader, {MyBlocksShaderManager} from '../../../src/lib/my-blocks-shader';

const valueInput = block => ({name: '', block, shadow: block});

describe('My Blocks Shader', () => {
    const makeTarget = () => {
        const blocks = {
            definition: {
                id: 'definition',
                opcode: 'procedures_definition',
                inputs: {custom_block: {block: 'prototype'}},
                next: 'return'
            },
            prototype: {
                id: 'prototype',
                opcode: 'procedures_prototype',
                parent: 'definition',
                mutation: {
                    myblocksshader: 'true',
                    shaderid: 'shader-id',
                    shaderuserproccode: 'contrast %s',
                    shaderuserargumentnames: '["v"]',
                    shaderuserargumentids: '["arg-v"]',
                    shaderuserargumentdefaults: '["1"]'
                }
            },
            return: {
                id: 'return',
                opcode: 'myblocksshader_return',
                inputs: {
                    R: valueInput('red-times-value'),
                    G: valueInput('get-green'),
                    B: valueInput('get-blue')
                },
                next: null
            },
            'red-times-value': {
                opcode: 'operator_multiply',
                inputs: {
                    NUM1: valueInput('get-red'),
                    NUM2: valueInput('value')
                }
            },
            'get-red': {
                opcode: 'myblocksshader_get_r',
                inputs: {X: valueInput('cx-r'), Y: valueInput('cy-r')}
            },
            'get-green': {
                opcode: 'myblocksshader_get_g',
                inputs: {X: valueInput('cx-g'), Y: valueInput('cy-g')}
            },
            'get-blue': {
                opcode: 'myblocksshader_get_b',
                inputs: {X: valueInput('cx-b'), Y: valueInput('cy-b')}
            },
            value: {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'v'}}},
            'cx-r': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cx'}}},
            'cy-r': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cy'}}},
            'cx-g': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cx'}}},
            'cy-g': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cy'}}},
            'cx-b': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cx'}}},
            'cy-b': {opcode: 'argument_reporter_string_number', fields: {VALUE: {value: 'cy'}}}
        };
        return {blocks: {_blocks: blocks}};
    };

    test('compiles a definition to a single GPU pass using the pre-effect texture', () => {
        const vm = {runtime: {renderer: {}}};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();
        const result = manager.call({
            mutation: {shaderid: 'shader-id'},
            'arg-v': 1.5
        }, {target: makeTarget()});

        expect(result).toBeUndefined();
        expect(manager.engine.apply).toHaveBeenCalledTimes(1);
        const [source, uniforms] = manager.engine.apply.mock.calls[0];
        expect(source).toContain('uniform sampler2D u_image');
        expect(source).toContain('texture2D(u_image, clamp(uv');
        expect(source).toContain('shaderSample(cx, cy).r');
        expect(source).toContain('u_arg_arg_v');
        expect(uniforms).toEqual({u_arg_arg_v: 1.5});
    });

    test('all shader command primitives return immediately without a Promise', () => {
        const target = makeTarget();
        const vm = {runtime: {
            renderer: {},
            _primitives: {},
            targets: [target],
            getAddonBlock: jest.fn(() => null)
        }};
        const manager = installMyBlocksShader(vm);
        manager.engine.apply = jest.fn();

        expect(vm.runtime._primitives.myblocksshader_return({}, {})).toBeUndefined();
        expect(manager.returnRGB()).toBeUndefined();
        expect(vm.runtime._primitives.myblocksshader_get_r({}, {})).toBe(0);
        const addon = vm.runtime.getAddonBlock('contrast %s');
        expect(addon.namesIdsDefaults).toEqual([['v'], ['arg-v'], ['1']]);
        expect(addon.myBlocksShader).toBe(true);
        expect(addon.callback({v: 2}, {target})).toBeUndefined();
        expect(manager.engine.apply).toHaveBeenCalledTimes(1);
        expect(installMyBlocksShader(vm)).toBe(manager);
    });
});
