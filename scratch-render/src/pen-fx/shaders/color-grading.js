// Easy color grading: one pass that evaluates every module of a preset so a grade never exposes an
// intermediate frame. Spatial modules sample the input around the pixel before the color pipeline runs.
export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_mix;

  uniform vec4 u_primaryA;      // temperature, tint, exposure (EV), strength
  uniform vec4 u_primaryB;      // contrast, highlights, shadows, whites
  uniform vec4 u_primaryC;      // blacks, saturation, vibrance, hue (radians)
  uniform vec4 u_primaryD;      // highlight boost, highlight rolloff, output black, output white
  uniform vec3 u_wheelShadows;
  uniform vec3 u_wheelMidtones;
  uniform vec3 u_wheelHighlights;
  uniform vec3 u_curveA;        // output at 0, 0.25, 0.5
  uniform vec2 u_curveB;        // output at 0.75, 1
  uniform vec2 u_mojo;          // amount, skin protection
  uniform vec3 u_mixerR;
  uniform vec3 u_mixerG;
  uniform vec3 u_mixerB;
  uniform vec3 u_hueShiftA;     // red, yellow, green (radians)
  uniform vec3 u_hueShiftB;     // cyan, blue, magenta (radians)
  uniform vec3 u_hueSatA;
  uniform vec3 u_hueSatB;
  uniform vec3 u_hueLumA;
  uniform vec3 u_hueLumB;
  uniform vec3 u_secondaryRange;  // center, width, softness (0-1 hue units)
  uniform vec3 u_secondaryAdjust; // hue shift (0-1 hue units), saturation, lightness
  uniform vec2 u_film;          // stock, amount
  uniform vec3 u_remapShadow;
  uniform vec3 u_remapMid;
  uniform vec3 u_remapHigh;
  uniform float u_remapAmount;
  uniform vec3 u_duoDark;
  uniform vec3 u_duoLight;
  uniform float u_duoAmount;
  uniform vec2 u_shoulder;      // amount, start
  uniform vec2 u_posterize;     // levels, amount
  uniform vec3 u_grain;         // amount, size, color
  uniform vec2 u_sharpen;       // amount, radius (px at 720p)
  uniform float u_spectrum;     // radial channel separation (uv)
  uniform float u_lens;         // distortion coefficient
  uniform vec2 u_breath;        // amount, speed
  uniform vec4 u_key;           // center, width, softness, outside saturation
  uniform vec4 u_vignette;      // amount, midpoint, roundness, feather
  uniform vec2 u_diffuse;       // amount, radius (px at 720p)
  uniform vec3 u_halation;      // amount, threshold, radius (px at 720p)
  uniform vec3 u_halationColor;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec4 sampleImage(vec2 uv) {
    return texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
  }

  vec3 straight(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  float hueDistance(float a, float b) {
    float d = abs(a - b);
    return min(d, 1.0 - d);
  }

  float hueMask(float hue, float center, float width, float softness) {
    float d = hueDistance(hue, center);
    return 1.0 - smoothstep(width * 0.5, width * 0.5 + max(softness, 0.0001), d);
  }

  // Six hue anchors (R, Y, G, C, B, M) with triangular weights that sum to one.
  float anchorWeight(float hue, float anchor) {
    return max(0.0, 1.0 - hueDistance(hue, anchor) * 6.0);
  }

  float hueCurve(float hue, vec3 a, vec3 b) {
    return anchorWeight(hue, 0.0) * a.x + anchorWeight(hue, 1.0 / 6.0) * a.y +
      anchorWeight(hue, 2.0 / 6.0) * a.z + anchorWeight(hue, 3.0 / 6.0) * b.x +
      anchorWeight(hue, 4.0 / 6.0) * b.y + anchorWeight(hue, 5.0 / 6.0) * b.z;
  }

  float catmull(float p0, float p1, float p2, float p3, float t) {
    return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t +
      (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
  }

  float toneCurve(float x) {
    x = clamp(x, 0.0, 1.0);
    float y0 = u_curveA.x;
    float y1 = u_curveA.y;
    float y2 = u_curveA.z;
    float y3 = u_curveB.x;
    float y4 = u_curveB.y;
    float s = x * 4.0;
    if (s < 1.0) return catmull(2.0 * y0 - y1, y0, y1, y2, s);
    if (s < 2.0) return catmull(y0, y1, y2, y3, s - 1.0);
    if (s < 3.0) return catmull(y1, y2, y3, y4, s - 2.0);
    return catmull(y2, y3, y4, 2.0 * y4 - y3, min(s - 3.0, 1.0));
  }

  vec3 filmStock(vec3 c, float stock) {
    float l = dot(c, LUMA);
    vec3 s = c * c * (3.0 - 2.0 * c);
    if (stock < 1.5) {
      // Warm print: gentle S-curve, dense warm highlights, teal-leaning shadows.
      vec3 r = mix(c, s, 0.55);
      r += vec3(0.04, 0.01, -0.05) * smoothstep(0.35, 1.0, l);
      r += vec3(-0.03, 0.01, 0.03) * (1.0 - smoothstep(0.0, 0.45, l));
      return mix(vec3(dot(r, LUMA)), r, 1.08);
    }
    if (stock < 2.5) {
      // Cool negative: soft contrast, lifted blacks, green-cyan shadows and pastel color.
      vec3 r = mix(c, vec3(0.5), 0.12) + 0.03;
      r += vec3(-0.03, 0.02, 0.02) * (1.0 - smoothstep(0.0, 0.5, l));
      r += vec3(0.02, 0.01, -0.01) * smoothstep(0.55, 1.0, l);
      return mix(vec3(dot(r, LUMA)), r, 0.9);
    }
    if (stock < 3.5) {
      // Slide: high contrast, saturated with deep blues.
      vec3 r = mix(c, s, 0.8);
      r.b = mix(r.b, r.b * r.b, 0.15);
      return mix(vec3(dot(r, LUMA)), r, 1.3);
    }
    if (stock < 4.5) {
      // Bleach bypass: silver retained on top of the color image.
      vec3 overlay = mix(2.0 * c * l, 1.0 - 2.0 * (1.0 - c) * (1.0 - l), step(0.5, l));
      return mix(vec3(l), overlay, 0.55);
    }
    if (stock < 5.5) {
      // Silver mono: panchromatic black-and-white with a film toe and shoulder.
      float m = dot(c, vec3(0.3, 0.59, 0.11));
      m = m * m * (3.0 - 2.0 * m);
      return vec3(m);
    }
    // Cine negative: cyan shadows with warm midtones and restrained saturation.
    vec3 r = mix(c, s, 0.35);
    r += vec3(-0.04, 0.0, 0.035) * (1.0 - smoothstep(0.0, 0.5, l));
    r += vec3(0.035, 0.012, -0.02) * smoothstep(0.3, 0.8, l) * (1.0 - smoothstep(0.8, 1.0, l));
    return mix(vec3(dot(r, LUMA)), r, 0.92);
  }

  void main() {
    vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
    float pixelScale = u_resolution.y / 720.0;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);

    // Lens distortion keeps the corners anchored so the frame never reveals clamped borders.
    vec2 uv = v_uv;
    if (u_lens != 0.0) {
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
      float corner = 0.25 * (aspect * aspect + 1.0);
      p *= (1.0 + u_lens * dot(p, p)) / (1.0 + u_lens * corner);
      uv = p / vec2(aspect, 1.0) + 0.5;
    }

    vec4 center = sampleImage(uv);
    vec4 base = center;
    if (u_spectrum != 0.0) {
      vec2 d = uv - 0.5;
      vec4 red = sampleImage(0.5 + d * (1.0 + u_spectrum));
      vec4 blue = sampleImage(0.5 + d * (1.0 - u_spectrum));
      base = vec4(red.r, center.g, blue.b, max(center.a, max(red.a, blue.a)));
    }
    vec4 original = sampleImage(v_uv);
    float alpha = base.a;

    if (u_sharpen.x > 0.0) {
      vec2 o = texel * max(u_sharpen.y * pixelScale, 0.5);
      vec4 blur = (sampleImage(uv + vec2(o.x, 0.0)) + sampleImage(uv - vec2(o.x, 0.0)) +
        sampleImage(uv + vec2(0.0, o.y)) + sampleImage(uv - vec2(0.0, o.y))) * 0.25;
      base.rgb = max(base.rgb + (base.rgb - blur.rgb) * u_sharpen.x, vec3(0.0));
    }

    vec3 c = clamp(straight(base), 0.0, 1.0);

    // Diffusion and halation spread light from a Vogel disk around the pixel.
    if (u_diffuse.x > 0.0 || u_halation.x > 0.0) {
      vec3 soft = vec3(0.0);
      vec3 halo = vec3(0.0);
      float diffuseRadius = u_diffuse.y * pixelScale;
      float haloRadius = u_halation.z * pixelScale;
      for (int i = 0; i < 16; i++) {
        float f = float(i) + 0.5;
        float r = sqrt(f / 16.0);
        float a = f * 2.39996323;
        vec2 dir = vec2(cos(a), sin(a)) * r * texel;
        if (u_diffuse.x > 0.0) soft += sampleImage(uv + dir * diffuseRadius).rgb;
        if (u_halation.x > 0.0) {
          vec3 h = sampleImage(uv + dir * haloRadius).rgb;
          halo += max(h - vec3(u_halation.y), vec3(0.0));
        }
      }
      soft /= 16.0;
      halo /= 16.0;
      if (u_diffuse.x > 0.0) {
        vec3 softStraight = alpha > 0.00001 ? min(soft / alpha, vec3(1.0)) : soft;
        vec3 screen = 1.0 - (1.0 - c) * (1.0 - softStraight);
        c = mix(c, max(c, mix(softStraight, screen, 0.5)), u_diffuse.x);
      }
      if (u_halation.x > 0.0) {
        float energy = dot(halo, LUMA) / max(1.0 - u_halation.y, 0.05);
        c += u_halationColor * energy * u_halation.x * 1.5;
      }
    }

    vec3 source = c;

    // Film breath: slow exposure and color density drift between frames.
    float exposure = u_primaryA.z;
    if (u_breath.x > 0.0) {
      float t = u_time * max(u_breath.y, 0.01);
      float n = sin(t * 6.1) * 0.5 + sin(t * 13.7 + 1.3) * 0.3 + (hash(vec2(floor(t * 12.0), 7.0)) - 0.5) * 0.4;
      float drift = sin(t * 3.3 + 2.0) * 0.6 + (hash(vec2(floor(t * 12.0), 3.0)) - 0.5) * 0.4;
      exposure += n * u_breath.x * 0.12;
      c *= vec3(1.0 + drift * u_breath.x * 0.025, 1.0, 1.0 - drift * u_breath.x * 0.025);
    }

    // Exposure, white balance and highlight boost operate on approximately linear light.
    vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2)) * exp2(exposure);
    vec3 balance = vec3(1.0 + u_primaryA.x * 0.22 + u_primaryA.y * 0.08, 1.0 - u_primaryA.y * 0.16,
      1.0 - u_primaryA.x * 0.22 + u_primaryA.y * 0.08);
    lin *= balance / dot(balance, LUMA);
    if (u_primaryD.x > 0.0) {
      float l = dot(lin, LUMA);
      lin *= 1.0 + u_primaryD.x * smoothstep(0.35, 1.0, l) * 0.8;
    }
    c = pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2));

    // Tone: contrast around middle grey, then zone-weighted highlight/shadow/white/black offsets.
    c = (c - 0.46) * (1.0 + u_primaryB.x) + 0.46;
    float luma = clamp(dot(c, LUMA), 0.0, 1.0);
    float shadowZone = 1.0 - smoothstep(0.0, 0.55, luma);
    float highlightZone = smoothstep(0.45, 1.0, luma);
    float whiteZone = smoothstep(0.7, 1.0, luma);
    float blackZone = 1.0 - smoothstep(0.0, 0.3, luma);
    c += u_primaryB.y * 0.22 * highlightZone + u_primaryB.z * 0.22 * shadowZone +
      u_primaryB.w * 0.18 * whiteZone + u_primaryC.x * 0.14 * blackZone;

    // Shadow / midtone / highlight color wheels.
    luma = clamp(dot(c, LUMA), 0.0, 1.0);
    float midZone = 1.0 - abs(luma - 0.5) * 2.0;
    c += u_wheelShadows * (1.0 - smoothstep(0.0, 0.5, luma)) + u_wheelMidtones * midZone * midZone +
      u_wheelHighlights * smoothstep(0.5, 1.0, luma);

    // Master tone curve.
    c = vec3(toneCurve(c.r), toneCurve(c.g), toneCurve(c.b));

    // Channel mixer.
    c = vec3(dot(c, u_mixerR), dot(c, u_mixerG), dot(c, u_mixerB));

    // Saturation, vibrance and hue rotation.
    luma = dot(c, LUMA);
    c = mix(vec3(luma), c, max(0.0, 1.0 + u_primaryC.y));
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float skin = hueMask(hsv.x, 0.07, 0.08, 0.06);
    float vibrance = u_primaryC.z * (1.0 - hsv.y) * (1.0 - skin * 0.5);
    c = mix(vec3(luma), c, max(0.0, 1.0 + vibrance));
    if (u_primaryC.w != 0.0) {
      float cosA = cos(u_primaryC.w);
      float sinA = sin(u_primaryC.w);
      vec3 k = vec3(0.57735);
      c = c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
    }

    // Look (Mojo): complementary teal/orange separation that protects skin tones.
    if (u_mojo.x != 0.0) {
      hsv = rgb2hsv(clamp(c, 0.0, 1.0));
      float protect = hueMask(hsv.x, 0.07, 0.1, 0.06) * u_mojo.y;
      float l = dot(c, LUMA);
      vec3 teal = vec3(-0.06, 0.01, 0.07) * (1.0 - smoothstep(0.15, 0.65, l));
      vec3 warm = vec3(0.06, 0.02, -0.05) * smoothstep(0.35, 0.9, l);
      c += (teal + warm) * u_mojo.x * (1.0 - protect);
      c = mix(vec3(dot(c, LUMA)), c, 1.0 + u_mojo.x * 0.15 * (1.0 - protect));
    }

    // Hue curves and HSL secondary.
    hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float satWeight = smoothstep(0.02, 0.2, hsv.y);
    float hueShift = hueCurve(hsv.x, u_hueShiftA, u_hueShiftB) / 6.28318530718;
    float hueSat = hueCurve(hsv.x, u_hueSatA, u_hueSatB);
    float hueLum = hueCurve(hsv.x, u_hueLumA, u_hueLumB);
    if (u_secondaryRange.y > 0.0) {
      float mask = hueMask(hsv.x, u_secondaryRange.x, u_secondaryRange.y, u_secondaryRange.z) * satWeight;
      hueShift += u_secondaryAdjust.x * mask;
      hueSat += u_secondaryAdjust.y * mask;
      hueLum += u_secondaryAdjust.z * mask;
    }
    if (hueShift != 0.0 || hueSat != 0.0 || hueLum != 0.0) {
      hsv.x = fract(hsv.x + hueShift * satWeight);
      hsv.y = clamp(hsv.y * max(0.0, 1.0 + hueSat * satWeight), 0.0, 1.0);
      hsv.z = max(0.0, hsv.z * (1.0 + hueLum * satWeight));
      c = hsv2rgb(hsv);
    }

    // HSL key: keep one hue family and pull everything else toward monochrome.
    if (u_key.y > 0.0) {
      hsv = rgb2hsv(clamp(c, 0.0, 1.0));
      float mask = hueMask(hsv.x, u_key.x, u_key.y, u_key.z) * smoothstep(0.05, 0.2, hsv.y);
      c = mix(vec3(dot(c, LUMA)), c, mix(u_key.w, 1.0, mask));
    }

    c = clamp(c, 0.0, 1.5);
    if (u_film.y > 0.0) c = mix(c, filmStock(clamp(c, 0.0, 1.0), u_film.x), u_film.y);

    luma = clamp(dot(c, LUMA), 0.0, 1.0);
    if (u_remapAmount > 0.0) {
      vec3 remap = luma < 0.5 ? mix(u_remapShadow, u_remapMid, luma * 2.0) :
        mix(u_remapMid, u_remapHigh, luma * 2.0 - 1.0);
      c = mix(c, remap, u_remapAmount);
    }
    if (u_duoAmount > 0.0) {
      c = mix(c, mix(u_duoDark, u_duoLight, smoothstep(0.0, 1.0, luma)), u_duoAmount);
    }

    // Shoulder compresses luminance above its start; highlight rolloff softly clips each channel.
    if (u_shoulder.x > 0.0) {
      float l = dot(c, LUMA);
      float start = clamp(u_shoulder.y, 0.2, 0.95);
      if (l > start) {
        float range = 1.0 - start;
        float compressed = start + range * (1.0 - exp(-(l - start) / range));
        c *= mix(1.0, compressed / max(l, 0.0001), u_shoulder.x);
      }
    }
    if (u_primaryD.y > 0.0) {
      vec3 knee = vec3(1.0 - u_primaryD.y * 0.4);
      vec3 over = max(c - knee, vec3(0.0));
      vec3 room = 1.0 - knee;
      c = min(c, knee) + room * (1.0 - exp(-over / max(room, vec3(0.0001))));
    }

    c = clamp(c, 0.0, 1.0);
    if (u_posterize.x >= 2.0 && u_posterize.y > 0.0) {
      vec3 steps = floor(c * u_posterize.x + 0.5) / u_posterize.x;
      c = mix(c, steps, u_posterize.y);
    }

    // Primary strength blends the whole color pipeline against the pre-grade input.
    c = mix(source, c, u_primaryA.w);

    if (u_vignette.x != 0.0) {
      vec2 p = (v_uv - 0.5) * 2.0;
      p.x *= mix(1.0, aspect, u_vignette.z);
      float d = length(p) / mix(sqrt(2.0), length(vec2(aspect, 1.0)), u_vignette.z);
      float v = smoothstep(u_vignette.y, u_vignette.y + max(u_vignette.w, 0.01), d);
      c = u_vignette.x < 0.0 ? c * (1.0 + u_vignette.x * v) : mix(c, vec3(1.0), u_vignette.x * v);
    }

    if (u_grain.x > 0.0) {
      vec2 cell = floor(gl_FragCoord.xy / max(u_grain.y * pixelScale, 1.0));
      float seed = floor(u_time * 24.0);
      float mono = hash(cell + seed * 1.37) + hash(cell * 1.7 + seed) - 1.0;
      vec3 colored = vec3(hash(cell + seed + 11.0), hash(cell + seed + 23.0), hash(cell + seed + 37.0)) - 0.5;
      vec3 noise = mix(vec3(mono), colored * 1.4, u_grain.z);
      float l = dot(c, LUMA);
      c += noise * u_grain.x * 0.22 * (0.25 + 3.0 * l * (1.0 - l));
    }

    c = u_primaryD.z + clamp(c, 0.0, 1.0) * (u_primaryD.w - u_primaryD.z);
    c = mix(straight(original), c, clamp(u_mix, 0.0, 1.0));
    float outAlpha = mix(original.a, alpha, clamp(u_mix, 0.0, 1.0));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * outAlpha, outAlpha);
  }
`;
