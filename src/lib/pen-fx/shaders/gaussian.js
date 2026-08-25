export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_direction;
  uniform float u_radius;
  uniform int u_radialType;
  uniform int u_twoDimensional;
  uniform vec2 u_center;
  uniform float u_mix;

  float axisWeight(float index, vec4 weights) {
    float i = abs(index);
    return i < 0.5 ? weights.x : i < 1.5 ? weights.y : i < 2.5 ? weights.z : weights.w;
  }

  void main() {
    if (u_radius <= 0.001) {
      gl_FragColor = texture2D(u_image, v_uv);
      return;
    }
    float sigma = max(u_radius * 0.38, 0.5);
    if (u_twoDimensional == 2) {
      float gridStep = max(u_radius / 3.0, 0.125);
      float exponent = -0.5 * gridStep * gridStep / (sigma * sigma);
      vec4 axisWeights = exp(vec4(0.0, 1.0, 4.0, 9.0) * exponent);
      vec2 direction = u_direction / u_resolution;
      vec4 lineTotal = vec4(0.0);
      float lineWeight = 0.0;
      for (int i = -3; i <= 3; i++) {
        float weight = axisWeight(float(i), axisWeights);
        lineTotal += texture2D(u_image, v_uv + direction * float(i) * gridStep) * weight;
        lineWeight += weight;
      }
      vec4 blurred = lineTotal / lineWeight;
      float mixValue = clamp(u_mix, 0.0, 1.0);
      gl_FragColor = mixValue == 1.0 ? blurred : mix(texture2D(u_image, v_uv), blurred, mixValue);
      return;
    }
    if (u_twoDimensional == 1) {
      float gridStep = max(u_radius / 3.0, 0.125);
      float exponent = -0.5 * gridStep * gridStep / (sigma * sigma);
      vec4 axisWeights = exp(vec4(0.0, 1.0, 4.0, 9.0) * exponent);
      vec4 gridTotal = vec4(0.0);
      float gridWeight = 0.0;
      for (int y = -3; y <= 3; y++) {
        for (int x = -3; x <= 3; x++) {
          vec2 offset = vec2(float(x), float(y)) * gridStep;
          float weight = axisWeight(float(x), axisWeights) * axisWeight(float(y), axisWeights);
          gridTotal += texture2D(u_image, v_uv + offset / u_resolution) * weight;
          gridWeight += weight;
        }
      }
      vec4 blurred = gridTotal / gridWeight;
      float mixValue = clamp(u_mix, 0.0, 1.0);
      gl_FragColor = mixValue == 1.0 ? blurred : mix(texture2D(u_image, v_uv), blurred, mixValue);
      return;
    }
    vec2 direction = u_direction;
    if (u_radialType >= 0) {
      vec2 pixelFromCenter = v_uv * u_resolution - (u_resolution * 0.5 + u_center);
      float distanceFromCenter = length(pixelFromCenter);
      vec2 radial = distanceFromCenter > 0.001 ? pixelFromCenter / distanceFromCenter : vec2(1.0, 0.0);
      direction = u_radialType == 0 ? vec2(-radial.y, radial.x) : radial;
    }
    direction /= u_resolution;
    float stepSize = max(u_radius / 12.0, 0.125);
    vec4 total = texture2D(u_image, v_uv);
    float totalWeight = 1.0;
    for (int i = 1; i <= 12; i++) {
      float offset = float(i) * stepSize;
      float weight = exp(-0.5 * offset * offset / (sigma * sigma));
      total += (texture2D(u_image, v_uv - direction * offset) +
                texture2D(u_image, v_uv + direction * offset)) * weight;
      totalWeight += weight * 2.0;
    }
    vec4 blurred = total / totalWeight;
    float mixValue = clamp(u_mix, 0.0, 1.0);
    gl_FragColor = mixValue == 1.0 ? blurred : mix(texture2D(u_image, v_uv), blurred, mixValue);
  }
`;
