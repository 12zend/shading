export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec3 u_color;
  uniform float u_width;

  float sampleAlpha(vec2 uv) {
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
    return texture2D(u_image, uv).a;
  }

  void main() {
    vec4 base = texture2D(u_image, v_uv);
    float expandedAlpha = base.a;
    vec2 sampleStep = vec2(u_width / 8.0) / u_resolution;
    for (int y = -8; y <= 8; y++) {
      for (int x = -8; x <= 8; x++) {
        vec2 offset = vec2(float(x), float(y));
        if (dot(offset, offset) <= 64.0) {
          expandedAlpha = max(expandedAlpha, sampleAlpha(v_uv + offset * sampleStep));
        }
      }
    }
    float strokeAlpha = expandedAlpha * (1.0 - base.a);
    gl_FragColor = vec4(base.rgb + u_color * strokeAlpha, base.a + strokeAlpha);
  }
`;
