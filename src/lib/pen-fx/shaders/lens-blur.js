export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_radius;
  uniform float u_blades;
  uniform float u_rotation;
  uniform float u_mix;

  float polygonScale(float angle, float blades) {
    if (blades < 3.0) return 1.0;
    float sector = 6.28318530718 / blades;
    float localAngle = mod(angle + sector * 0.5, sector) - sector * 0.5;
    return cos(3.14159265359 / blades) / max(cos(localAngle), 0.001);
  }

  void main() {
    if (u_radius <= 0.001) {
      gl_FragColor = texture2D(u_image, v_uv);
      return;
    }
    vec4 original = texture2D(u_image, v_uv);
    vec4 total = original * 1.5;
    float totalWeight = 1.5;
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5;
      float angle = fi * 2.39996322973;
      float radius = sqrt(fi / 32.0) * u_radius * polygonScale(angle - radians(u_rotation), u_blades);
      float weight = 1.0 + radius / max(u_radius, 0.001) * 0.35;
      vec2 offset = vec2(cos(angle), sin(angle)) * radius / u_resolution;
      total += texture2D(u_image, v_uv + offset) * weight;
      totalWeight += weight;
    }
    gl_FragColor = mix(original, total / totalWeight, clamp(u_mix, 0.0, 1.0));
  }
`;
