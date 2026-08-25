export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_value;
  uniform float u_seed;
  uniform vec2 u_offset;
  uniform vec2 u_center;
  uniform float u_size;
  uniform float u_complexity;
  uniform float u_evolution;
  uniform int u_type;
  uniform float u_mix;

  vec4 sampleImage(vec2 uv) {
    return texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
  }

  float hash(vec2 p) {
    p += vec2(u_seed * 0.127, u_seed * 0.311);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      float active = step(float(i) + 0.5, clamp(u_complexity, 1.0, 8.0));
      value += amplitude * (noise(p) * 2.0 - 1.0) * active;
      total += amplitude * active;
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return value / max(total, 0.0001);
  }

  void main() {
    float scale = max(abs(u_size), 0.0001);
    vec2 evolution = vec2(cos(radians(u_evolution)), sin(radians(u_evolution))) * 4.0;
    vec2 p = ((v_uv * u_resolution) + u_offset) / scale + evolution;
    float nx = fbm(p);
    float ny = fbm(p + vec2(31.7, 47.2));
    vec2 center = u_resolution * 0.5 + u_center;
    vec2 displaced = v_uv;
    if (u_type == 0) {
      displaced -= vec2(nx, ny) * u_value / u_resolution;
    } else if (u_type == 1) {
      displaced.x -= nx * u_value / max(u_resolution.x, 1.0);
    } else if (u_type == 2) {
      displaced.y -= ny * u_value / max(u_resolution.y, 1.0);
    } else if (u_type == 3) {
      float scaleAmount = max(0.01, 1.0 + nx * u_value / 100.0);
      displaced = (center + (v_uv * u_resolution - center) / scaleAmount) / u_resolution;
    } else {
      float angle = radians(nx * u_value);
      vec2 offset = v_uv * u_resolution - center;
      mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      displaced = (center + rotation * offset) / u_resolution;
    }
    vec4 displacedPixel = sampleImage(displaced);
    float mixValue = clamp(u_mix, 0.0, 1.0);
    gl_FragColor = mixValue == 1.0 ? displacedPixel : mix(texture2D(u_image, v_uv), displacedPixel, mixValue);
  }
`;
