export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_mode;
  uniform int u_type;
  uniform float u_value;
  uniform float u_value2;
  uniform float u_value3;
  uniform float u_mix;
  uniform vec2 u_vec;
  uniform vec3 u_color;
  uniform vec3 u_color2;

  vec3 straightColor(vec4 p) { return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0); }
  float luminance(vec4 p) { return dot(straightColor(p), vec3(0.2126, 0.7152, 0.0722)); }
  float edgeSignal(vec4 p) { return (luminance(p) * 0.75 + p.a * 0.25) * p.a; }

  void main() {
    vec2 px = 1.0 / u_resolution;
    vec4 center = texture2D(u_image, v_uv);
    vec4 result = center;

    if (u_mode == 0) {
      vec4 tlPixel = texture2D(u_image, v_uv + px * vec2(-u_value2, u_value2));
      vec4 tcPixel = texture2D(u_image, v_uv + px * vec2(0.0, u_value2));
      vec4 trPixel = texture2D(u_image, v_uv + px * vec2(u_value2, u_value2));
      vec4 mlPixel = texture2D(u_image, v_uv + px * vec2(-u_value2, 0.0));
      vec4 mrPixel = texture2D(u_image, v_uv + px * vec2(u_value2, 0.0));
      vec4 blPixel = texture2D(u_image, v_uv + px * vec2(-u_value2, -u_value2));
      vec4 bcPixel = texture2D(u_image, v_uv + px * vec2(0.0, -u_value2));
      vec4 brPixel = texture2D(u_image, v_uv + px * vec2(u_value2, -u_value2));
      float tl = edgeSignal(tlPixel);
      float tc = edgeSignal(tcPixel);
      float tr = edgeSignal(trPixel);
      float ml = edgeSignal(mlPixel);
      float mr = edgeSignal(mrPixel);
      float bl = edgeSignal(blPixel);
      float bc = edgeSignal(bcPixel);
      float br = edgeSignal(brPixel);
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
      float edge = smoothstep(u_value, u_value + max(u_value3, 0.0001), length(vec2(gx, gy)));
      vec4 neighborhood = center + tlPixel + tcPixel + trPixel + mlPixel + mrPixel + blPixel + bcPixel + brPixel;
      vec3 sourceColor = neighborhood.a > 0.00001 ? neighborhood.rgb / neighborhood.a : vec3(0.0);
      float tintStrength = max(u_color.r, max(u_color.g, u_color.b));
      vec3 lineColor = mix(sourceColor, u_color, tintStrength);
      float neighborhoodAlpha = max(center.a, max(max(tlPixel.a, tcPixel.a), max(trPixel.a,
        max(mlPixel.a, max(mrPixel.a, max(blPixel.a, max(bcPixel.a, brPixel.a)))))));
      float a = edge * neighborhoodAlpha * clamp(u_vec.x, 0.0, 1.0);
      if (u_vec.y > 0.5) {
        result = vec4(lineColor * a + u_color2 * (1.0 - a), 1.0);
      } else {
        result = vec4(lineColor * a, a);
      }
    } else if (u_mode == 1) {
      float m = luminance(center);
      float n = luminance(texture2D(u_image, v_uv + vec2(0.0, px.y)));
      float e = luminance(texture2D(u_image, v_uv + vec2(px.x, 0.0)));
      float s = luminance(texture2D(u_image, v_uv - vec2(0.0, px.y)));
      float w = luminance(texture2D(u_image, v_uv - vec2(px.x, 0.0)));
      float contrast = max(m, max(n, max(e, max(s, w)))) - min(m, min(n, min(e, min(s, w))));
      if (contrast >= max(u_value, u_value2 * max(m, 0.001))) {
        float horizontal = abs(n + s - 2.0 * m);
        float vertical = abs(e + w - 2.0 * m);
        vec2 direction = horizontal >= vertical ? vec2(0.0, px.y) : vec2(px.x, 0.0);
        vec4 aa = (texture2D(u_image, v_uv - direction * 0.5) + texture2D(u_image, v_uv + direction * 0.5)) * 0.5;
        result = mix(center, aa, clamp(u_value3, 0.0, 1.0));
      }
    } else if (u_mode == 2) {
      vec2 pos = (v_uv - vec2(0.5) - u_vec) * u_value2;
      float mask = pow(clamp(length(pos), 0.0, 1.0), max(u_value3, 0.01)) * u_value;
      vec2 direction = pos * mask;
      vec4 r = texture2D(u_image, v_uv + direction);
      vec4 g = texture2D(u_image, v_uv);
      vec4 b = texture2D(u_image, v_uv - direction);
      float a = max(r.a, max(g.a, b.a));
      result = vec4(vec3(straightColor(r).r, straightColor(g).g, straightColor(b).b) * a, a);
    } else if (u_mode == 3) {
      vec4 small = vec4(0.0);
      vec4 large = vec4(0.0);
      float sw = 0.0;
      float lw = 0.0;
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          vec2 o = vec2(float(x), float(y));
          float ds = exp(-dot(o, o) / max(2.0 * u_value * u_value, 0.001));
          float dl = exp(-dot(o, o) / max(2.0 * u_value2 * u_value2, 0.001));
          vec4 samplePixel = texture2D(u_image, v_uv + o * px);
          small += samplePixel * ds; sw += ds;
          large += samplePixel * dl; lw += dl;
        }
      }
      float edge = luminance(small / sw) - u_value3 * luminance(large / lw);
      float ink = smoothstep(-u_vec.x, u_vec.x, edge);
      vec3 c = u_type == 0 ? vec3(ink) : mix(u_color, straightColor(center), ink);
      result = vec4(c * center.a, center.a);
    } else if (u_mode == 4) {
      float radius = max(u_value, 1.0);
      vec4 mean0 = vec4(0.0); vec4 mean1 = vec4(0.0);
      vec4 mean2 = vec4(0.0); vec4 mean3 = vec4(0.0);
      vec4 square0 = vec4(0.0); vec4 square1 = vec4(0.0);
      vec4 square2 = vec4(0.0); vec4 square3 = vec4(0.0);
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          vec2 o = vec2(float(x), float(y)) * radius * 0.5;
          vec4 samplePixel = texture2D(u_image, v_uv + o * px);
          if (x <= 0 && y <= 0) { mean0 += samplePixel; square0 += samplePixel * samplePixel; }
          if (x >= 0 && y <= 0) { mean1 += samplePixel; square1 += samplePixel * samplePixel; }
          if (x <= 0 && y >= 0) { mean2 += samplePixel; square2 += samplePixel * samplePixel; }
          if (x >= 0 && y >= 0) { mean3 += samplePixel; square3 += samplePixel * samplePixel; }
        }
      }
      mean0 /= 9.0; mean1 /= 9.0; mean2 /= 9.0; mean3 /= 9.0;
      vec3 var0 = abs(square0.rgb / 9.0 - mean0.rgb * mean0.rgb);
      vec3 var1 = abs(square1.rgb / 9.0 - mean1.rgb * mean1.rgb);
      vec3 var2 = abs(square2.rgb / 9.0 - mean2.rgb * mean2.rgb);
      vec3 var3 = abs(square3.rgb / 9.0 - mean3.rgb * mean3.rgb);
      float best = var0.r + var0.g + var0.b; result = mean0;
      float sigma = var1.r + var1.g + var1.b; if (sigma < best) { best = sigma; result = mean1; }
      sigma = var2.r + var2.g + var2.b; if (sigma < best) { best = sigma; result = mean2; }
      sigma = var3.r + var3.g + var3.b; if (sigma < best) result = mean3;
    } else {
      vec2 uv = (v_uv - vec2(0.5) - u_vec) * u_value + vec2(0.5);
      if (u_type == 1) uv = abs(mod(uv + 1.0, 2.0) - 1.0);
      else if (u_type == 2) uv = fract(uv);
      if (u_type == 3 && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))) result = vec4(u_color, 0.0);
      else result = texture2D(u_image, clamp(uv, 0.0, 1.0));
    }

    gl_FragColor = mix(center, result, clamp(u_mix, 0.0, 1.0));
  }
`;
