export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_value;
  uniform float u_zoom;
  uniform float u_mix;

  void main() {
    vec2 center = u_resolution * 0.5 + u_center;
    vec2 fromCenter = v_uv * u_resolution - center;
    float radiusScale = max(min(u_resolution.x, u_resolution.y) * 0.5, 1.0);
    vec2 normalized = fromCenter / radiusScale;
    float radiusSquared = dot(normalized, normalized);
    float distortion = max(0.02, 1.0 + u_value * radiusSquared);
    vec2 uv = (center + fromCenter * distortion / max(u_zoom, 0.01)) / u_resolution;
    float mixValue = clamp(u_mix, 0.0, 1.0);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      gl_FragColor = mixValue == 1.0 ? vec4(0.0) : mix(texture2D(u_image, v_uv), vec4(0.0), mixValue);
    } else {
      vec4 distortedPixel = texture2D(u_image, uv);
      gl_FragColor = mixValue == 1.0 ? distortedPixel : mix(texture2D(u_image, v_uv), distortedPixel, mixValue);
    }
  }
`;
