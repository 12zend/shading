import {
    inferShaderInputs,
    parseShaderUniforms,
    setUniformInputType
} from '../../../src/lib/pen-fx/shader-uniforms';

describe('Pen FX shader uniform discovery', () => {
    test('finds declarations while ignoring comments and standard uniforms', () => {
        const source = `
            // uniform float u_hidden;
            /* uniform vec4 u_also_hidden; */
            uniform sampler2D u_image;
            uniform highp vec2 u_resolution;
            uniform float u_time, u_amount;
            uniform int u_frame;
            uniform vec3 u_offset;
            uniform bvec2 u_enabled;
        `;

        expect(parseShaderUniforms(source)).toEqual([
            {name: 'u_image', type: 'sampler2D'},
            {name: 'u_resolution', type: 'vec2'},
            {name: 'u_time', type: 'float'},
            {name: 'u_amount', type: 'float'},
            {name: 'u_frame', type: 'int'},
            {name: 'u_offset', type: 'vec3'},
            {name: 'u_enabled', type: 'bvec2'}
        ]);

        expect(inferShaderInputs(source)).toEqual([
            expect.objectContaining({id: 'AMOUNT', uniform: 'u_amount', type: 'number'}),
            expect.objectContaining({id: 'OFFSET_X', uniform: 'u_offset', component: 0, vectorSize: 3}),
            expect.objectContaining({id: 'OFFSET_Y', uniform: 'u_offset', component: 1, vectorSize: 3}),
            expect.objectContaining({id: 'OFFSET_Z', uniform: 'u_offset', component: 2, vectorSize: 3}),
            expect.objectContaining({id: 'ENABLED_X', uniform: 'u_enabled', type: 'boolean'}),
            expect.objectContaining({id: 'ENABLED_Y', uniform: 'u_enabled', type: 'boolean'})
        ]);
    });

    test('rejects unsupported samplers, arrays, and invalid standard uniform types', () => {
        expect(() => inferShaderInputs('uniform sampler2D u_mask;')).toThrow('Only the standard sampler2D');
        expect(() => inferShaderInputs('uniform float u_weights[4];')).toThrow('Uniform arrays are not supported');
        expect(() => inferShaderInputs('uniform vec2 u_time;')).toThrow('u_time must use type float');
    });

    test('enforces the block input limit after expanding vectors', () => {
        const uniforms = Array(7).fill(0).map((_, index) => `uniform vec4 u_value_${index};`).join('\n');
        expect(() => inferShaderInputs(uniforms, 24)).toThrow('create 28 block inputs');
    });

    test('turns @color and @menu comments into color and menu inputs', () => {
        const source = `
            uniform vec3 u_tint; // tint colour @color #f80
            uniform vec4 u_glow; /* @color */
            uniform int u_mode; // @menu soft, hard, glow @default hard
            uniform float u_shape; // @menu circle,square
            uniform vec2 u_offset; // @default 0.5, -1
            uniform bool u_enabled; // @default true
            uniform float u_amount; // @todo is not an annotation
        `;

        expect(inferShaderInputs(source)).toEqual([
            {id: 'TINT', label: 'tint', type: 'color', uniform: 'u_tint', uniformType: 'vec3', defaultValue: '#ff8800'},
            {id: 'GLOW', label: 'glow', type: 'color', uniform: 'u_glow', uniformType: 'vec4', defaultValue: '#ffffff'},
            {
                id: 'MODE',
                label: 'mode',
                type: 'menu',
                uniform: 'u_mode',
                uniformType: 'int',
                items: ['soft', 'hard', 'glow'],
                defaultValue: 'hard'
            },
            {
                id: 'SHAPE',
                label: 'shape',
                type: 'menu',
                uniform: 'u_shape',
                uniformType: 'float',
                items: ['circle', 'square'],
                defaultValue: 'circle'
            },
            expect.objectContaining({id: 'OFFSET_X', type: 'number', defaultValue: 0.5}),
            expect.objectContaining({id: 'OFFSET_Y', type: 'number', defaultValue: -1}),
            expect.objectContaining({id: 'ENABLED', type: 'boolean', defaultValue: true}),
            expect.objectContaining({id: 'AMOUNT', type: 'number', defaultValue: 0})
        ]);
    });

    test('only reads annotations from the comment that ends the declaration line', () => {
        const source = `
            // @color #ff0000
            uniform vec3 u_before;
            uniform vec3 u_first; uniform vec3 u_second; // @color
        `;
        expect(inferShaderInputs(source).map(input => `${input.id}:${input.type}`)).toEqual([
            'BEFORE_X:number', 'BEFORE_Y:number', 'BEFORE_Z:number',
            'FIRST_X:number', 'FIRST_Y:number', 'FIRST_Z:number',
            'SECOND:color'
        ]);
    });

    test('rejects annotations that do not fit the uniform', () => {
        expect(() => inferShaderInputs('uniform float u_tint; // @color')).toThrow('@color needs a vec3 or vec4');
        expect(() => inferShaderInputs('uniform vec3 u_tint; // @color red')).toThrow('must be a hex color');
        expect(() => inferShaderInputs('uniform vec2 u_mode; // @menu a, b')).toThrow('@menu needs an int or float');
        expect(() => inferShaderInputs('uniform int u_mode; // @menu')).toThrow('needs at least one item');
        expect(() => inferShaderInputs('uniform int u_mode; // @menu a, a')).toThrow('must be unique');
        expect(() => inferShaderInputs('uniform int u_mode; // @menu a, b @default c')).toThrow('one of its @menu');
        expect(() => inferShaderInputs('uniform vec3 u_mode; // @color @menu a')).toThrow('both @color and @menu');
        expect(() => inferShaderInputs('uniform vec3 u_offset; // @default 1, 2')).toThrow('1 or 3');
        expect(() => inferShaderInputs('uniform float u_amount; // @default lots')).toThrow('must be a number');
    });

    test('rewrites the declaration comment to change a uniform block input', () => {
        const source = [
            'uniform vec3 u_tint; // base tint',
            'uniform int u_mode; // @menu soft, hard',
            'uniform float u_amount, u_mix;',
            'void main() {}'
        ].join('\n');

        const colored = setUniformInputType(source, 'u_tint', {type: 'color', defaultValue: '#336699'});
        expect(colored.split('\n')[0]).toBe('uniform vec3 u_tint; // base tint @color #336699');

        const menu = setUniformInputType(colored, 'u_mode', {
            type: 'menu',
            items: ['soft', 'hard', 'glow'],
            defaultValue: 'glow'
        });
        expect(menu.split('\n')[1]).toBe('uniform int u_mode; // @menu soft, hard, glow @default glow');

        const plain = setUniformInputType(menu, 'u_mode', {type: 'number'});
        expect(plain.split('\n')[1]).toBe('uniform int u_mode;');
        expect(inferShaderInputs(plain).map(input => input.type)).toEqual(['color', 'integer', 'number', 'number']);

        expect(() => setUniformInputType(source, 'u_mix', {type: 'menu', items: ['a']}))
            .toThrow('in its own uniform statement');
        expect(() => setUniformInputType(source, 'u_mode', {type: 'menu', items: ['a, b']}))
            .toThrow('cannot contain commas');
        expect(() => setUniformInputType(source, 'u_amount_missing', {type: 'number'})).toThrow('was not found');
    });
});
