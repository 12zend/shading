// ReShade emits desktop GLSL. Keep the math intact while adapting ES interface syntax.
const webglSource = (source, stage) => {
    source = source.replace(/^#extension GL_EXT_control_flow_attributes[^\n]*\n/gm, '');
    let code = source.replace('#version 430', '#version 300 es\n' +
        'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n');
    code = code.replace(/, binding = \d+/g, '').replace(/layout\(binding = \d+\) /g, '');
    code = code.replace(/layout\(location = (\d+)\) ((?:flat |noperspective |centroid |smooth )+)(in|out) /g,
        'layout(location = $1) $3 $2');
    const names = new Map();
    code = code.replace(/layout\(location = (\d+)\) (in|out) ((?:flat |noperspective |centroid |smooth )?\w+) (\w+)([^;]*;)/g,
        (match, location, qualifier, type, name, suffix) => {
            if ((stage === 'vertex' && qualifier === 'out') || (stage === 'fragment' && qualifier === 'in')) {
                names.set(name, `gs_varying_${location}`);
                const pieces = type.split(' ');
                return pieces.length > 1 ? `${pieces[0]} ${qualifier} ${pieces[1]} ${name}${suffix}` :
                    `${qualifier} ${type} ${name}${suffix}`;
            }
            return match;
        });
    names.forEach((name, original) => {
        code = code.replace(new RegExp(`\\b${original}\\b`, 'g'), name);
    });
    code = code.replace(/\bgl_VertexID\b/g, 'uint(gl_VertexID)')
        .replace(/#if GL_EXT_control_flow_attributes/g, '#if defined(GL_EXT_control_flow_attributes)');
    code = code.replace(/\b(fma|ldexp|textureOffset|textureGather|textureGatherOffset)\(/g, 'gs_$1(');
    let helpers = '';
    for (const type of ['float', 'vec2', 'vec3', 'vec4']) {
        const integerType = type === 'float' ? 'int' : `i${type}`;
        helpers += `${type} gs_fma(${type} a,${type} b,${type} c) {return a*b+c;}\n`;
        helpers += `${type} gs_ldexp(${type} a,${integerType} b) {return a*exp2(${type}(b));}\n`;
    }
    helpers += `vec4 gs_textureOffset(sampler2D s,vec2 p,ivec2 o) {
        return texture(s,p+vec2(o)/vec2(textureSize(s,0))); }
    vec4 gs_textureGather(sampler2D s,vec2 p,int c) {
        vec2 z=vec2(textureSize(s,0)); vec2 q=(floor(p*z-0.5)+0.5)/z;
        return vec4(textureLod(s,q+vec2(0.,1.)/z,0.)[c],textureLod(s,q+vec2(1.,1.)/z,0.)[c],
            textureLod(s,q+vec2(1.,0.)/z,0.)[c],textureLod(s,q,0.)[c]); }
    vec4 gs_textureGatherOffset(sampler2D s,vec2 p,ivec2 o,int c) {
        return gs_textureGather(s,p+vec2(o)/vec2(textureSize(s,0)),c); }\n`;
    code = code.replace('precision highp sampler2D;', `precision highp sampler2D;\n${helpers}`);
    if (stage === 'vertex') code = code.replace(/gl_Position = ([^;]+);/g,
        'gl_Position = $1; gl_Position.y = -gl_Position.y;');
    return code;
};
export default webglSource;
