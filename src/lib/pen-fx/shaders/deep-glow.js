export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_threshold;
  uniform float u_radius;
  uniform float u_value;
  uniform vec3 u_color;

  void main() {
    vec4 base = texture2D(u_image, v_uv);
    vec3 baseColor = base.a > 0.00001 ? base.rgb / base.a : vec3(0.0);
    vec4 glow = vec4(0.0);
    float totalWeight = 0.0;
    for (int ring = 0; ring < 3; ring++) {
      float ringScale = exp2(float(ring));
      for (int i = 0; i < 16; i++) {
        float angle = (float(i) + float(ring) * 0.37) * 0.39269908169;
        vec2 offset = vec2(cos(angle), sin(angle)) * u_radius * ringScale / u_resolution;
        vec4 p = texture2D(u_image, v_uv + offset);
        vec3 sampleColor = p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
        float lum = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
        float selected = smoothstep(u_threshold - 0.02, u_threshold + 0.02, lum);
        float weight = 1.0 / ringScale;
        glow += vec4(p.rgb * selected, p.a * selected) * weight;
        totalWeight += weight;
      }
    }
    glow /= totalWeight;
    float alpha = max(base.a, glow.a);
    vec3 glowColor = glow.a > 0.00001 ? glow.rgb / glow.a : vec3(0.0);
    vec3 color = baseColor + glowColor * u_color * glow.a * u_value * 2.25;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
  }
`;
