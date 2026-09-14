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

  float gaussianWeight(float index, float stepSize, float negHalfInvSigmaSq) {
    float offset = index * stepSize;
    return exp(offset * offset * negHalfInvSigmaSq);
  }

  void main() {
    vec4 center = texture2D(u_image, v_uv);
    float mixValue = clamp(u_mix, 0.0, 1.0);
    if (u_radius <= 0.001) {
      gl_FragColor = center;
      return;
    }
    float sigma = max(u_radius * 0.38, 0.5);
    float invSigmaSq = 1.0 / (sigma * sigma);
    float negHalfInvSigmaSq = -0.5 * invSigmaSq;
    vec2 invResolution = 1.0 / u_resolution;
    if (u_twoDimensional == 2) {
      float gridStep = max(u_radius / 6.0, 0.0625);
      vec2 stepVec = u_direction * invResolution * gridStep;
      float lineWeight = 0.0;
      vec4 lineTotal = vec4(0.0);
      for (int i = -6; i <= 6; i++) {
        float weight = gaussianWeight(float(i), gridStep, negHalfInvSigmaSq);
        lineTotal += texture2D(u_image, v_uv + stepVec * float(i)) * weight;
        lineWeight += weight;
      }
      vec4 blurred = lineTotal / lineWeight;
      gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
      return;
    }
    if (u_twoDimensional == 1) {
      float gridStep = max(u_radius / 6.0, 0.0625);
      vec2 scaledStep = gridStep * invResolution;
      float gridWeight = 0.0;
      vec4 gridTotal = vec4(0.0);
      for (int y = -6; y <= 6; y++) {
        float wy = gaussianWeight(float(y), gridStep, negHalfInvSigmaSq);
        for (int x = -6; x <= 6; x++) {
          float weight = gaussianWeight(float(x), gridStep, negHalfInvSigmaSq) * wy;
          gridTotal += texture2D(u_image, v_uv + vec2(float(x), float(y)) * scaledStep) * weight;
          gridWeight += weight;
        }
      }
      vec4 blurred = gridTotal / gridWeight;
      gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
      return;
    }
    vec2 direction = u_direction;
    if (u_radialType >= 0) {
      vec2 pixelFromCenter = v_uv * u_resolution - u_resolution * 0.5 - u_center;
      float distanceFromCenter = length(pixelFromCenter);
      vec2 radial = distanceFromCenter > 0.001 ? pixelFromCenter / distanceFromCenter : vec2(1.0, 0.0);
      direction = u_radialType == 0 ? vec2(-radial.y, radial.x) : radial;
    }
    direction *= invResolution;
    float stepSize = max(u_radius / 24.0, 0.0625);
    vec2 stepDelta = direction * stepSize;
    vec4 total = center;
    float totalWeight = 1.0;
    for (int i = 1; i <= 24; i++) {
      float fi = float(i);
      float offset = fi * stepSize;
      float weight = exp(offset * offset * negHalfInvSigmaSq);
      vec2 delta = stepDelta * fi;
      total += (texture2D(u_image, v_uv - delta) +
                texture2D(u_image, v_uv + delta)) * weight;
      totalWeight += weight * 2.0;
    }
    vec4 blurred = total / totalWeight;
    gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
  }
`;
