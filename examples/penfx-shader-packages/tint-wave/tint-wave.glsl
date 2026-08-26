precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_frame;
uniform float u_amount;
uniform vec3 u_tint;
uniform int u_mode;
uniform float u_mix;

vec3 straightColor(vec4 pixel) {
  return pixel.a > 0.00001 ? pixel.rgb / pixel.a : vec3(0.0);
}

void main() {
  vec4 pixel = texture2D(u_image, v_uv);
  vec3 original = straightColor(pixel);
  float wave = sin((v_uv.y * 24.0) + u_time * 2.0) * u_amount * 0.01;
  float strength = u_mode == 0 ? 0.5 : 1.0;
  vec3 changed = original + (u_tint * wave * strength);
  vec3 result = mix(original, changed, clamp(u_mix, 0.0, 1.0));
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * pixel.a, pixel.a);
}
