import {
    inferShaderInputs,
    parseShaderUniforms
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
});
