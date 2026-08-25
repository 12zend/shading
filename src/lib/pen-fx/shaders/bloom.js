export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_threshold;
  uniform float u_radius;
  uniform float u_value;
  uniform int u_invert;
  uniform vec3 u_color;

  float axisWeight(float index, vec4 weights) {
    float i = abs(index);
    return i < 0.5 ? weights.x : i < 1.5 ? weights.y : i < 2.5 ? weights.z : weights.w;
  }

  void main() {
    vec4 base = texture2D(u_image, v_uv);
    vec3 c = base.a > 0.00001 ? base.rgb / base.a : vec3(0.0);
    float sigma = max(u_radius * 0.38, 0.5);
    float gridStep = max(u_radius / 3.0, 0.125);
    float exponent = -0.5 * gridStep * gridStep / (sigma * sigma);
    vec4 axisWeights = exp(vec4(0.0, 1.0, 4.0, 9.0) * exponent);
    vec4 glow = vec4(0.0);
    float totalWeight = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec2 offset = vec2(float(x), float(y)) * gridStep;
        float weight = axisWeight(float(x), axisWeights) * axisWeight(float(y), axisWeights);
        vec4 p = texture2D(u_image, v_uv + offset / u_resolution);
        vec3 sampleColor = p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
        float luminance = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
        if (u_invert == 0) {
          float selected = smoothstep(u_threshold - 0.015, u_threshold + 0.015, luminance);
          glow += vec4(p.rgb * selected, p.a * selected) * weight;
        } else {
          float selected = 1.0 - smoothstep(u_threshold - 0.015, u_threshold + 0.015, luminance);
          float darkness = (1.0 - luminance) * selected * p.a;
          glow += vec4(vec3(darkness), darkness) * weight;
        }
        totalWeight += weight;
      }
    }
    glow /= totalWeight;
    float alpha = max(base.a, glow.a);
    if (u_invert == 0) {
      vec3 g = glow.a > 0.00001 ? glow.rgb / glow.a : vec3(0.0);
      c += g * u_color * glow.a * u_value;
    } else {
      c -= vec3(glow.r * u_value);
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
  }
`;
