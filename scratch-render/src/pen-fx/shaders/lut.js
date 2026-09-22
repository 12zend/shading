export default `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform vec2 u_lutResolution;
uniform float u_size;
uniform float u_columns;
uniform float u_mix;

vec3 lookupSlice(vec2 rg, float slice) {
    vec2 tile = vec2(mod(slice, u_columns), floor(slice / u_columns));
    vec2 pixel = tile * u_size + rg * (u_size - 1.0) + 0.5;
    return texture2D(u_lut, pixel / u_lutResolution).rgb;
}

void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    vec3 original = pixel.a > 0.00001 ? pixel.rgb / pixel.a : vec3(0.0);
    vec3 coordinate = clamp(original, 0.0, 1.0);
    float blue = coordinate.b * (u_size - 1.0);
    float lower = floor(blue);
    vec3 mapped = mix(lookupSlice(coordinate.rg, lower),
        lookupSlice(coordinate.rg, min(lower + 1.0, u_size - 1.0)), fract(blue));
    gl_FragColor = vec4(mix(original, mapped, clamp(u_mix, 0.0, 1.0)) * pixel.a, pixel.a);
}
`;
