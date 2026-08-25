export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_mode;
  uniform int u_type;
  uniform float u_value;
  uniform float u_radius;
  uniform vec2 u_center;
  uniform vec2 u_offset;
  uniform vec2 u_anchor;
  uniform vec2 u_blockSize;
  uniform float u_size;
  uniform float u_direction;
  uniform float u_width;
  uniform float u_frequency;
  uniform float u_mix;

  void main() {
    vec2 uv = v_uv;
    if (u_mode == 0) {
      vec2 centerPixel = u_resolution * 0.5 + u_center;
      vec2 fromCenter = v_uv * u_resolution - centerPixel;
      float distanceFromCenter = length(fromCenter);
      vec2 radial = distanceFromCenter > 0.001 ? fromCenter / distanceFromCenter : vec2(1.0, 0.0);
      float width = max(abs(u_width), 0.001);
      float envelope = exp(-abs(distanceFromCenter - abs(u_radius)) / width);
      float wave = sin((distanceFromCenter - abs(u_radius)) * u_frequency) * envelope;
      uv -= radial * wave * u_value / u_resolution;
    } else if (u_mode == 1) {
      vec2 blockSize = max(floor(abs(u_blockSize) + 0.5), vec2(1.0));
      vec2 pixel = floor((v_uv * u_resolution - u_offset) / blockSize) * blockSize + blockSize * 0.5 + u_offset;
      uv = pixel / u_resolution;
    } else if (u_mode == 2) {
      vec2 mirrorCenter = u_resolution * 0.5 + u_center;
      vec2 pixel = v_uv * u_resolution;
      if (u_type == 0 || u_type == 2) pixel.x = 2.0 * mirrorCenter.x - pixel.x;
      if (u_type == 1 || u_type == 2) pixel.y = 2.0 * mirrorCenter.y - pixel.y;
      uv = pixel / u_resolution;
    } else {
      vec2 anchor = u_resolution * 0.5 + u_anchor;
      vec2 pixel = v_uv * u_resolution - anchor - u_offset;
      float scale = max(abs(u_size) / 100.0, 0.0001);
      pixel /= scale;
      float angle = radians(-u_direction);
      mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      pixel = rotation * pixel;
      uv = (pixel + anchor) / u_resolution;
      if (u_mode == 4) uv = fract(uv);
    }
    float mixValue = clamp(u_mix, 0.0, 1.0);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      gl_FragColor = mixValue == 1.0 ? vec4(0.0) : mix(texture2D(u_image, v_uv), vec4(0.0), mixValue);
    } else {
      vec4 transformedPixel = texture2D(u_image, uv);
      gl_FragColor = mixValue == 1.0 ? transformedPixel : mix(texture2D(u_image, v_uv), transformedPixel, mixValue);
    }
  }
`;
