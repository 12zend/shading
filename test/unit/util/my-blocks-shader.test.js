import installMyBlocksShader, {
    MyBlocksShaderManager,
    ShaderExpressionCompiler
} from '../../../src/lib/my-blocks-shader';

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
        expect(source).toContain('pixel.rgb / pixel.a');
        expect(source).toContain('clamp(vec3(');
        expect(source).toContain('), 0.0, 1.0);');
        expect(source).not.toContain('255.0');
        expect(source).toContain('u_arg_arg_v');
        expect(uniforms).toEqual({u_arg_arg_v: 1.5, u_random_seed: 1});
    });

    test('returns the sampled RGB color directly from coordinates', () => {
        const target = makeTarget();
        const blocks = target.blocks._blocks;
        blocks.return.opcode = 'myblocksshader_return_from';
        blocks.return.inputs = {
            X: valueInput('cx-r'),
            Y: valueInput('cy-r')
        };
        const vm = {runtime: {renderer: {}}};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();

        expect(manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, {target})).toBeUndefined();
        const [source] = manager.engine.apply.mock.calls[0];
        expect(source).toContain('vec3 shaderColor = clamp(shaderSample(cx, cy), 0.0, 1.0);');
    });

    test('supports variables, bounded control flow, runtime reporters, lists and constant strings', () => {
        const target = makeTarget();
        const blocks = target.blocks._blocks;
        blocks.definition.next = 'set-shade';
        blocks['set-shade'] = {
            opcode: 'data_setvariableto',
            fields: {VARIABLE: {value: 'shade', id: 'shade-id'}},
            inputs: {VALUE: valueInput('mouse-x')},
            next: 'repeat'
        };
        blocks['mouse-x'] = {opcode: 'sensing_mousex'};
        blocks.repeat = {
            opcode: 'control_repeat',
            inputs: {TIMES: valueInput('repeat-count'), SUBSTACK: valueInput('check-shade')},
            next: 'return'
        };
        blocks['repeat-count'] = {opcode: 'math_whole_number', fields: {NUM: {value: '3'}}};
        blocks['check-shade'] = {
            opcode: 'control_if',
            inputs: {CONDITION: valueInput('shade-is-high'), SUBSTACK: valueInput('change-shade')},
            next: null
        };
        blocks['shade-is-high'] = {
            opcode: 'operator_gt',
            inputs: {OPERAND1: valueInput('shade-in-condition'), OPERAND2: valueInput('ten')}
        };
        blocks['shade-in-condition'] = {
            opcode: 'data_variable',
            fields: {VARIABLE: {value: 'shade', id: 'shade-id'}}
        };
        blocks.ten = {opcode: 'math_number', fields: {NUM: {value: '10'}}};
        blocks['change-shade'] = {
            opcode: 'data_changevariableby',
            fields: {VARIABLE: {value: 'shade', id: 'shade-id'}},
            inputs: {VALUE: valueInput('two')},
            next: null
        };
        blocks.two = {opcode: 'math_number', fields: {NUM: {value: '2'}}};
        blocks.return.inputs = {
            R: valueInput('shade-output'),
            G: valueInput('list-length'),
            B: valueInput('string-length')
        };
        blocks['shade-output'] = {
            opcode: 'data_variable',
            fields: {VARIABLE: {value: 'shade', id: 'shade-id'}}
        };
        blocks['list-length'] = {
            opcode: 'data_lengthoflist',
            fields: {LIST: {value: 'numbers', id: 'numbers-id'}}
        };
        blocks['string-length'] = {opcode: 'operator_length', inputs: {STRING: valueInput('hello')}};
        blocks.hello = {opcode: 'text', fields: {TEXT: {value: 'Hello'}}};
        target.variables = {
            'shade-id': {name: 'shade', type: '', value: 7},
            'numbers-id': {name: 'numbers', type: 'list', value: [5, 10, 15]}
        };

        const vm = {runtime: {
            renderer: {},
            ioDevices: {mouse: {getScratchX: jest.fn(() => 42)}}
        }};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();

        expect(manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, {target})).toBeUndefined();
        const [source, uniforms] = manager.engine.apply.mock.calls[0];
        expect(source).toContain('float s_var_shade_id;');
        expect(source).toContain('for (int s_loop_0 = 0; s_loop_0 < 256; s_loop_0++)');
        expect(source).toContain('if (((s_var_shade_id) > (10.0)))');
        expect(source).toContain('vec3(s_var_shade_id, u_list_numbers_id_length, 5.0)');
        expect(uniforms).toEqual(expect.objectContaining({
            u_var_shade_id: 7,
            u_reporter_sensing_mousex: 42,
            u_list_numbers_id_length: 3
        }));
    });

    test('compiles every standard Scratch operator reporter', () => {
        const dynamic = {
            opcode: 'argument_reporter_string_number',
            fields: {VALUE: {value: 'dynamic'}}
        };
        const number = {opcode: 'math_number', fields: {NUM: {value: '2'}}};
        const text = {opcode: 'text', fields: {TEXT: {value: 'hello'}}};
        const blocks = {
            dynamic,
            number,
            text,
            add: {opcode: 'operator_add', inputs: {NUM1: valueInput('dynamic'), NUM2: valueInput('number')}},
            subtract: {opcode: 'operator_subtract', inputs: {NUM1: valueInput('dynamic'), NUM2: valueInput('number')}},
            multiply: {opcode: 'operator_multiply', inputs: {NUM1: valueInput('dynamic'), NUM2: valueInput('number')}},
            divide: {opcode: 'operator_divide', inputs: {NUM1: valueInput('dynamic'), NUM2: valueInput('number')}},
            mod: {opcode: 'operator_mod', inputs: {NUM1: valueInput('dynamic'), NUM2: valueInput('number')}},
            round: {opcode: 'operator_round', inputs: {NUM: valueInput('dynamic')}},
            mathop: {
                opcode: 'operator_mathop',
                fields: {OPERATOR: {value: 'abs'}},
                inputs: {NUM: valueInput('dynamic')}
            },
            random: {opcode: 'operator_random', inputs: {FROM: valueInput('dynamic'), TO: valueInput('number')}},
            lt: {
                opcode: 'operator_lt',
                inputs: {OPERAND1: valueInput('dynamic'), OPERAND2: valueInput('number')}
            },
            gt: {
                opcode: 'operator_gt',
                inputs: {OPERAND1: valueInput('dynamic'), OPERAND2: valueInput('number')}
            },
            equals: {
                opcode: 'operator_equals',
                inputs: {OPERAND1: valueInput('dynamic'), OPERAND2: valueInput('number')}
            },
            and: {
                opcode: 'operator_and',
                inputs: {OPERAND1: valueInput('lt'), OPERAND2: valueInput('gt')}
            },
            or: {
                opcode: 'operator_or',
                inputs: {OPERAND1: valueInput('lt'), OPERAND2: valueInput('gt')}
            },
            not: {opcode: 'operator_not', inputs: {OPERAND: valueInput('equals')}},
            join: {
                opcode: 'operator_join',
                inputs: {STRING1: valueInput('dynamic'), STRING2: valueInput('text')}
            },
            length: {opcode: 'operator_length', inputs: {STRING: valueInput('dynamic')}},
            letter: {
                opcode: 'operator_letter_of',
                inputs: {LETTER: valueInput('number'), STRING: valueInput('dynamic')}
            },
            contains: {
                opcode: 'operator_contains',
                inputs: {STRING1: valueInput('dynamic'), STRING2: valueInput('text')}
            }
        };
        const compiler = new ShaderExpressionCompiler(blocks, [], []);

        expect(Object.keys(blocks).filter(id => !['dynamic', 'number', 'text'].includes(id)))
            .toHaveLength(18);
        for (const id of Object.keys(blocks)) {
            if (['dynamic', 'number', 'text'].includes(id)) continue;
            expect(() => compiler.expression(id)).not.toThrow();
        }
    });

    test('compiles a reporter custom block used by an RGB expression', () => {
        const target = makeTarget();
        const blocks = target.blocks._blocks;
        blocks.return.inputs.R = valueInput('twice-call');
        blocks['twice-call'] = {
            opcode: 'procedures_call',
            mutation: {proccode: 'twice %s', argumentids: '["normal-arg"]', return: 'true'},
            inputs: {'normal-arg': valueInput('five')}
        };
        blocks.five = {opcode: 'math_number', fields: {NUM: {value: '5'}}};
        blocks['normal-definition'] = {
            opcode: 'procedures_definition',
            inputs: {custom_block: {block: 'normal-prototype'}},
            next: 'normal-return'
        };
        blocks['normal-prototype'] = {
            opcode: 'procedures_prototype',
            parent: 'normal-definition',
            mutation: {
                proccode: 'twice %s',
                argumentnames: '["n"]',
                argumentids: '["normal-arg"]',
                argumentdefaults: '["0"]',
                return: 'true'
            }
        };
        blocks['normal-return'] = {
            opcode: 'procedures_return',
            inputs: {VALUE: valueInput('normal-multiply')},
            next: null
        };
        blocks['normal-multiply'] = {
            opcode: 'operator_multiply',
            inputs: {NUM1: valueInput('normal-argument'), NUM2: valueInput('normal-two')}
        };
        blocks['normal-argument'] = {
            opcode: 'argument_reporter_string_number',
            fields: {VALUE: {value: 'n'}}
        };
        blocks['normal-two'] = {opcode: 'math_number', fields: {NUM: {value: '2'}}};

        const vm = {runtime: {renderer: {}}};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();

        expect(manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, {target})).toBeUndefined();
        const [source] = manager.engine.apply.mock.calls[0];
        expect(source).toContain('float s_proc_twice_s(float s_arg_normal_arg)');
        expect(source).toContain('return ((s_arg_normal_arg) * (2.0));');
        expect(source).toContain('vec3(s_proc_twice_s(5.0)');
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
        expect(vm.runtime._primitives.myblocksshader_return_from({}, {})).toBeUndefined();
        expect(manager.returnRGB()).toBeUndefined();
        expect(vm.runtime._primitives.myblocksshader_get_r({}, {})).toBe(0);
        const addon = vm.runtime.getAddonBlock('contrast %s');
        expect(addon.namesIdsDefaults).toEqual([['v'], ['arg-v'], ['1']]);
        expect(addon.myBlocksShader).toBe(true);
        expect(addon.callback({v: 2}, {target})).toBeUndefined();
        expect(manager.engine.apply).toHaveBeenCalledTimes(1);
        expect(installMyBlocksShader(vm)).toBe(manager);
    });

    test('reuses one compiled artifact while the definition is unchanged', () => {
        const vm = {runtime: {renderer: {}}};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();
        const util = {target: makeTarget()};

        manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, util);
        manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 2}, util);

        expect(manager.engine.apply).toHaveBeenCalledTimes(2);
        const sources = manager.engine.apply.mock.calls.map(call => call[0]);
        expect(sources[1]).toBe(sources[0]);
        expect(manager.compiledShaders.size).toBe(1);
        expect(Object.values(manager.engine.apply.mock.calls[1][1])).toContain(2);
    });

    test('recompiles when the definition body changes', () => {
        const vm = {runtime: {renderer: {}}};
        const manager = new MyBlocksShaderManager(vm);
        manager.engine.apply = jest.fn();
        const target = makeTarget();
        const util = {target};

        manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, util);
        target.blocks._blocks['red-times-value'].opcode = 'operator_subtract';
        manager.call({mutation: {shaderid: 'shader-id'}, 'arg-v': 1}, util);

        expect(manager.engine.apply).toHaveBeenCalledTimes(2);
        const sources = manager.engine.apply.mock.calls.map(call => call[0]);
        expect(sources[1]).not.toBe(sources[0]);
        expect(manager.compiledShaders.size).toBe(2);
    });

    test('clears deduplicated errors when a new project loads', () => {
        const listeners = {};
        const vm = {
            on: (name, handler) => {
                listeners[name] = handler;
            },
            runtime: {renderer: {}}
        };
        const manager = new MyBlocksShaderManager(vm);
        manager.errors.add('boom');

        listeners['project-loaded']();

        expect(manager.errors.size).toBe(0);
    });
});
