// Name: Pen FX
// ID: penfx
// Description: Fast GPU post-processing effects for TurboWarp's pen layer.
// License: MIT
// Includes 2D adaptations inspired by AcerolaFX:
// https://github.com/GarrettGunnell/AcerolaFX/tree/main/Shaders

/* eslint-disable */
// This file is adapted from Movie's bundled Pen FX implementation.
// It is registered as an always-available built-in category instead of a user-loaded extension.

import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';
import Cast from 'scratch-vm/src/util/cast';

const createPenFXClass = vm => {
  const renderer = vm.runtime.renderer;
  const gl = renderer._gl || renderer.gl;

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const COPY_SHADER = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    void main() {
      gl_FragColor = texture2D(u_image, v_uv);
    }
  `;

  const COLOR_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform int u_mode;
    uniform float u_value;
    uniform float u_mix;
    uniform float u_pivot;
    uniform vec3 u_color;
    uniform vec3 u_add;
    uniform vec3 u_mul;
    uniform vec3 u_div;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    void main() {
      vec4 p = texture2D(u_image, v_uv);
      vec3 original = straightColor(p);
      vec3 c = original;
      if (u_mode == 0) {
        c = vec3(u_pivot) + (c - vec3(u_pivot)) * u_value;
      } else if (u_mode == 1) {
        c += u_color * u_value;
      } else if (u_mode == 2) {
        c = pow(max(c, vec3(0.0)), vec3(max(u_value, 0.00001)));
      } else if (u_mode == 3) {
        float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(luminance), c, u_value);
      } else {
        c = ((c / max(u_div, vec3(0.0039215686))) * u_mul) + u_add;
      }
      c = mix(original, c, clamp(u_mix, 0.0, 1.0));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0) * p.a, p.a);
    }
  `;

  const COLOR_OVERLAY_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec3 u_color;
    uniform float u_mix;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      vec3 overlaid = u_color;
      vec3 color = mix(straightColor(original), overlaid, clamp(u_mix, 0.0, 1.0));
      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
    }
  `;

  const GRADATION_OVERLAY_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform float u_direction;
    uniform float u_mix;
    uniform int u_stopCount;
    uniform vec3 u_color0;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    uniform vec3 u_color4;
    uniform vec3 u_color5;
    uniform vec3 u_color6;
    uniform vec3 u_color7;
    uniform float u_position0;
    uniform float u_position1;
    uniform float u_position2;
    uniform float u_position3;
    uniform float u_position4;
    uniform float u_position5;
    uniform float u_position6;
    uniform float u_position7;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    vec3 gradientColor(float position) {
      if (u_stopCount <= 1 || position <= u_position0) return u_color0;
      if (u_stopCount <= 2 || position <= u_position1) {
        return mix(u_color0, u_color1, smoothstep(u_position0, u_position1, position));
      }
      if (u_stopCount <= 3 || position <= u_position2) {
        return mix(u_color1, u_color2, smoothstep(u_position1, u_position2, position));
      }
      if (u_stopCount <= 4 || position <= u_position3) {
        return mix(u_color2, u_color3, smoothstep(u_position2, u_position3, position));
      }
      if (u_stopCount <= 5 || position <= u_position4) {
        return mix(u_color3, u_color4, smoothstep(u_position3, u_position4, position));
      }
      if (u_stopCount <= 6 || position <= u_position5) {
        return mix(u_color4, u_color5, smoothstep(u_position4, u_position5, position));
      }
      if (u_stopCount <= 7 || position <= u_position6) {
        return mix(u_color5, u_color6, smoothstep(u_position5, u_position6, position));
      }
      if (position <= u_position7) {
        return mix(u_color6, u_color7, smoothstep(u_position6, u_position7, position));
      }
      return u_color7;
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      vec2 direction = vec2(sin(radians(u_direction)), cos(radians(u_direction)));
      float position = clamp(dot(v_uv - vec2(0.5), direction) + 0.5, 0.0, 1.0);
      vec3 color = mix(straightColor(original), gradientColor(position), clamp(u_mix, 0.0, 1.0));
      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
    }
  `;

  const RGB_SHIFT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform float u_direction;
    uniform float u_value;
    uniform float u_mix;
    uniform int u_pair;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    void main() {
      float angle = radians(u_direction);
      vec2 delta = vec2(sin(angle), cos(angle)) * u_value / u_resolution;
      vec4 centerPixel = texture2D(u_image, v_uv);
      vec4 forwardPixel = texture2D(u_image, v_uv - delta);
      vec4 backwardPixel = texture2D(u_image, v_uv + delta);
      vec3 center = straightColor(centerPixel);
      vec3 forward = straightColor(forwardPixel);
      vec3 backward = straightColor(backwardPixel);
      vec3 c = center;
      if (u_pair == 0) {
        c.r = forward.r;
        c.g = backward.g;
      } else if (u_pair == 1) {
        c.g = forward.g;
        c.b = backward.b;
      } else {
        c.b = forward.b;
        c.r = backward.r;
      }
      float alpha = max(centerPixel.a, max(forwardPixel.a, backwardPixel.a));
      vec4 shiftedPixel = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
      gl_FragColor = mix(centerPixel, shiftedPixel, clamp(u_mix, 0.0, 1.0));
    }
  `;

  const SIGNAL_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform int u_mode;
    uniform float u_tracking;
    uniform float u_chroma;
    uniform float u_noise;
    uniform float u_scanlines;
    uniform float u_evolution;
    uniform float u_seed;
    uniform float u_slices;
    uniform float u_shift;
    uniform float u_rgb;
    uniform float u_density;
    uniform float u_mix;

    vec4 sampleImage(vec2 uv) {
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
        return vec4(0.0);
      }
      return texture2D(u_image, uv);
    }

    vec3 straightColor(vec4 pixel) {
      return pixel.a > 0.00001 ? pixel.rgb / pixel.a : vec3(0.0);
    }

    float hash(vec2 value) {
      value += vec2(u_seed * 0.127, u_seed * 0.311);
      return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      vec2 pixel = v_uv * u_resolution;
      vec2 uv = v_uv;
      float frame = mod(u_evolution, 100000.0);
      float alpha;
      vec3 color;

      if (u_mode == 0) {
        float line = floor(pixel.y * 0.25);
        float lineNoise = hash(vec2(line, frame * 0.071)) * 2.0 - 1.0;
        float wobble = sin(pixel.y * 0.045 + frame * 0.83) * 0.45;
        float trackingCenter = mix(0.12, 0.88, hash(vec2(floor(frame * 0.19), 41.0)));
        float trackingBand = exp(-pow((v_uv.y - trackingCenter) / 0.035, 2.0));
        float trackingNoise = hash(vec2(floor(pixel.y), floor(frame * 2.0))) * 2.0 - 1.0;
        float horizontalShift = (lineNoise * 0.28 + wobble + trackingNoise * trackingBand * 1.8) * u_tracking;
        uv.x += horizontalShift / max(u_resolution.x, 1.0);

        float chromaWave = 0.65 + 0.35 * sin(pixel.y * 0.021 + frame * 0.37);
        vec2 chromaOffset = vec2(u_chroma * chromaWave / max(u_resolution.x, 1.0), 0.0);
        vec4 redPixel = sampleImage(uv + chromaOffset);
        vec4 greenPixel = sampleImage(uv);
        vec4 bluePixel = sampleImage(uv - chromaOffset);
        alpha = max(redPixel.a, max(greenPixel.a, bluePixel.a));
        color = vec3(straightColor(redPixel).r, straightColor(greenPixel).g, straightColor(bluePixel).b);

        float tapeNoise = hash(floor(pixel * vec2(0.5, 1.0)) + vec2(frame * 13.7, frame * 5.3)) * 2.0 - 1.0;
        float streakNoise = hash(vec2(floor(pixel.y * 0.5), floor(frame * 3.0))) * 2.0 - 1.0;
        color += (tapeNoise * 0.72 + streakNoise * 0.28) * u_noise;
        float scanline = 0.5 + 0.5 * sin(pixel.y * 3.14159265359);
        color *= 1.0 - u_scanlines * (0.35 + 0.65 * scanline);
        color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), 0.08);
        color += vec3(trackingBand * u_noise * (0.25 + 0.75 * hash(vec2(pixel.x, frame))));
      } else {
        float slices = max(u_slices, 1.0);
        float slice = floor(v_uv.y * slices);
        float sliceRandom = hash(vec2(slice, floor(frame)));
        float activeMask = step(1.0 - u_density, sliceRandom);
        float blockWidth = max(8.0, u_resolution.x / 12.0);
        float block = floor(pixel.x / blockWidth);
        float blockRandom = hash(vec2(block + slice * 17.0, floor(frame * 1.7)));
        float blockGate = mix(0.45, 1.0, step(0.38, blockRandom));
        float sliceShift = (hash(vec2(slice * 3.1, frame * 0.53)) * 2.0 - 1.0) * u_shift * activeMask * blockGate;
        uv.x += sliceShift / max(u_resolution.x, 1.0);

        float splitPulse = activeMask * (0.45 + 0.55 * blockRandom);
        vec2 rgbOffset = vec2(u_rgb * splitPulse / max(u_resolution.x, 1.0), 0.0);
        vec4 redPixel = sampleImage(uv + rgbOffset);
        vec4 greenPixel = sampleImage(uv);
        vec4 bluePixel = sampleImage(uv - rgbOffset);
        alpha = max(redPixel.a, max(greenPixel.a, bluePixel.a));
        color = vec3(straightColor(redPixel).r, straightColor(greenPixel).g, straightColor(bluePixel).b);

        float dropoutRandom = hash(vec2(block * 7.3 + slice, floor(frame * 2.3)));
        float dropout = activeMask * step(0.91, dropoutRandom);
        vec3 dropoutColor = vec3(hash(vec2(slice, frame)), 0.08, hash(vec2(block, frame + 9.0))) * 0.35;
        color = mix(color, dropoutColor, dropout);
        float digitalNoise = hash(floor(pixel) + vec2(frame * 19.0, frame * 23.0)) - 0.5;
        color += digitalNoise * activeMask * u_density * 0.16;
      }

      vec4 effected = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
      gl_FragColor = mix(original, effected, clamp(u_mix, 0.0, 1.0));
    }
  `;

  const GAUSSIAN_SHADER = `
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

  const BLOOM_SHADER = `
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

  const WAVY_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform float u_value;
    uniform float u_seed;
    uniform vec2 u_offset;
    uniform vec2 u_center;
    uniform float u_size;
    uniform float u_complexity;
    uniform float u_evolution;
    uniform int u_type;
    uniform float u_mix;

    vec4 sampleImage(vec2 uv) {
      return texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
    }

    float hash(vec2 p) {
      p += vec2(u_seed * 0.127, u_seed * 0.311);
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float total = 0.0;
      for (int i = 0; i < 8; i++) {
        float active = step(float(i) + 0.5, clamp(u_complexity, 1.0, 8.0));
        value += amplitude * (noise(p) * 2.0 - 1.0) * active;
        total += amplitude * active;
        p = p * 2.03 + vec2(17.1, 9.2);
        amplitude *= 0.5;
      }
      return value / max(total, 0.0001);
    }

    void main() {
      float scale = max(abs(u_size), 0.0001);
      vec2 evolution = vec2(cos(radians(u_evolution)), sin(radians(u_evolution))) * 4.0;
      vec2 p = ((v_uv * u_resolution) + u_offset) / scale + evolution;
      float nx = fbm(p);
      float ny = fbm(p + vec2(31.7, 47.2));
      vec2 center = u_resolution * 0.5 + u_center;
      vec2 displaced = v_uv;
      if (u_type == 0) {
        displaced -= vec2(nx, ny) * u_value / u_resolution;
      } else if (u_type == 1) {
        displaced.x -= nx * u_value / max(u_resolution.x, 1.0);
      } else if (u_type == 2) {
        displaced.y -= ny * u_value / max(u_resolution.y, 1.0);
      } else if (u_type == 3) {
        float scaleAmount = max(0.01, 1.0 + nx * u_value / 100.0);
        displaced = (center + (v_uv * u_resolution - center) / scaleAmount) / u_resolution;
      } else {
        float angle = radians(nx * u_value);
        vec2 offset = v_uv * u_resolution - center;
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        displaced = (center + rotation * offset) / u_resolution;
      }
      vec4 displacedPixel = sampleImage(displaced);
      float mixValue = clamp(u_mix, 0.0, 1.0);
      gl_FragColor = mixValue == 1.0 ? displacedPixel : mix(texture2D(u_image, v_uv), displacedPixel, mixValue);
    }
  `;

  const FRACTAL_NOISE_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform int u_fractalType;
    uniform int u_noiseType;
    uniform int u_invert;
    uniform float u_contrast;
    uniform float u_brightness;
    uniform int u_overflow;
    uniform float u_rotation;
    uniform float u_scale;
    uniform vec2 u_scaleDimensions;
    uniform vec2 u_offset;
    uniform int u_perspective;
    uniform float u_depth;
    uniform float u_evolution;
    uniform int u_cycleEvolution;
    uniform float u_cycle;

    float hash(vec2 p) {
      p = fract(p * vec2(0.1031, 0.1030));
      p += dot(p, p.yx + 33.33);
      return fract((p.x + p.y) * p.x);
    }

    vec2 interpolation(vec2 f) {
      if (u_noiseType == 0) return vec2(0.0);
      if (u_noiseType == 1) return f;
      if (u_noiseType == 2) return f * f * (3.0 - 2.0 * f);
      return f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    }

    float valueNoise(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = interpolation(fract(p));
      float a = hash(cell);
      float b = hash(cell + vec2(1.0, 0.0));
      float c = hash(cell + vec2(0.0, 1.0));
      float d = hash(cell + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    vec2 rotate2D(vec2 p, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c) * p;
    }

    float fractal(vec2 p) {
      if (u_fractalType == 13) p *= 2.75;
      if (u_fractalType == 14) p *= 1.8;
      if (u_fractalType == 15) p = vec2(p.x * 0.22, p.y * 2.4);
      if (u_fractalType == 16) p = vec2(p.x * 0.1, p.y * 4.2);

      float sum = 0.0;
      float total = 0.0;
      float maximum = 0.0;
      float amplitude = u_fractalType == 11 ? 0.62 : 0.5;
      float previous = 0.0;
      for (int i = 0; i < 10; i++) {
        float octaveMask = step(float(i) + 0.5, clamp(u_depth, 1.0, 10.0));
        vec2 samplePoint = p;
        if (u_fractalType == 4) {
          samplePoint += vec2(previous, valueNoise(p + vec2(9.7, 3.1)) - 0.5) * 1.4;
        } else if (u_fractalType == 5) {
          samplePoint = rotate2D(p, previous * 0.9 + float(i) * 0.13);
        } else if (u_fractalType == 6) {
          float twist = (length(p) + previous * 2.0) * 0.32;
          samplePoint = rotate2D(p, twist);
        } else if (u_fractalType == 8) {
          samplePoint.x += previous * 3.2;
        } else if (u_fractalType == 9) {
          samplePoint = rotate2D(p, previous * 1.8);
        }

        float n = valueNoise(samplePoint) * 2.0 - 1.0;
        float contribution = n;
        if (u_fractalType == 1) {
          contribution = 1.0 - abs(n);
          contribution = contribution * contribution;
        } else if (u_fractalType == 2) {
          contribution = abs(n);
        } else if (u_fractalType == 3) {
          contribution = pow(abs(n), 0.32);
        } else if (u_fractalType == 7) {
          maximum = max(maximum, (n * 0.5 + 0.5) * (0.72 + amplitude) * octaveMask);
        } else if (u_fractalType == 10) {
          contribution = 1.0 - abs(n);
          contribution *= contribution;
          contribution = contribution * 2.0 - 1.0;
        } else if (u_fractalType == 12) {
          contribution = floor((n * 0.5 + 0.5) * 7.0) / 6.0 * 2.0 - 1.0;
        } else if (u_fractalType == 14) {
          contribution = 1.0 - abs(n);
          contribution = pow(contribution, 4.0) * 2.0 - 1.0;
        } else if (u_fractalType == 15) {
          contribution = pow(1.0 - abs(n), 3.0) * 2.0 - 1.0;
        } else if (u_fractalType == 16) {
          contribution = pow(1.0 - abs(n), 7.0) * 2.0 - 1.0;
        }

        sum += contribution * amplitude * octaveMask;
        total += amplitude * octaveMask;
        previous = n;
        float lacunarity = u_fractalType == 11 ? 1.78 : u_fractalType == 13 ? 2.65 : 2.03;
        p = rotate2D(p * lacunarity + vec2(17.13, 9.27), 0.17);
        amplitude *= u_fractalType == 11 ? 0.62 : 0.5;
      }

      if (u_fractalType == 7) return maximum;
      float result = sum / max(total, 0.0001) * 0.5 + 0.5;
      if (u_fractalType == 8) result = mix(result, smoothstep(0.18, 0.82, result), 0.7);
      if (u_fractalType == 9) result = smoothstep(0.08, 0.92, result);
      if (u_fractalType == 11) result = smoothstep(0.12, 0.88, result);
      if (u_fractalType == 12) result += (valueNoise(p * 3.7) - 0.5) * 0.16;
      return result;
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      if (original.a <= 0.00001) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec2 centered = v_uv * u_resolution - u_resolution * 0.5;
      if (u_perspective == 1) {
        float perspective = max(0.3, 1.0 + centered.y / max(u_resolution.y, 1.0) * 0.85);
        centered.x /= perspective;
        centered.y /= perspective;
      }
      centered = rotate2D(centered, radians(u_rotation));
      centered += u_offset;
      vec2 dimensions = max(abs(u_scaleDimensions), vec2(0.01)) * 0.01;
      vec2 scale = max(abs(u_scale) * dimensions, vec2(0.01));
      vec2 p = centered / scale;

      float evolution = u_evolution / 360.0;
      if (u_cycleEvolution == 1) {
        float cycle = max(abs(u_cycle), 0.0001);
        float phase = fract(evolution / cycle) * 6.28318530718;
        p += vec2(cos(phase), sin(phase)) * 4.0;
      } else {
        p += vec2(evolution * 0.73, evolution * 0.41);
      }

      float value = fractal(p);
      if (u_invert == 1) value = 1.0 - value;
      value = (value - 0.5) * (u_contrast * 0.01) + 0.5 + u_brightness * 0.01;
      if (u_overflow == 1) {
        value = clamp(value, 0.0, 1.0);
      } else if (u_overflow == 2) {
        float centeredValue = value - 0.5;
        value = 0.5 + centeredValue / (1.0 + 2.0 * abs(centeredValue));
      }
      gl_FragColor = vec4(vec3(value) * original.a, original.a);
    }
  `;

  const LENS_BLUR_SHADER = `
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

  const DEPTH_OF_FIELD_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    uniform vec2 u_resolution;
    uniform float u_cameraNear;
    uniform float u_cameraFar;
    uniform float u_flatDepth;
    uniform float u_focusDistance;
    uniform float u_focusRange;
    uniform float u_aperture;
    uniform float u_maxBlur;
    uniform float u_nearStrength;
    uniform float u_farStrength;
    uniform float u_edgeSoftness;
    uniform float u_blades;
    uniform float u_rotation;
    uniform float u_mix;

    float unpackDepth(vec3 encodedDepth) {
      if (all(greaterThan(encodedDepth, vec3(0.999)))) return 1.0;
      return dot(encodedDepth, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    }

    float viewDepth(vec2 uv) {
      if (u_flatDepth > 0.0) return u_flatDepth;
      float depth = unpackDepth(texture2D(u_depth, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
      float z = depth * 2.0 - 1.0;
      return (2.0 * u_cameraNear * u_cameraFar) /
        max(u_cameraFar + u_cameraNear - z * (u_cameraFar - u_cameraNear), 0.00001);
    }

    float blurRadius(float depth) {
      float difference = depth - u_focusDistance;
      float defocus = max(abs(difference) - u_focusRange, 0.0);
      float sideStrength = difference < 0.0 ? u_nearStrength : u_farStrength;
      return min(u_maxBlur, u_aperture * defocus / max(depth, 0.0001) * sideStrength);
    }

    float polygonScale(float angle) {
      if (u_blades < 3.0) return 1.0;
      float sector = 6.28318530718 / u_blades;
      float localAngle = mod(angle + sector * 0.5, sector) - sector * 0.5;
      return cos(3.14159265359 / u_blades) / max(cos(localAngle), 0.001);
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      if (u_maxBlur <= 0.001 || u_aperture <= 0.001) {
        gl_FragColor = original;
        return;
      }

      float centerDepth = viewDepth(v_uv);
      float centerRadius = blurRadius(centerDepth);
      vec4 total = original * 1.5;
      float totalWeight = 1.5;
      for (int i = 0; i < 20; i++) {
        float fi = float(i) + 0.5;
        float angle = fi * 2.39996322973 + radians(u_rotation);
        float normalizedRadius = sqrt(fi / 20.0);
        float sampleDistance = normalizedRadius * u_maxBlur * polygonScale(angle - radians(u_rotation));
        vec2 offset = vec2(cos(angle), sin(angle)) * sampleDistance;
        vec2 sampleUV = v_uv + offset / u_resolution;
        vec4 samplePixel = texture2D(u_image, clamp(sampleUV, vec2(0.0), vec2(1.0)));
        float sampleDepth = viewDepth(sampleUV);
        float sampleRadius = blurRadius(sampleDepth);

        // A sample contributes if its own bokeh circle reaches this pixel. Pulling samples using the center
        // radius is allowed only on the same depth layer; this prevents background colors leaking over a sharp
        // foreground silhouette while retaining natural foreground bokeh over the background.
        float sampleCoverage = 1.0 - smoothstep(sampleRadius, sampleRadius + 1.0, sampleDistance);
        float centerCoverage = 1.0 - smoothstep(centerRadius, centerRadius + 1.0, sampleDistance);
        float depthDifference = abs(sampleDepth - centerDepth);
        float edge = max(u_edgeSoftness, 0.0001);
        float sameLayer = 1.0 - smoothstep(edge, edge * 2.0, depthDifference);
        float coverage = max(sampleCoverage, centerCoverage * sameLayer);
        float behindForeground = step(centerDepth + edge, sampleDepth);
        coverage *= 1.0 - behindForeground * (1.0 - sameLayer);
        float weight = coverage * (1.0 + normalizedRadius * 0.25);
        total += samplePixel * weight;
        totalWeight += weight;
      }
      vec4 blurred = total / max(totalWeight, 0.0001);
      gl_FragColor = mix(original, blurred, clamp(u_mix, 0.0, 1.0));
    }
  `;

  const FOG_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    uniform float u_cameraNear;
    uniform float u_cameraFar;
    uniform float u_flatDepth;
    uniform int u_mode;
    uniform float u_start;
    uniform float u_end;
    uniform float u_density;
    uniform float u_curve;
    uniform vec3 u_nearColor;
    uniform vec3 u_farColor;
    uniform float u_mix;

    float unpackDepth(vec3 encodedDepth) {
      if (all(greaterThan(encodedDepth, vec3(0.999)))) return 1.0;
      return dot(encodedDepth, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    }

    float viewDepth(vec2 uv) {
      if (u_flatDepth > 0.0) return u_flatDepth;
      float depth = unpackDepth(texture2D(u_depth, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
      float z = depth * 2.0 - 1.0;
      return (2.0 * u_cameraNear * u_cameraFar) /
        max(u_cameraFar + u_cameraNear - z * (u_cameraFar - u_cameraNear), 0.00001);
    }

    void main() {
      vec4 original = texture2D(u_image, v_uv);
      if (original.a <= 0.00001 || u_density <= 0.0 || u_mix <= 0.0) {
        gl_FragColor = original;
        return;
      }

      float depth = viewDepth(v_uv);
      float span = u_end - u_start;
      float distanceFactor = abs(span) < 0.0001 ? step(u_start, depth) :
        clamp((depth - u_start) / span, 0.0, 1.0);
      float fogFactor = distanceFactor;
      if (u_mode == 1) {
        fogFactor = distanceFactor * distanceFactor * (3.0 - 2.0 * distanceFactor);
      } else if (u_mode == 2) {
        fogFactor = (1.0 - exp(-4.0 * distanceFactor)) / (1.0 - exp(-4.0));
      } else if (u_mode == 3) {
        fogFactor = (1.0 - exp(-4.0 * distanceFactor * distanceFactor)) / (1.0 - exp(-4.0));
      }
      fogFactor = pow(clamp(fogFactor, 0.0, 1.0), max(u_curve, 0.01));
      fogFactor *= clamp(u_density, 0.0, 1.0) * clamp(u_mix, 0.0, 1.0);

      vec3 originalColor = original.rgb / original.a;
      vec3 fogColor = mix(u_nearColor, u_farColor, distanceFactor);
      vec3 color = mix(originalColor, fogColor, clamp(fogFactor, 0.0, 1.0));
      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
    }
  `;

  const LENS_DISTORTION_SHADER = `
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

  const PIXEL_STRETCH_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform int u_type;
    uniform float u_position;
    uniform float u_size;
    uniform float u_sampleSize;
    uniform vec2 u_center;
    uniform float u_mix;

    const float pi = 3.14159265358979323846;

    float wrappedAngle(float angle) {
      return mod(angle + pi, pi * 2.0) - pi;
    }

    vec4 samplePixel(vec2 pixel) {
      if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, u_resolution))) {
        return vec4(0.0);
      }
      return texture2D(u_image, (floor(pixel) + vec2(0.5)) / u_resolution);
    }

    vec4 samplePosition(vec2 pixel) {
      if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, u_resolution))) {
        return vec4(0.0);
      }
      return texture2D(u_image, pixel / u_resolution);
    }

    void main() {
      vec2 pixel = v_uv * u_resolution;
      vec2 center = u_resolution * 0.5 + u_center;
      vec2 fromCenter = pixel - center;
      float halfSize = abs(u_size) * 0.5;
      bool active = false;
      vec2 sampleBase = pixel;
      vec2 sampleDirection = vec2(0.0);
      float sampleStep = 1.0;

      if (u_type < 2) {
        float axisPosition = u_type == 0 ? pixel.x : pixel.y;
        float axisCenter = u_type == 0 ? center.x : center.y;
        float axisLimit = u_type == 0 ? u_resolution.x : u_resolution.y;
        float sourcePosition = clamp(axisCenter + u_position, 0.5, axisLimit - 0.5);
        float distanceFromSource = axisPosition - sourcePosition;
        active = abs(distanceFromSource) <= halfSize;
        if (u_type == 0) {
          sampleBase.x = active ? sourcePosition : axisPosition - sign(distanceFromSource) * halfSize;
          sampleDirection = vec2(1.0, 0.0);
        } else {
          sampleBase.y = active ? sourcePosition : axisPosition - sign(distanceFromSource) * halfSize;
          sampleDirection = vec2(0.0, 1.0);
        }
      } else if (u_type == 2) {
        float radius = length(fromCenter);
        float sourceRadius = max(0.0, abs(u_position));
        vec2 radial = radius > 0.0001 ? fromCenter / radius : vec2(1.0, 0.0);
        float distanceFromSource = radius - sourceRadius;
        active = abs(distanceFromSource) <= halfSize || sourceRadius < halfSize && radius <= sourceRadius + halfSize;
        float sampleRadius = active ? sourceRadius : max(0.0, radius - sign(distanceFromSource) * halfSize);
        sampleBase = center + radial * sampleRadius;
        sampleDirection = radial;
      } else {
        float sourceAngle = radians(u_position);
        float angle = atan(fromCenter.y, fromCenter.x);
        float angularDistance = wrappedAngle(angle - sourceAngle);
        float halfAngle = radians(halfSize);
        active = abs(angularDistance) <= halfAngle;
        float radius = length(fromCenter);
        float sampleAngle = active ? sourceAngle : angle - sign(angularDistance) * halfAngle;
        sampleBase = center + vec2(cos(sampleAngle), sin(sampleAngle)) * radius;
        sampleStep = max(radius * pi / 180.0, 0.25);
        sampleDirection = vec2(-sin(sourceAngle), cos(sourceAngle));
      }

      vec4 transformed;
      if (active) {
        transformed = vec4(0.0);
        float samples = 0.0;
        for (int i = -4; i <= 4; i++) {
          float sampleActive = step(abs(float(i)), min(abs(u_sampleSize) * 0.5, 4.0));
          transformed += samplePixel(sampleBase + sampleDirection * float(i) * sampleStep) * sampleActive;
          samples += sampleActive;
        }
        transformed /= max(samples, 1.0);
      } else {
        transformed = samplePosition(sampleBase);
      }
      float mixValue = clamp(u_mix, 0.0, 1.0);
      gl_FragColor = mixValue == 1.0 ? transformed : mix(texture2D(u_image, v_uv), transformed, mixValue);
    }
  `;

  const SHARPEN_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform float u_value;
    uniform float u_radius;
    uniform float u_mix;

    void main() {
      vec2 pixel = max(u_radius, 1.0) / u_resolution;
      vec4 center = texture2D(u_image, v_uv);
      vec4 left = texture2D(u_image, v_uv + pixel * vec2(-1.0, 0.0));
      vec4 right = texture2D(u_image, v_uv + pixel * vec2(1.0, 0.0));
      vec4 up = texture2D(u_image, v_uv + pixel * vec2(0.0, 1.0));
      vec4 down = texture2D(u_image, v_uv + pixel * vec2(0.0, -1.0));
      vec4 sharpened = center + max(u_value, 0.0) * (4.0 * center - left - right - up - down);
      float alpha = clamp(sharpened.a, 0.0, 1.0);
      vec4 result = vec4(clamp(sharpened.rgb, vec3(0.0), vec3(alpha)), alpha);
      gl_FragColor = mix(center, result, clamp(u_mix, 0.0, 1.0));
    }
  `;

  const DEEP_GLOW_SHADER = `
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

  const GEOMETRY_SHADER = `
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

  const DISPLACEMENT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform sampler2D u_map;
    uniform vec2 u_resolution;
    uniform float u_value;
    uniform int u_type;
    uniform int u_channel;
    uniform int u_invert;
    uniform float u_center;
    uniform float u_mix;

    vec4 sampleImage(vec2 uv) {
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
        return vec4(0.0);
      }
      return texture2D(u_image, uv);
    }

    void main() {
      // Scratch costume textures use the renderer's mirrored X texture space,
      // while the pen framebuffer uses screen-aligned UVs.
      vec4 mapPixel = texture2D(u_map, vec2(1.0 - v_uv.x, v_uv.y));
      vec3 straightMap = mapPixel.a > 0.00001 ? mapPixel.rgb / mapPixel.a : vec3(0.5);
      vec3 mapColor = mix(vec3(0.5), straightMap, mapPixel.a);
      float mapValue = dot(mapColor, vec3(0.2126, 0.7152, 0.0722));
      if (u_channel == 1) mapValue = mapColor.r;
      else if (u_channel == 2) mapValue = mapColor.g;
      else if (u_channel == 3) mapValue = mapColor.b;
      else if (u_channel == 4) mapValue = mapPixel.a;
      if (u_invert == 1) mapValue = 1.0 - mapValue;
      float amount = (mapValue - u_center) * 2.0 * u_value;
      vec2 displacedUv = v_uv;
      if (u_type == 0) {
        displacedUv.x -= amount / max(u_resolution.x, 1.0);
      } else if (u_type == 1) {
        displacedUv.y -= amount / max(u_resolution.y, 1.0);
      } else if (u_type == 2) {
        float scale = max(0.01, 1.0 + amount / 100.0);
        displacedUv = vec2(0.5) + (v_uv - vec2(0.5)) / scale;
      } else {
        float angle = radians(amount);
        vec2 offset = v_uv - vec2(0.5);
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        displacedUv = vec2(0.5) + rotation * offset;
      }
      vec4 displaced = sampleImage(displacedUv);
      float mixValue = clamp(u_mix, 0.0, 1.0);
      gl_FragColor = mixValue == 1.0 ? displaced : mix(texture2D(u_image, v_uv), displaced, mixValue);
    }
  `;

  // AcerolaFX is written for ReShade/HLSL. These shaders keep the color-buffer
  // effects and their characteristic controls while remaining WebGL 1 friendly.
  // All colors entering/leaving these passes are premultiplied for Scratch.
  const ACEROLA_COLOR_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform int u_mode;
    uniform int u_type;
    uniform int u_type2;
    uniform float u_value;
    uniform float u_value2;
    uniform float u_value3;
    uniform float u_mix;
    uniform float u_time;
    uniform vec2 u_vec;
    uniform vec2 u_vec2;
    uniform vec3 u_color;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    uniform vec3 u_color4;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    float luminance(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + u_time * 17.17) * 43758.5453123);
    }

    vec3 hueToRgb(float h) {
      return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    }

    vec3 rgbToHsl(vec3 c) {
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float d = mx - mn;
      float h = 0.0;
      if (d > 0.00001) {
        if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
        else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
        else h = (c.r - c.g) / d + 4.0;
        h /= 6.0;
        if (h < 0.0) h += 1.0;
      }
      float l = (mx + mn) * 0.5;
      float s = d / max(1.0 - abs(2.0 * l - 1.0), 0.00001);
      return vec3(h, s, l);
    }

    vec3 hslToRgb(vec3 hsl) {
      float chroma = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
      return (hueToRgb(hsl.x) - 0.5) * chroma + hsl.z;
    }

    float bayer4(vec2 pixel) {
      vec2 p = mod(floor(pixel), 4.0);
      float x = p.x;
      float y = p.y;
      float row0 = x < 1.0 ? 0.0 : x < 2.0 ? 8.0 : x < 3.0 ? 2.0 : 10.0;
      float row1 = x < 1.0 ? 12.0 : x < 2.0 ? 4.0 : x < 3.0 ? 14.0 : 6.0;
      float row2 = x < 1.0 ? 3.0 : x < 2.0 ? 11.0 : x < 3.0 ? 1.0 : 9.0;
      float row3 = x < 1.0 ? 15.0 : x < 2.0 ? 7.0 : x < 3.0 ? 13.0 : 5.0;
      return ((y < 1.0 ? row0 : y < 2.0 ? row1 : y < 3.0 ? row2 : row3) / 16.0) - 0.5;
    }

    vec3 toneMap(vec3 c, int kind, float whitePoint) {
      if (kind == 0) return clamp(c, 0.0, 1.0);
      if (kind == 1) {
        vec3 a = c * (c + 0.0245786) - 0.000090537;
        vec3 b = c * (0.983729 * c + 0.432951) + 0.238081;
        return clamp(a / b, 0.0, 1.0);
      }
      if (kind == 2) return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
      float l = max(luminance(c), 0.00001);
      float mapped = (l * (1.0 + l / max(whitePoint * whitePoint, 0.00001))) / (1.0 + l);
      return clamp(c * mapped / l, 0.0, 1.0);
    }

    float asciiGlyph(vec2 cell, float level) {
      vec2 p = abs(cell - 0.5);
      float dotShape = 1.0 - step(0.16, length(p));
      float dashShape = (1.0 - step(0.38, p.x)) * (1.0 - step(0.09, p.y));
      float crossShape = max((1.0 - step(0.08, p.x)) * (1.0 - step(0.4, p.y)),
                             (1.0 - step(0.4, p.x)) * (1.0 - step(0.08, p.y)));
      float ringShape = (1.0 - step(0.42, length(p))) * step(0.25, length(p));
      if (level < 0.2) return 0.0;
      if (level < 0.4) return dotShape;
      if (level < 0.6) return dashShape;
      if (level < 0.8) return crossShape;
      return max(ringShape, crossShape);
    }

    void main() {
      vec4 p = texture2D(u_image, v_uv);
      vec3 original = straightColor(p);
      vec3 c = original;
      float alpha = p.a;

      if (u_mode == 0) {
        alpha = p.a * clamp(u_value, 0.0, 1.0);
      } else if (u_mode == 1) {
        float keyed = 1.0 - smoothstep(u_value, u_value + max(u_value2, 0.0001), distance(original, u_color));
        vec3 replacement = u_type == 1 ? mix(u_color2, u_color3, v_uv.x) : u_color2;
        if (u_type == 2) alpha *= 1.0 - keyed;
        else c = mix(original, replacement, keyed);
      } else if (u_mode == 2) {
        mat3 m;
        if (u_type == 0) m = mat3(0.625, 0.700, 0.000, 0.375, 0.300, 0.300, 0.000, 0.000, 0.700);
        else if (u_type == 1) m = mat3(0.567, 0.558, 0.000, 0.433, 0.442, 0.242, 0.000, 0.000, 0.758);
        else m = mat3(0.950, 0.000, 0.000, 0.050, 0.433, 0.475, 0.000, 0.567, 0.525);
        c = mix(original, clamp(m * original, 0.0, 1.0), clamp(u_value, 0.0, 1.0));
      } else if (u_mode == 3) {
        c *= exp2(u_value);
        c *= vec3(1.0 + u_value2 * 0.1, 1.0 - abs(u_value2) * 0.025 + u_value3 * 0.05, 1.0 - u_value2 * 0.1);
        c = (c - vec3(u_vec.x)) * u_vec.y + vec3(u_vec.x);
        c *= u_color;
        c = mix(vec3(luminance(c)), c, u_color2.x + 1.0);
      } else if (u_mode == 4) {
        float noise = bayer4((v_uv * u_resolution) / max(u_value3, 1.0));
        vec3 counts = max(vec3(u_vec, u_value), vec3(2.0));
        c = clamp(original + noise * u_value2, 0.0, 1.0);
        c = floor((counts - 1.0) * c + 0.5) / (counts - 1.0);
      } else if (u_mode == 5) {
        float noise = hash(floor(v_uv * u_resolution / max(u_value3, 1.0))) * 2.0 - 1.0;
        float weight = mix(1.0, 1.0 - sqrt(clamp(luminance(original), 0.0, 1.0)), clamp(u_value2, 0.0, 1.0));
        c = original + original * noise * u_value * weight;
      } else if (u_mode == 6) {
        c = toneMap(max(original * exp2(u_value), vec3(0.0)), u_type, max(u_value2, 0.01));
      } else if (u_mode == 7) {
        vec2 pos = (v_uv - vec2(0.5) - u_vec2) * u_vec;
        vec2 d = pow(clamp(abs(pos) * u_value, 0.0, 1.0), vec2(max(u_value2, 0.01)));
        float factor = pow(clamp(1.0 - dot(d, d), 0.0, 1.0), max(u_value3, 0.01));
        c = mix(u_color, original, factor);
      } else if (u_mode == 8) {
        vec2 divisions = vec2(max(float(u_type), 1.0));
        vec2 cell = fract(v_uv * divisions);
        vec2 grid = min(cell, 1.0 - cell);
        float line = 1.0 - step(max(u_value / u_resolution.x, 0.0001), min(grid.x, grid.y));
        c = mix(original, u_color, line * clamp(u_value2, 0.0, 1.0));
      } else if (u_mode == 9) {
        float k = min(1.0 - original.r, min(1.0 - original.g, 1.0 - original.b));
        vec3 cmy = (vec3(1.0) - original - k) / max(1.0 - k, 0.0001);
        vec2 px = v_uv * u_resolution / max(u_value, 1.0);
        float cyan = step(sin(px.x * 0.75 + px.y * 0.2) * 0.5 + 0.5, cmy.r);
        float magenta = step(sin(px.x * -0.2 + px.y * 0.75) * 0.5 + 0.5, cmy.g);
        float yellow = step(sin(px.x * 0.72 + px.y * 0.72) * 0.5 + 0.5, cmy.b);
        float blackInk = step(sin(px.x * 0.72 - px.y * 0.72) * 0.5 + 0.5, k);
        c = clamp(vec3(1.0 - cyan, 1.0 - magenta, 1.0 - yellow) - blackInk, 0.0, 1.0);
      } else if (u_mode == 10) {
        vec2 q = v_uv * 2.0 - 1.0;
        vec2 warp = q + q * (q.yx / max(u_value, 1.0)) * (q.yx / max(u_value, 1.0));
        vec2 uv = warp * 0.5 + 0.5;
        vec4 warped = texture2D(u_image, uv);
        c = straightColor(warped);
        alpha = warped.a;
        vec2 border = smoothstep(vec2(0.0), vec2(max(u_value2, 0.001)), 1.0 - abs(warp));
        float scan = sin(v_uv.y * u_resolution.y * 3.14159265 / max(u_value3, 1.0));
        c *= border.x * border.y * (1.0 - u_vec.x + u_vec.x * (0.75 + 0.25 * scan));
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) alpha = 0.0;
      } else if (u_mode == 11) {
        float l = clamp(luminance(original), 0.0, 1.0);
        if (l < 0.333333) c = mix(u_color, u_color2, l * 3.0);
        else if (l < 0.666667) c = mix(u_color2, u_color3, (l - 0.333333) * 3.0);
        else c = mix(u_color3, u_color4, (l - 0.666667) * 3.0);
      } else if (u_mode == 12) {
        vec3 hsl = rgbToHsl(original);
        hsl.x = fract((hsl.x + u_value) * u_value2);
        hsl.y = clamp((hsl.y + u_vec.x) * u_vec.y, 0.0, 1.0);
        hsl.z = clamp((hsl.z + u_vec2.x) * u_vec2.y, 0.0, 1.0);
        c = hslToRgb(hsl);
      } else if (u_mode == 13) {
        vec2 cellSize = max(u_vec, vec2(2.0));
        vec2 cell = fract(v_uv * u_resolution / cellSize);
        vec2 centerUv = (floor(v_uv * u_resolution / cellSize) + 0.5) * cellSize / u_resolution;
        vec3 sampleColor = straightColor(texture2D(u_image, centerUv));
        float level = luminance(sampleColor);
        if (u_type == 1) level = 1.0 - level;
        float glyph = asciiGlyph(cell, level);
        c = mix(u_color2, u_color * sampleColor, glyph);
      } else if (u_mode == 14) {
        vec2 pos = abs((v_uv - vec2(0.5) - u_vec2) * vec2(u_resolution.x / u_resolution.y, 1.0));
        float shape = u_type == 0 ? max(pos.x, pos.y) : length(pos);
        float frame = smoothstep(u_value, u_value + max(u_value2, 0.0001), shape);
        c = mix(original, u_color, frame * clamp(u_value3, 0.0, 1.0));
      } else {
        vec3 avg = vec3(0.0);
        avg += straightColor(texture2D(u_image, vec2(0.167, 0.167)));
        avg += straightColor(texture2D(u_image, vec2(0.500, 0.167)));
        avg += straightColor(texture2D(u_image, vec2(0.833, 0.167)));
        avg += straightColor(texture2D(u_image, vec2(0.167, 0.500)));
        avg += straightColor(texture2D(u_image, vec2(0.500, 0.500)));
        avg += straightColor(texture2D(u_image, vec2(0.833, 0.500)));
        avg += straightColor(texture2D(u_image, vec2(0.167, 0.833)));
        avg += straightColor(texture2D(u_image, vec2(0.500, 0.833)));
        avg += straightColor(texture2D(u_image, vec2(0.833, 0.833)));
        float averageLuminance = max(luminance(avg / 9.0), 0.001);
        float exposure = clamp(u_value / averageLuminance, u_value2, u_value3);
        c = original * exposure;
      }

      c = mix(original, clamp(c, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));
      alpha = mix(p.a, alpha, clamp(u_mix, 0.0, 1.0));
      gl_FragColor = vec4(c * alpha, alpha);
    }
  `;

  const ACEROLA_SPATIAL_SHADER = `
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

  const COMPOSITE_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_base;
    uniform sampler2D u_effect;
    uniform int u_blend;
    uniform float u_opacity;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    void main() {
      vec4 basePixel = texture2D(u_base, v_uv);
      vec4 effectPixel = texture2D(u_effect, v_uv);
      if (u_blend == 0) {
        gl_FragColor = mix(basePixel, effectPixel, clamp(u_opacity, 0.0, 1.0));
        return;
      }
      vec3 b = straightColor(basePixel);
      vec3 e = straightColor(effectPixel);
      vec3 c;
      if (u_blend == 1) {
        c = b + e;
      } else if (u_blend == 2) {
        c = b * e;
      } else if (u_blend == 3) {
        c = vec3(1.0) - (vec3(1.0) - b) * (vec3(1.0) - e);
      } else if (u_blend == 4) {
        c = mix(2.0 * b * e, vec3(1.0) - 2.0 * (vec3(1.0) - b) * (vec3(1.0) - e), step(vec3(0.5), b));
      } else if (u_blend == 5) {
        c = min(b, e);
      } else if (u_blend == 6) {
        c = max(b, e);
      } else {
        c = min(vec3(1.0), b / max(vec3(1.0) - e, vec3(0.0039215686)));
      }
      c = mix(b, c, clamp(u_opacity, 0.0, 1.0));
      float alpha = mix(basePixel.a, max(basePixel.a, effectPixel.a), clamp(u_opacity, 0.0, 1.0));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
    }
  `;

  const GROUP_OVER_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_base;
    uniform sampler2D u_effect;

    void main() {
      vec4 basePixel = texture2D(u_base, v_uv);
      vec4 effectPixel = texture2D(u_effect, v_uv);
      float inverseAlpha = 1.0 - effectPixel.a;
      gl_FragColor = vec4(
        effectPixel.rgb + basePixel.rgb * inverseAlpha,
        effectPixel.a + basePixel.a * inverseAlpha
      );
    }
  `;

  const STACK_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_accum;
    uniform sampler2D u_sample;
    uniform int u_mode;
    uniform int u_first;
    uniform float u_accumWeight;
    uniform float u_sampleWeight;

    vec3 straightColor(vec4 p) {
      return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
    }

    void main() {
      vec4 samplePixel = texture2D(u_sample, v_uv);
      if (u_first == 1) {
        gl_FragColor = u_mode == 1 ? samplePixel * u_sampleWeight : samplePixel;
        return;
      }
      vec4 accumPixel = texture2D(u_accum, v_uv);
      if (u_mode == 0) {
        float totalWeight = max(u_accumWeight + u_sampleWeight, 0.00001);
        gl_FragColor = (accumPixel * u_accumWeight + samplePixel * u_sampleWeight) / totalWeight;
      } else if (u_mode == 1) {
        gl_FragColor = accumPixel + samplePixel * u_sampleWeight;
      } else {
        float accumLuminance = dot(straightColor(accumPixel), vec3(0.2126, 0.7152, 0.0722));
        float sampleLuminance = dot(straightColor(samplePixel), vec3(0.2126, 0.7152, 0.0722));
        bool useSample = u_mode == 2 ? sampleLuminance > accumLuminance : sampleLuminance < accumLuminance;
        gl_FragColor = useSample ? samplePixel : accumPixel;
      }
    }
  `;

  const BLEND_MODES = ['normal', 'add', 'mul', 'screen', 'overlay', 'darken', 'lighten', 'color dodge'];
  const FRACTAL_TYPES = [
    '基本', 'タービュレント(滑らか)', 'タービュレント(基本)', 'タービュレント(シャープ)',
    'ダイナミック', 'ダイナミック（プログレッシブ）', 'ダイナミック（ツイスト）', '最大', 'にじみ',
    '渦巻き', '岩肌', '曇り雲', '土', 'サブスケール', '小さなバンプ', 'ストリング', 'スレッド'
  ];
  const FRACTAL_NOISE_TYPES = ['ブロック', 'リニア', 'ソフトリニア', 'スプライン'];
  const FRACTAL_OVERFLOW_TYPES = ['HDR', 'Clip', 'Soft clamp'];

  class PenFXEngine {
    constructor() {
      this.programSources = {
        copy: COPY_SHADER,
        color: COLOR_SHADER,
        colorOverlay: COLOR_OVERLAY_SHADER,
        gradationOverlay: GRADATION_OVERLAY_SHADER,
        rgbShift: RGB_SHIFT_SHADER,
        signal: SIGNAL_SHADER,
        gaussian: GAUSSIAN_SHADER,
        bloom: BLOOM_SHADER,
        wavy: WAVY_SHADER,
        fractalNoise: FRACTAL_NOISE_SHADER,
        lensBlur: LENS_BLUR_SHADER,
        depthOfField: DEPTH_OF_FIELD_SHADER,
        fog: FOG_SHADER,
        lensDistortion: LENS_DISTORTION_SHADER,
        pixelStretch: PIXEL_STRETCH_SHADER,
        sharpen: SHARPEN_SHADER,
        deepGlow: DEEP_GLOW_SHADER,
        geometry: GEOMETRY_SHADER,
        displacement: DISPLACEMENT_SHADER,
        acerolaColor: ACEROLA_COLOR_SHADER,
        acerolaSpatial: ACEROLA_SPATIAL_SHADER,
        composite: COMPOSITE_SHADER,
        groupOver: GROUP_OVER_SHADER,
        stack: STACK_SHADER
      };
      this.programs = Object.create(null);
      this.vertexShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, 1, 1
      ]), gl.STATIC_DRAW);
      this.width = 0;
      this.height = 0;
      this.resolution = new Float32Array(2);
      this.textures = [];
      this.framebuffers = [];
      this.bufferStack = [];
      this.groupStack = [];
      this.frameTransaction = null;
      this.blendOpacity = 1;
      this.uniformCache = new WeakMap();
      this.positionCache = new WeakMap();
      this.pixelSortSource = null;
      this.pixelSortOutput = null;
      this.pixelSortKeys = null;
      this.pixelSortSelected = null;
      this.pixelSortIndices = [];
      this.pixelSortLine = [];
      this.depthTexture = null;
      this.depthSource = null;
      this.depthVersion = -1;
    }

    _compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Unknown GLSL compile error';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    _createProgram(fragmentSource) {
      const fragment = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();
      try {
        gl.attachShader(program, this.vertexShader);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
      } finally {
        gl.deleteShader(fragment);
      }
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || 'Unknown GLSL link error';
        gl.deleteProgram(program);
        throw new Error(message);
      }
      return program;
    }

    _program(name) {
      let program = this.programs[name];
      if (!program) {
        program = this._createProgram(this.programSources[name]);
        this.programs[name] = program;
      }
      return program;
    }

    _penSkin() {
      const id = renderer._penSkinId;
      return id === null || id === undefined ? null : renderer._allSkins[id];
    }

    _location(program, name) {
      let locations = this.uniformCache.get(program);
      if (!locations) {
        locations = new Map();
        this.uniformCache.set(program, locations);
      }
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name);
    }

    _position(program) {
      let position = this.positionCache.get(program);
      if (position === undefined) {
        position = gl.getAttribLocation(program, 'a_position');
        this.positionCache.set(program, position);
      }
      return position;
    }

    _resize(width, height) {
      if (this.width === width && this.height === height) return;
      this.clearBufferStack();
      this.clearGroupStack();
      for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
      for (const texture of this.textures) gl.deleteTexture(texture);
      this.width = width;
      this.height = height;
      this.resolution[0] = width;
      this.resolution[1] = height;
      this.textures = [];
      this.framebuffers = [];
      this.pixelSortSource = null;
      this.pixelSortOutput = null;
      this.pixelSortKeys = null;
      this.pixelSortSelected = null;
      const primary = this._createBufferTexture();
      this.textures.push(primary.texture);
      this.framebuffers.push(primary.framebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _ensureSecondaryBuffer() {
      if (this.textures.length > 1) return;
      const secondary = this._createBufferTexture();
      this.textures.push(secondary.texture);
      this.framebuffers.push(secondary.framebuffer);
    }

    _prepare(copySource = true, honorBlendOpacity = true) {
      if (honorBlendOpacity && this.blendOpacity <= 0) return null;
      const skin = this._penSkin();
      if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return null;
      if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
      this._resize(skin._size[0], skin._size[1]);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      if (copySource) {
        this._render(this._program('copy'), this.framebuffers[0], [{name: 'u_image', texture: skin._texture}], {}, []);
      }
      return skin;
    }

    _finish(skin, effectTexture, blendMode) {
      const blendIndex = BLEND_MODES.indexOf(blendMode);
      if (blendIndex <= 0 && this.blendOpacity >= 1) {
        this._replaceSkin(skin, effectTexture);
        return;
      }
      const target = skin._framebuffer.framebuffer || skin._framebuffer;
      this._render(this._program('composite'), target, [
        {name: 'u_base', texture: this.textures[0]},
        {name: 'u_effect', texture: effectTexture}
      ], {u_blend: Math.max(0, blendIndex), u_opacity: this.blendOpacity}, ['u_blend']);
      this._markSkinChanged(skin);
    }

    _canRenderDirectly(blendMode) {
      const blendIndex = BLEND_MODES.indexOf(blendMode);
      return blendIndex <= 0 && this.blendOpacity >= 1;
    }

    _isNoOp(mixValue, blendMode) {
      return mixValue <= 0 && BLEND_MODES.indexOf(blendMode) <= 0;
    }

    _renderEffect(skin, program, samplers, uniforms, integerUniforms, blendMode) {
      if (this._canRenderDirectly(blendMode)) {
        const target = skin._framebuffer.framebuffer || skin._framebuffer;
        this._render(program, target, samplers, uniforms, integerUniforms);
        this._markSkinChanged(skin);
      } else {
        this._ensureSecondaryBuffer();
        this._render(program, this.framebuffers[1], samplers, uniforms, integerUniforms);
        this._finish(skin, this.textures[1], blendMode);
      }
    }

    _markSkinChanged(skin) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      skin._silhouetteDirty = true;
      if (typeof skin.emitWasAltered === 'function') skin.emitWasAltered();
      renderer.dirty = true;
    }

    _replaceSkin(skin, texture) {
      const target = skin._framebuffer.framebuffer || skin._framebuffer;
      this._render(this._program('copy'), target, [{name: 'u_image', texture}], {}, []);
      this._markSkinChanged(skin);
    }

    _restoreGLState() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.colorMask(true, true, true, true);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    _clearTransparent(framebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    drawDefaultBackground(color4f) {
      const skin = this._prepare(false, false);
      if (!skin) return false;
      const target = skin._framebuffer.framebuffer || skin._framebuffer;
      const background = Array.isArray(color4f) || ArrayBuffer.isView(color4f) ? color4f : [1, 1, 1, 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(background[0], background[1], background[2], background[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this._markSkinChanged(skin);
      return true;
    }

    _createBufferTexture() {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return {texture, framebuffer};
    }

    _uploadDepthBuffer(depthBuffer) {
      if (!depthBuffer || !depthBuffer.canvas) return null;
      if (!this.depthTexture) this.depthTexture = gl.createTexture();
      if (this.depthSource === depthBuffer.canvas && this.depthVersion === depthBuffer.version) {
        return this.depthTexture;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const canRestorePixelStore = typeof gl.getParameter === 'function' && typeof gl.pixelStorei === 'function';
      const oldColorConversion = canRestorePixelStore ?
        gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) : null;
      const oldFlipY = canRestorePixelStore ? gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) : null;
      const oldPremultiply = canRestorePixelStore ? gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) : null;
      if (typeof gl.pixelStorei === 'function') {
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthBuffer.canvas);
      } finally {
        if (canRestorePixelStore) {
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, oldColorConversion);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, oldFlipY);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, oldPremultiply);
        }
      }
      this.depthSource = depthBuffer.canvas;
      this.depthVersion = depthBuffer.version;
      return this.depthTexture;
    }

    beginGroup() {
      const skin = this._prepare(false, false);
      if (!skin) return;
      const staging = this._createBufferTexture();
      const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
      const originalGetTexture = skin.getTexture;
      const baselineTexture = skin._texture;
      this.groupStack.push({
        baselineFramebuffer: skin._framebuffer,
        baselineTexture,
        framebuffer: staging.framebuffer,
        hadOwnGetTexture,
        originalGetTexture,
        skin,
        texture: staging.texture
      });
      skin._texture = staging.texture;
      skin._framebuffer = {
        attachments: [staging.texture],
        framebuffer: staging.framebuffer,
        height: this.height,
        width: this.width
      };
      // Pen stamps and lines write to _texture/_framebuffer, while the stage samples getTexture(). Keep
      // the pre-group frame visible until endGroup composites so grouped draws never expose an
      // intermediate transparent (black) frame, even while asynchronous Object draws are pending.
      if (!hadOwnGetTexture) skin.getTexture = () => baselineTexture;
      // Scratch's renderer can leave write masks or stencil state configured after a draw. Reset them before
      // clearing so the isolated group layer always starts with RGBA (0, 0, 0, 0).
      this._clearTransparent(staging.framebuffer);
      this._restoreGLState();
    }

    endGroup() {
      if (!this.groupStack.length) return;
      const entry = this.groupStack.pop();
      const skin = entry.skin;
      // The pen skin may have been resized or replaced while the group was open. Only composite when the
      // staged texture is still installed so we never render into a stale framebuffer.
      const stillStaged = Boolean(skin) && skin._texture === entry.texture;
      if (stillStaged) {
        skin._texture = entry.baselineTexture;
        skin._framebuffer = entry.baselineFramebuffer;
        this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
        if (this._prepare(false, false) === skin) {
          // Composite the isolated group content over the untouched baseline instead of replacing it, so
          // the default pen backdrop and earlier drawings survive every group.
          this._render(this._program('groupOver'), this.framebuffers[0], [
            {name: 'u_base', texture: entry.baselineTexture},
            {name: 'u_effect', texture: entry.texture}
          ], {}, []);
          this._replaceSkin(skin, this.textures[0]);
        }
      }
      gl.deleteFramebuffer(entry.framebuffer);
      gl.deleteTexture(entry.texture);
    }

    beginFrame() {
      if (this.frameTransaction) return false;
      const skin = this._penSkin();
      if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return false;
      if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
      this._resize(skin._size[0], skin._size[1]);
      const staging = this._createBufferTexture();
      gl.bindTexture(gl.TEXTURE_2D, staging.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
      const originalGetTexture = skin.getTexture;
      const baselineTexture = skin._texture;
      this.frameTransaction = {
        baselineFramebuffer: skin._framebuffer,
        baselineTexture,
        hadOwnGetTexture,
        originalGetTexture,
        skin,
        stagingFramebuffer: staging.framebuffer,
        stagingTexture: staging.texture
      };
      skin._texture = staging.texture;
      skin._framebuffer = {
        attachments: [staging.texture],
        framebuffer: staging.framebuffer,
        height: this.height,
        width: this.width
      };
      // Pen operations use _texture/_framebuffer, while stage drawing asks getTexture(). Keep the completed
      // previous frame visible until the staged pen texture is committed.
      skin.getTexture = () => baselineTexture;
      this._clearTransparent(staging.framebuffer);
      this._restoreGLState();
      return true;
    }

    restoreFrameTextureGetter(transaction) {
      this._restoreTextureGetter(transaction.skin, transaction.hadOwnGetTexture, transaction.originalGetTexture);
    }

    _restoreTextureGetter(skin, hadOwnGetTexture, originalGetTexture) {
      if (hadOwnGetTexture) {
        skin.getTexture = originalGetTexture;
      } else {
        delete skin.getTexture;
      }
    }

    commitFrame() {
      const transaction = this.frameTransaction;
      if (!transaction) return false;
      if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
      this.frameTransaction = null;
      this.restoreFrameTextureGetter(transaction);
      const baselineFramebuffer = transaction.baselineFramebuffer.framebuffer || transaction.baselineFramebuffer;
      gl.deleteFramebuffer(baselineFramebuffer);
      gl.deleteTexture(transaction.baselineTexture);
      this._markSkinChanged(transaction.skin);
      return true;
    }

    cancelFrame() {
      const transaction = this.frameTransaction;
      if (!transaction) return false;
      if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
      this.frameTransaction = null;
      gl.deleteFramebuffer(transaction.stagingFramebuffer);
      gl.deleteTexture(transaction.stagingTexture);
      transaction.skin._texture = transaction.baselineTexture;
      transaction.skin._framebuffer = transaction.baselineFramebuffer;
      this.restoreFrameTextureGetter(transaction);
      this._restoreGLState();
      return true;
    }

    clearGroupStack() {
      if (!this.groupStack) return;
      for (let i = this.groupStack.length - 1; i >= 0; i--) {
        const entry = this.groupStack[i];
        const skin = entry.skin;
        if (skin && skin._texture === entry.texture) {
          skin._texture = entry.baselineTexture;
          skin._framebuffer = entry.baselineFramebuffer;
          this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
        }
        gl.deleteFramebuffer(entry.framebuffer);
        gl.deleteTexture(entry.texture);
      }
      this.groupStack.length = 0;
    }

    stackCurrent(weight, limit) {
      const skin = this._prepare(false, false);
      if (!skin) return;
      const safeLimit = Math.min(120, Math.max(1, Math.floor(limit)));
      while (this.bufferStack.length > safeLimit) {
        const removed = this.bufferStack.shift();
        gl.deleteFramebuffer(removed.framebuffer);
        gl.deleteTexture(removed.texture);
      }
      const entry = this.bufferStack.length === safeLimit ?
        this.bufferStack.shift() : this._createBufferTexture();
      entry.weight = Math.max(0.0001, weight);
      this._render(this._program('copy'), entry.framebuffer, [{name: 'u_image', texture: skin._texture}], {}, []);
      this.bufferStack.push(entry);
      this._restoreGLState();
    }

    renderBufferStack(mode, clearAfter) {
      if (this.bufferStack.length === 0) return;
      const skin = this._prepare(false, false);
      if (!skin) return;
      if (this.bufferStack.length === 0) {
        this._restoreGLState();
        return;
      }
      const modeIndex = ['average', 'add', 'lighten', 'darken'].indexOf(mode);
      const firstEntry = this.bufferStack[0];
      let accumTexture = firstEntry.texture;
      let accumWeight = firstEntry.weight;
      let outputIndex = 1;
      let renderedDirectly = false;
      const target = skin._framebuffer.framebuffer || skin._framebuffer;
      if (modeIndex === 1 && firstEntry.weight !== 1) {
        let firstTarget = target;
        if (this.bufferStack.length !== 1) {
          this._ensureSecondaryBuffer();
          firstTarget = this.framebuffers[outputIndex];
        }
        this._render(this._program('stack'), firstTarget, [
          {name: 'u_accum', texture: firstEntry.texture},
          {name: 'u_sample', texture: firstEntry.texture}
        ], {
          u_mode: modeIndex,
          u_first: 1,
          u_accumWeight: 0,
          u_sampleWeight: firstEntry.weight
        }, ['u_mode', 'u_first']);
        if (this.bufferStack.length === 1) {
          this._markSkinChanged(skin);
          renderedDirectly = true;
        } else {
          accumTexture = this.textures[outputIndex];
          outputIndex = 1 - outputIndex;
        }
      }
      for (let i = 1; i < this.bufferStack.length; i++) {
        const entry = this.bufferStack[i];
        const isLast = i === this.bufferStack.length - 1;
        if (!isLast) this._ensureSecondaryBuffer();
        this._render(this._program('stack'), isLast ? target : this.framebuffers[outputIndex], [
          {name: 'u_accum', texture: accumTexture},
          {name: 'u_sample', texture: entry.texture}
        ], {
          u_mode: Math.max(0, modeIndex),
          u_first: 0,
          u_accumWeight: accumWeight,
          u_sampleWeight: entry.weight
        }, ['u_mode', 'u_first']);
        if (isLast) {
          this._markSkinChanged(skin);
          renderedDirectly = true;
        } else {
          accumTexture = this.textures[outputIndex];
          accumWeight += entry.weight;
          outputIndex = 1 - outputIndex;
        }
      }
      if (!renderedDirectly) this._replaceSkin(skin, accumTexture);
      if (clearAfter) this.clearBufferStack();
    }

    clearBufferStack() {
      if (!this.bufferStack) return;
      for (const entry of this.bufferStack) {
        gl.deleteFramebuffer(entry.framebuffer);
        gl.deleteTexture(entry.texture);
      }
      this.bufferStack.length = 0;
    }

    bufferStackSize() {
      return this.bufferStack.length;
    }

    _render(program, framebuffer, samplers, uniforms, integerUniforms) {
      // A work texture can still be bound on an otherwise-unused texture unit
      // from the previous pass. Some ANGLE backends treat that as a feedback
      // loop when the same texture becomes the next render target, so clear the
      // units before attaching the target framebuffer.
      for (let i = 0; i < 2; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(program);
      const position = this._position(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (let i = 0; i < samplers.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, samplers[i].texture);
        gl.uniform1i(this._location(program, samplers[i].name), i);
      }
      for (const name in uniforms) {
        const value = uniforms[name];
        const location = this._location(program, name);
        if (integerUniforms.indexOf(name) !== -1) {
          gl.uniform1i(location, value);
        } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
          if (value.length === 2) gl.uniform2fv(location, value);
          else if (value.length === 3) gl.uniform3fv(location, value);
          else if (value.length === 4) gl.uniform4fv(location, value);
        } else {
          gl.uniform1f(location, value);
        }
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    color(mode, uniforms, blendMode) {
      if (this._isNoOp(uniforms.mix === undefined ? 1 : uniforms.mix, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      this._renderEffect(skin, this._program('color'), [{name: 'u_image', texture: this.textures[0]}], {
        u_mode: mode,
        u_value: uniforms.value === undefined ? 1 : uniforms.value,
        u_mix: uniforms.mix === undefined ? 1 : uniforms.mix,
        u_pivot: uniforms.pivot === undefined ? 0.5 : uniforms.pivot,
        u_color: uniforms.color || [0, 0, 0],
        u_add: uniforms.add || [0, 0, 0],
        u_mul: uniforms.mul || [1, 1, 1],
        u_div: uniforms.div || [1, 1, 1]
      }, ['u_mode'], blendMode);
    }

    colorOverlay(overlayColor, mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      this._renderEffect(skin, this._program('colorOverlay'), [{name: 'u_image', texture: this.textures[0]}], {
        u_color: overlayColor,
        u_mix: mixValue
      }, [], blendMode);
    }

    gradationOverlay(stops, direction, mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode) || !Array.isArray(stops) || !stops.length) return;
      const skin = this._prepare();
      if (!skin) return;

      const normalizedStops = stops.slice(0, 8);
      const lastStop = normalizedStops[normalizedStops.length - 1];
      const uniforms = {
        u_direction: direction,
        u_mix: mixValue,
        u_stopCount: normalizedStops.length
      };
      for (let index = 0; index < 8; index++) {
        const stop = normalizedStops[index] || lastStop;
        uniforms[`u_color${index}`] = stop.color;
        uniforms[`u_position${index}`] = stop.position;
      }
      this._renderEffect(skin, this._program('gradationOverlay'), [
        {name: 'u_image', texture: this.textures[0]}
      ], uniforms, ['u_stopCount'], blendMode);
    }

    _singlePass(program, uniforms, integerUniforms, blendMode) {
      if (Object.prototype.hasOwnProperty.call(uniforms, 'u_mix') && this._isNoOp(uniforms.u_mix, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      if (Object.prototype.hasOwnProperty.call(uniforms, 'u_resolution')) {
        uniforms.u_resolution = this.resolution;
      }
      this._renderEffect(skin, program, [{name: 'u_image', texture: this.textures[0]}], uniforms, integerUniforms, blendMode);
    }

    _acerolaPass(program, mode, uniforms, integerUniforms, blendMode) {
      this._singlePass(program, Object.assign({
        u_resolution: this.resolution,
        u_mode: mode,
        u_type: 0,
        u_type2: 0,
        u_value: 0,
        u_value2: 0,
        u_value3: 0,
        u_mix: 1,
        u_time: 0,
        u_vec: [0, 0],
        u_vec2: [0, 0],
        u_color: [0, 0, 0],
        u_color2: [0, 0, 0],
        u_color3: [0, 0, 0],
        u_color4: [1, 1, 1]
      }, uniforms), ['u_mode', 'u_type', 'u_type2'].concat(integerUniforms || []), blendMode);
    }

    rgbShift(direction, value, pair, mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      this._renderEffect(skin, this._program('rgbShift'), [{name: 'u_image', texture: this.textures[0]}], {
        u_resolution: this.resolution, u_direction: direction, u_value: value, u_pair: pair,
        u_mix: mixValue
      }, ['u_pair'], blendMode);
    }

    vhs(tracking, chroma, noise, scanlines, seed, evolution, mixValue, blendMode) {
      this._singlePass(this._program('signal'), {
        u_resolution: this.resolution,
        u_mode: 0,
        u_tracking: Math.min(128, Math.max(0, Math.abs(tracking))),
        u_chroma: Math.min(64, Math.max(0, Math.abs(chroma))),
        u_noise: Math.min(1, Math.max(0, noise)),
        u_scanlines: Math.min(1, Math.max(0, scanlines)),
        u_seed: seed,
        u_evolution: evolution,
        u_slices: 1,
        u_shift: 0,
        u_rgb: 0,
        u_density: 0,
        u_mix: mixValue
      }, ['u_mode'], blendMode);
    }

    digitalGlitch(slices, shift, rgb, density, seed, evolution, mixValue, blendMode) {
      this._singlePass(this._program('signal'), {
        u_resolution: this.resolution,
        u_mode: 1,
        u_tracking: 0,
        u_chroma: 0,
        u_noise: 0,
        u_scanlines: 0,
        u_seed: seed,
        u_evolution: evolution,
        u_slices: Math.min(256, Math.max(1, Math.round(Math.abs(slices)))),
        u_shift: Math.min(512, Math.max(0, Math.abs(shift))),
        u_rgb: Math.min(128, Math.max(0, Math.abs(rgb))),
        u_density: Math.min(1, Math.max(0, density)),
        u_mix: mixValue
      }, ['u_mode'], blendMode);
    }

    gaussian(type, direction, radius, mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      const safeRadius = Math.min(256, Math.max(0, Math.abs(radius)));
      const direct = this._canRenderDirectly(blendMode);
      if (!direct) this._ensureSecondaryBuffer();
      const target = direct ? (skin._framebuffer.framebuffer || skin._framebuffer) : this.framebuffers[1];
      if (type === 'normal') {
        if (direct && safeRadius > 0.001) {
          this._ensureSecondaryBuffer();
          this._gaussianPass(this.textures[0], this.framebuffers[1], [1, 0], safeRadius, -1, 2, [0, 0], 1);
          this._gaussianPass(this.textures[1], target, [0, 1], safeRadius, -1, 2, [0, 0], mixValue);
        } else {
          this._gaussianPass(this.textures[0], target, [0, 0], safeRadius, -1, 1, [0, 0], mixValue);
        }
      } else {
        const vector = type === 'horizontal' ? [1, 0] : type === 'vertical' ? [0, 1] : [Math.sin(direction * Math.PI / 180), Math.cos(direction * Math.PI / 180)];
        this._gaussianPass(this.textures[0], target, vector, safeRadius, -1, 0, [0, 0], mixValue);
      }
      if (direct) this._markSkinChanged(skin);
      else this._finish(skin, this.textures[1], blendMode);
    }

    radial(type, radius, centerX, centerY, mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      const direct = this._canRenderDirectly(blendMode);
      if (!direct) this._ensureSecondaryBuffer();
      const target = direct ? (skin._framebuffer.framebuffer || skin._framebuffer) : this.framebuffers[1];
      this._gaussianPass(this.textures[0], target, [0, 0], Math.min(256, Math.max(0, Math.abs(radius))), type === 'dir' ? 0 : 1, 0, [centerX, centerY], mixValue);
      if (direct) this._markSkinChanged(skin);
      else this._finish(skin, this.textures[1], blendMode);
    }

    lensBlur(radius, shape, rotation, mixValue, blendMode) {
      const blades = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : 0;
      this._singlePass(this._program('lensBlur'), {
        u_resolution: this.resolution,
        u_radius: Math.min(256, Math.max(0, Math.abs(radius))),
        u_blades: blades,
        u_rotation: rotation,
        u_mix: mixValue
      }, [], blendMode);
    }

    depthOfField(depthBuffer, focusDistance, focusRange, aperture, maxBlur, nearStrength,
      farStrength, edgeSoftness, shape, rotation, mixValue, blendMode) {
      if (!depthBuffer || this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      const flatDepth = Number(depthBuffer.flatDepth);
      const hasFlatDepth = Number.isFinite(flatDepth) && flatDepth > 0;
      const depthTexture = hasFlatDepth ? this.textures[0] : this._uploadDepthBuffer(depthBuffer);
      if (!depthTexture) return;
      const cameraNear = hasFlatDepth ? 0.1 : Math.max(0.0001, Number(depthBuffer.near) || 0.1);
      const cameraFar = hasFlatDepth ? 1 : Math.max(cameraNear + 0.0001, Number(depthBuffer.far) || 1);
      const blades = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : 0;
      this._renderEffect(skin, this._program('depthOfField'), [
        {name: 'u_image', texture: this.textures[0]},
        {name: 'u_depth', texture: depthTexture}
      ], {
        u_resolution: this.resolution,
        u_cameraNear: cameraNear,
        u_cameraFar: cameraFar,
        u_flatDepth: hasFlatDepth ? flatDepth : -1,
        u_focusDistance: Math.max(0.0001, focusDistance),
        u_focusRange: Math.max(0, focusRange),
        u_aperture: Math.min(512, Math.max(0, aperture)),
        u_maxBlur: Math.min(128, Math.max(0, maxBlur)),
        u_nearStrength: Math.min(4, Math.max(0, nearStrength)),
        u_farStrength: Math.min(4, Math.max(0, farStrength)),
        u_edgeSoftness: Math.max(0, edgeSoftness),
        u_blades: blades,
        u_rotation: rotation,
        u_mix: mixValue
      }, [], blendMode);
    }

    fog(depthBuffer, type, start, end, density, curve, nearColor, farColor, mixValue, blendMode) {
      if (!depthBuffer || this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      const flatDepth = Number(depthBuffer.flatDepth);
      const hasFlatDepth = Number.isFinite(flatDepth) && flatDepth > 0;
      const depthTexture = hasFlatDepth ? this.textures[0] : this._uploadDepthBuffer(depthBuffer);
      if (!depthTexture) return;
      const cameraNear = hasFlatDepth ? 0.1 : Math.max(0.0001, Number(depthBuffer.near) || 0.1);
      const cameraFar = hasFlatDepth ? 1 : Math.max(cameraNear + 0.0001, Number(depthBuffer.far) || 1);
      const mode = Math.max(0, ['linear', 'smooth', 'exponential', 'exponential squared'].indexOf(type));
      this._renderEffect(skin, this._program('fog'), [
        {name: 'u_image', texture: this.textures[0]},
        {name: 'u_depth', texture: depthTexture}
      ], {
        u_cameraNear: cameraNear,
        u_cameraFar: cameraFar,
        u_flatDepth: hasFlatDepth ? flatDepth : -1,
        u_mode: mode,
        u_start: start,
        u_end: end,
        u_density: Math.min(1, Math.max(0, density)),
        u_curve: Math.min(100, Math.max(0.01, curve)),
        u_nearColor: nearColor,
        u_farColor: farColor,
        u_mix: mixValue
      }, ['u_mode'], blendMode);
    }

    lensDistortion(value, centerX, centerY, zoom, mixValue, blendMode) {
      this._singlePass(this._program('lensDistortion'), {
        u_resolution: this.resolution,
        u_center: [centerX, centerY],
        u_value: Math.min(2, Math.max(-2, value / 100)),
        u_zoom: Math.max(0.01, zoom / 100),
        u_mix: mixValue
      }, [], blendMode);
    }

    pixelStretch(type, position, size, sampleSize, centerX, centerY, mixValue, blendMode) {
      this._singlePass(this._program('pixelStretch'), {
        u_resolution: this.resolution,
        u_type: Math.max(0, ['x', 'y', 'size', 'dir'].indexOf(type)),
        u_position: position,
        u_size: Math.max(0, Math.abs(size)),
        u_sampleSize: Math.min(9, Math.max(1, Math.abs(sampleSize))),
        u_center: [centerX, centerY],
        u_mix: mixValue
      }, ['u_type'], blendMode);
    }

    edgeDetection(threshold, value, radius, softness, edgeColor, backgroundColor, hasBackground,
      alpha, mixValue, blendMode) {
      const normalizedThreshold = threshold > 1 ? threshold / 100 : threshold;
      const normalizedSoftness = softness > 1 ? softness / 100 : softness;
      this._acerolaPass(this._program('acerolaSpatial'), 0, {
        u_value: Math.min(4, Math.max(0, normalizedThreshold / Math.max(value, 0.0001))),
        u_value2: Math.min(8, Math.max(1, Math.abs(radius))),
        u_value3: Math.max(0.0001, normalizedSoftness),
        u_vec: [Math.min(1, Math.max(0, alpha)), hasBackground ? 1 : 0],
        u_color: edgeColor,
        u_color2: backgroundColor,
        u_mix: mixValue
      }, [], blendMode);
    }

    sharpen(value, radius, mixValue, blendMode) {
      this._singlePass(this._program('sharpen'), {
        u_resolution: this.resolution,
        u_value: Math.min(8, Math.max(0, value)),
        u_radius: Math.min(8, Math.max(1, Math.abs(radius))),
        u_mix: mixValue
      }, [], blendMode);
    }

    deepGlow(threshold, radius, value, glowColor, blendMode) {
      const normalizedThreshold = threshold > 1 ? threshold / 100 : threshold;
      this._singlePass(this._program('deepGlow'), {
        u_resolution: this.resolution,
        u_threshold: Math.min(1, Math.max(0, normalizedThreshold)),
        u_radius: Math.min(128, Math.max(0, Math.abs(radius))),
        u_value: Math.max(0, value),
        u_color: glowColor
      }, [], blendMode);
    }

    geometry(mode, type, uniforms, blendMode) {
      this._singlePass(this._program('geometry'), {
        u_resolution: this.resolution,
        u_mode: mode,
        u_type: type,
        u_value: uniforms.value === undefined ? 0 : uniforms.value,
        u_radius: uniforms.radius === undefined ? 0 : uniforms.radius,
        u_center: uniforms.center || [0, 0],
        u_offset: uniforms.offset || [0, 0],
        u_anchor: uniforms.anchor || [0, 0],
        u_blockSize: uniforms.blockSize || [1, 1],
        u_size: uniforms.size === undefined ? 100 : uniforms.size,
        u_direction: uniforms.direction === undefined ? 0 : uniforms.direction,
        u_width: uniforms.width === undefined ? 6 : uniforms.width,
        u_frequency: uniforms.frequency === undefined ? 0.55 : uniforms.frequency,
        u_mix: uniforms.mix === undefined ? 1 : uniforms.mix
      }, ['u_mode', 'u_type'], blendMode);
    }

    _gaussianPass(texture, framebuffer, direction, radius, radialType, twoDimensional, center, mixValue) {
      this._render(this._program('gaussian'), framebuffer, [{name: 'u_image', texture}], {
        u_resolution: this.resolution, u_direction: direction, u_radius: radius,
        u_radialType: radialType, u_twoDimensional: twoDimensional,
        u_center: center, u_mix: mixValue
      }, ['u_radialType', 'u_twoDimensional']);
    }

    bloom(threshold, radius, value, invert, glowColor, blendMode) {
      const skin = this._prepare();
      if (!skin) return;
      const normalizedThreshold = threshold > 1 ? threshold / 100 : threshold;
      const safeRadius = Math.min(256, Math.max(0, Math.abs(radius)));
      this._renderEffect(skin, this._program('bloom'), [{name: 'u_image', texture: this.textures[0]}], {
        u_resolution: this.resolution,
        u_threshold: Math.min(1, Math.max(0, normalizedThreshold)),
        u_radius: safeRadius,
        u_value: value,
        u_invert: invert ? 1 : 0,
        u_color: glowColor
      }, ['u_invert'], blendMode);
    }

    wavy(value, seed, offsetX, offsetY, size, complexity, evolution, type, centerX, centerY,
      mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      this._renderEffect(skin, this._program('wavy'), [{name: 'u_image', texture: this.textures[0]}], {
        u_resolution: this.resolution, u_value: value, u_seed: seed,
        u_offset: [offsetX, offsetY], u_center: [centerX, centerY], u_size: size,
        u_complexity: Math.min(8, Math.max(1, complexity)), u_evolution: evolution,
        u_type: Math.max(0, ['both', 'x', 'y', 'size', 'dir'].indexOf(type)), u_mix: mixValue
      }, ['u_type'], blendMode);
    }

    fractalNoise(fractalType, noiseType, invert, contrast, brightness, overflow, rotation, scale,
      width, height, offsetX, offsetY, perspective, depth, evolution, cycleEvolution, cycle, blendMode) {
      this._singlePass(this._program('fractalNoise'), {
        u_resolution: this.resolution,
        u_fractalType: Math.max(0, FRACTAL_TYPES.indexOf(fractalType)),
        u_noiseType: Math.max(0, FRACTAL_NOISE_TYPES.indexOf(noiseType)),
        u_invert: invert ? 1 : 0,
        u_contrast: contrast,
        u_brightness: brightness,
        u_overflow: Math.max(0, FRACTAL_OVERFLOW_TYPES.indexOf(overflow)),
        u_rotation: rotation,
        u_scale: scale,
        u_scaleDimensions: [width, height],
        u_offset: [offsetX, offsetY],
        u_perspective: perspective ? 1 : 0,
        u_depth: Math.min(10, Math.max(1, depth)),
        u_evolution: evolution,
        u_cycleEvolution: cycleEvolution ? 1 : 0,
        u_cycle: cycle
      }, ['u_fractalType', 'u_noiseType', 'u_invert', 'u_overflow', 'u_perspective', 'u_cycleEvolution'],
      blendMode);
    }

    alpha(value, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 0, {u_value: value, u_mix: mixValue}, [], blendMode);
    }

    chromaKey(keyColor, tolerance, softness, behavior, replacement, gradientEnd, mixValue, blendMode) {
      const behaviorIndex = ['solid', 'gradient', 'transparent'].indexOf(behavior);
      this._acerolaPass(this._program('acerolaColor'), 1, {
        u_type: Math.max(0, behaviorIndex), u_value: tolerance, u_value2: softness,
        u_color: keyColor, u_color2: replacement, u_color3: gradientEnd, u_mix: mixValue
      }, [], blendMode);
    }

    colorBlindness(type, severity, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 2, {
        u_type: Math.max(0, ['deuteranopia', 'protanopia', 'tritanopia'].indexOf(type)),
        u_value: severity, u_mix: mixValue
      }, [], blendMode);
    }

    colorGrade(exposure, temperature, tint, contrast, pivot, filter, saturation, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 3, {
        u_value: exposure, u_value2: temperature, u_value3: tint,
        u_vec: [pivot, contrast], u_color: filter, u_color2: [saturation, 0, 0], u_mix: mixValue
      }, [], blendMode);
    }

    dither(redCount, greenCount, blueCount, spread, scale, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 4, {
        u_vec: [redCount, greenCount], u_value: blueCount, u_value2: spread,
        u_value3: scale, u_mix: mixValue
      }, [], blendMode);
    }

    filmGrain(intensity, response, size, animate, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 5, {
        u_value: intensity, u_value2: response, u_value3: size,
        u_time: animate ? performance.now() / 1000 : 0, u_mix: mixValue
      }, [], blendMode);
    }

    toneMap(type, exposure, whitePoint, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 6, {
        u_type: Math.max(0, ['clamp', 'aces hill', 'aces', 'reinhard'].indexOf(type)),
        u_value: exposure, u_value2: whitePoint, u_mix: mixValue
      }, [], blendMode);
    }

    vignette(vignetteColor, sizeX, sizeY, offsetX, offsetY, intensity, roundness, softness, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 7, {
        u_vec: [sizeX, sizeY], u_vec2: [offsetX, offsetY], u_value: intensity,
        u_value2: roundness, u_value3: softness, u_color: vignetteColor, u_mix: mixValue
      }, [], blendMode);
    }

    composition(divisions, width, opacity, lineColor, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 8, {
        u_type: Math.min(12, Math.max(2, Math.round(divisions))), u_value: width,
        u_value2: opacity, u_color: lineColor, u_mix: mixValue
      }, [], blendMode);
    }

    halftone(size, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 9, {
        u_value: Math.max(1, size), u_mix: mixValue
      }, [], blendMode);
    }

    crt(curvature, border, scanSize, scanStrength, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 10, {
        u_value: curvature, u_value2: border, u_value3: scanSize,
        u_vec: [scanStrength, 0], u_mix: mixValue
      }, [], blendMode);
    }

    paletteSwap(colors, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 11, {
        u_color: colors[0], u_color2: colors[1], u_color3: colors[2], u_color4: colors[3],
        u_mix: mixValue
      }, [], blendMode);
    }

    colorSpaceAdjust(hueAdd, hueMultiply, saturationAdd, saturationMultiply, lightnessAdd, lightnessMultiply, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 12, {
        u_value: hueAdd, u_value2: hueMultiply, u_vec: [saturationAdd, saturationMultiply],
        u_vec2: [lightnessAdd, lightnessMultiply], u_mix: mixValue
      }, [], blendMode);
    }

    ascii(cellWidth, cellHeight, foreground, background, invert, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 13, {
        u_type: invert ? 1 : 0, u_vec: [cellWidth, cellHeight],
        u_color: foreground, u_color2: background, u_mix: mixValue
      }, [], blendMode);
    }

    framing(shape, radius, softness, frameColor, opacity, offsetX, offsetY, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 14, {
        u_type: shape === 'circle' ? 1 : 0, u_value: radius, u_value2: softness,
        u_value3: opacity, u_vec2: [offsetX, offsetY], u_color: frameColor, u_mix: mixValue
      }, [], blendMode);
    }

    autoExposure(target, minimum, maximum, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaColor'), 15, {
        u_value: target, u_value2: minimum, u_value3: maximum, u_mix: mixValue
      }, [], blendMode);
    }

    fxaa(contrastThreshold, relativeThreshold, subpixel, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaSpatial'), 1, {
        u_value: contrastThreshold, u_value2: relativeThreshold,
        u_value3: subpixel, u_mix: mixValue
      }, [], blendMode);
    }

    chromaticAberration(intensity, radius, hardness, offsetX, offsetY, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaSpatial'), 2, {
        u_value: intensity / 100, u_value2: radius, u_value3: hardness,
        u_vec: [offsetX, offsetY], u_mix: mixValue
      }, [], blendMode);
    }

    differenceOfGaussians(sigma, sigmaScale, tau, threshold, colored, inkColor, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaSpatial'), 3, {
        u_type: colored ? 1 : 0, u_value: Math.max(0.1, sigma),
        u_value2: Math.max(0.1, sigma * sigmaScale), u_value3: tau,
        u_vec: [Math.max(0.0001, threshold), 0], u_color: inkColor, u_mix: mixValue
      }, [], blendMode);
    }

    kuwahara(radius, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaSpatial'), 4, {
        u_value: Math.min(12, Math.max(1, radius)), u_mix: mixValue
      }, [], blendMode);
    }

    zoom(value, offsetX, offsetY, sampleMode, mixValue, blendMode) {
      this._acerolaPass(this._program('acerolaSpatial'), 5, {
        u_type: Math.max(0, ['clamp', 'mirror', 'wrap', 'border'].indexOf(sampleMode)),
        u_value: Math.max(0.001, value), u_vec: [offsetX, offsetY], u_mix: mixValue
      }, [], blendMode);
    }

    pixelSort(type, spanLimit, invertMask, minimum, maximum, sortBy, reverse, gamma, centerX, centerY,
      mixValue, blendMode) {
      if (this._isNoOp(mixValue, blendMode)) return;
      const skin = this._prepare();
      if (!skin) return;
      const pixelCount = this.width * this.height;
      if (!this.pixelSortSource || this.pixelSortSource.length !== pixelCount * 4) {
        this.pixelSortSource = new Uint8Array(pixelCount * 4);
        this.pixelSortOutput = new Uint8Array(pixelCount * 4);
        this.pixelSortKeys = new Float64Array(pixelCount);
        this.pixelSortSelected = new Uint8Array(pixelCount);
      }
      const source = this.pixelSortSource;
      const output = this.pixelSortOutput;
      const keys = this.pixelSortKeys;
      const selected = this.pixelSortSelected;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, source);
      output.set(source);
      const low = Math.min(minimum, maximum);
      const high = Math.max(minimum, maximum);
      for (let index = 0, offset = 0; index < pixelCount; index++, offset += 4) {
        const alphaByte = source[offset + 3];
        let value = -1;
        if (alphaByte > 0) {
          const r = source[offset] / alphaByte;
          const g = source[offset + 1] / alphaByte;
          const b = source[offset + 2] / alphaByte;
          if (sortBy === 'saturation') {
            value = Math.max(r, g, b) - Math.min(r, g, b);
          } else if (sortBy === 'hue') {
            const max = Math.max(r, g, b);
            const delta = max - Math.min(r, g, b);
            if (delta <= 0.00001) {
              value = 0;
            } else {
              let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
              if (hue < 0) hue += 6;
              value = hue / 6;
            }
          } else {
            value = r * 0.2126 + g * 0.7152 + b * 0.0722;
          }
        }
        keys[index] = value;
        const inside = value >= low && value <= high;
        selected[index] = value >= 0 && (invertMask ? !inside : inside) ? 1 : 0;
      }
      const requestedSpan = Math.floor(Math.abs(spanLimit));
      const indices = this.pixelSortIndices;
      const lineIndices = this.pixelSortLine;
      const compare = reverse ?
        (a, b) => keys[b] - keys[a] || a - b :
        (a, b) => keys[a] - keys[b] || a - b;
      const inverseMix = 1 - mixValue;
      const applyGamma = gamma !== 1;
      const sortLine = line => {
        const lineLength = line.length;
        const maxSpan = requestedSpan >= lineLength ? lineLength : Math.min(256, Math.max(1, requestedSpan));
        let position = 0;
        while (position < lineLength) {
          const pixelIndex = line[position];
          if (!selected[pixelIndex]) { position++; continue; }
          const start = position;
          let count = 0;
          while (position < lineLength && count < maxSpan) {
            const candidate = line[position];
            if (!selected[candidate]) break;
            indices[count++] = candidate;
            position++;
          }
          indices.length = count;
          indices.sort(compare);
          for (let i = 0; i < count; i++) {
            const targetOffset = line[start + i] * 4;
            const sampleOffset = indices[i] * 4;
            const alphaByte = source[sampleOffset + 3];
            let red = source[sampleOffset];
            let green = source[sampleOffset + 1];
            let blue = source[sampleOffset + 2];
            if (applyGamma && alphaByte > 0) {
              red = Math.pow(Math.max(0, red / alphaByte), gamma) * alphaByte;
              green = Math.pow(Math.max(0, green / alphaByte), gamma) * alphaByte;
              blue = Math.pow(Math.max(0, blue / alphaByte), gamma) * alphaByte;
            }
            output[targetOffset] = Math.round(source[targetOffset] * inverseMix + red * mixValue);
            output[targetOffset + 1] = Math.round(source[targetOffset + 1] * inverseMix + green * mixValue);
            output[targetOffset + 2] = Math.round(source[targetOffset + 2] * inverseMix + blue * mixValue);
            output[targetOffset + 3] = Math.round(source[targetOffset + 3] * inverseMix + alphaByte * mixValue);
          }
        }
      };
      if (type === 'x' || type === 'y') {
        const lineCount = type === 'y' ? this.width : this.height;
        const lineLength = type === 'y' ? this.height : this.width;
        const stride = type === 'y' ? this.width : 1;
        for (let lineNumber = 0; lineNumber < lineCount; lineNumber++) {
          const lineStart = type === 'y' ? lineNumber : lineNumber * this.width;
          lineIndices.length = lineLength;
          for (let position = 0; position < lineLength; position++) {
            lineIndices[position] = lineStart + position * stride;
          }
          sortLine(lineIndices);
        }
      } else {
        const center = [
          Math.min(this.width - 0.5, Math.max(0.5, this.width * 0.5 + centerX)),
          Math.min(this.height - 0.5, Math.max(0.5, this.height * 0.5 + centerY))
        ];
        const maxRadius = Math.ceil(Math.max(
          Math.hypot(center[0], center[1]),
          Math.hypot(this.width - center[0], center[1]),
          Math.hypot(center[0], this.height - center[1]),
          Math.hypot(this.width - center[0], this.height - center[1])
        ));
        const addPolarPixel = (x, y, previous) => {
          const px = Math.floor(x);
          const py = Math.floor(y);
          if (px < 0 || px >= this.width || py < 0 || py >= this.height) return previous;
          const index = py * this.width + px;
          if (index !== previous) lineIndices.push(index);
          return index;
        };
        if (type === 'size') {
          const rayCount = Math.min(1440, Math.max(360, Math.ceil(Math.PI * 2 * maxRadius)));
          for (let ray = 0; ray < rayCount; ray++) {
            const angle = ray / rayCount * Math.PI * 2;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            let previous = -1;
            lineIndices.length = 0;
            for (let radius = 0; radius <= maxRadius; radius++) {
              previous = addPolarPixel(center[0] + cosine * radius, center[1] + sine * radius, previous);
            }
            sortLine(lineIndices);
          }
        } else {
          for (let radius = 0; radius <= maxRadius; radius++) {
            const sampleCount = Math.max(1, Math.ceil(Math.PI * 2 * Math.max(radius, 1)));
            let previous = -1;
            lineIndices.length = 0;
            for (let sample = 0; sample < sampleCount; sample++) {
              const angle = sample / sampleCount * Math.PI * 2;
              previous = addPolarPixel(center[0] + Math.cos(angle) * radius,
                center[1] + Math.sin(angle) * radius, previous);
            }
            sortLine(lineIndices);
          }
        }
      }
      const direct = this._canRenderDirectly(blendMode);
      if (!direct) this._ensureSecondaryBuffer();
      gl.bindTexture(gl.TEXTURE_2D, direct ? skin._texture : this.textures[1]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, output);
      if (direct) this._markSkinChanged(skin);
      else this._finish(skin, this.textures[1], blendMode);
    }

    displacement(costume, value, type, channel, invert, center, mixValue, target, blendMode) {
      if (this.blendOpacity <= 0 || this._isNoOp(mixValue, blendMode)) return;
      const mapTexture = this._costumeTexture(costume, target);
      if (!mapTexture) return;
      const skin = this._prepare();
      if (!skin) return;
      const typeIndex = ['x', 'y', 'size', 'dir'].indexOf(type);
      const channelIndex = ['luminance', 'r', 'g', 'b', 'a'].indexOf(channel);
      this._renderEffect(skin, this._program('displacement'), [
        {name: 'u_image', texture: this.textures[0]},
        {name: 'u_map', texture: mapTexture}
      ], {
        u_resolution: this.resolution, u_value: value, u_type: Math.max(0, typeIndex),
        u_channel: Math.max(0, channelIndex), u_invert: invert ? 1 : 0,
        u_center: center, u_mix: mixValue
      }, ['u_type', 'u_channel', 'u_invert'], blendMode);
    }

    _costumeTexture(costumeName, target) {
      if (!target || typeof target.getCostumes !== 'function' || !renderer._allSkins) return null;
      const costumes = target.getCostumes();
      let costume = costumes.find(item => item.name === String(costumeName));
      if (!costume) {
        const numericIndex = Math.floor(Number(costumeName)) - 1;
        if (Number.isFinite(numericIndex)) costume = costumes[numericIndex];
      }
      if (!costume) return null;
      const skin = renderer._allSkins[costume.skinId];
      // Reuse the renderer texture so this block never waits for an Image load.
      return skin && typeof skin.getTexture === 'function' ? skin.getTexture([100, 100]) : null;
    }
  }

  const number = value => {
    const result = Cast.toNumber(value);
    return Number.isFinite(result) ? result : 0;
  };

  const numberOr = (value, fallback) => (
    value === undefined || value === null || value === '' ? fallback : number(value)
  );

  const mixAmount = value => Math.min(1, Math.max(0, numberOr(value, 100) / 100));

  const evolutionAmount = value => Math.min(100000, Math.max(-100000, number(value)));

  const seedAmount = value => Math.min(100000, Math.max(-100000, number(value)));

  const color = value => {
    const rgb = Cast.toRgbColorObject(value);
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  };

  const DEFAULT_GRADIENT_STOPS = [
    {color: '#000000', position: 0},
    {color: '#ffffff', position: 1}
  ];

  const gradient = value => {
    let descriptor = value;
    if (typeof descriptor === 'string') {
      try {
        descriptor = JSON.parse(descriptor);
      } catch (error) {
        descriptor = null;
      }
    }
    const sourceStops = descriptor && Array.isArray(descriptor.stops) ? descriptor.stops : DEFAULT_GRADIENT_STOPS;
    const stops = sourceStops.map(stop => ({
      color: color(stop && stop.color || '#000000'),
      position: Math.min(1, Math.max(0, numberOr(stop && stop.position, 0)))
    })).slice(0, 8);
    if (!stops.length) return DEFAULT_GRADIENT_STOPS.map(stop => ({
      color: color(stop.color),
      position: stop.position
    }));
    stops.sort((a, b) => a.position - b.position);
    return stops;
  };

  const boolean = value => value === true || String(value).toLowerCase() === 'true';

  class PenFX {
    constructor() {
      this.engine = null;
      this.blendMode = 'normal';
      this.blendOpacity = 1;
      this.warned = false;
      this.effectCaptureStack = [];
      vm.runtime.penFX = this;
      const movieAssetManager = vm.runtime.movieAssetManager;
      if (movieAssetManager && typeof movieAssetManager.attachPenFrameTransactions === 'function') {
        movieAssetManager.attachPenFrameTransactions(this);
      }
    }

    getInfo() {
      return {
        id: 'penfx',
        name: 'Pen FX',
        color1: '#6b56d9',
        color2: '#5945c2',
        color3: '#46359f',
        blocks: [
          {opcode: 'contrast', blockType: BlockType.COMMAND, text: 'contrast value: [VALUE] pivot: [PIVOT] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, PIVOT: {type: ArgumentType.NUMBER, defaultValue: 0.5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'brightness', blockType: BlockType.COMMAND, text: 'brightness color: [COLOR] value: [VALUE] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#101010'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'gamma', blockType: BlockType.COMMAND, text: 'gamma value: [VALUE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'saturation', blockType: BlockType.COMMAND, text: 'saturation value: [VALUE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'alpha', blockType: BlockType.COMMAND, text: 'alpha [VALUE] % mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'colorGrade', blockType: BlockType.COMMAND, text: 'color grade exposure: [EXPOSURE] temp: [TEMP] tint: [TINT] contrast: [CONTRAST] pivot: [PIVOT] filter: [COLOR] saturation: [SATURATION] mix: [MIX] %', arguments: {EXPOSURE: {type: ArgumentType.NUMBER, defaultValue: 0}, TEMP: {type: ArgumentType.NUMBER, defaultValue: 0}, TINT: {type: ArgumentType.NUMBER, defaultValue: 0}, CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 1}, PIVOT: {type: ArgumentType.NUMBER, defaultValue: 0.5}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, SATURATION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'colorBlindness', blockType: BlockType.COMMAND, text: 'color blindness [TYPE] severity: [SEVERITY] % mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'colorBlindType'}, SEVERITY: {type: ArgumentType.NUMBER, defaultValue: 50}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'colorSpaceAdjust', blockType: BlockType.COMMAND, text: 'HSL adjust hue add: [HADD] mul: [HMUL] saturation add: [SADD] mul: [SMUL] lightness add: [LADD] mul: [LMUL] mix: [MIX] %', arguments: {HADD: {type: ArgumentType.NUMBER, defaultValue: 0}, HMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, SADD: {type: ArgumentType.NUMBER, defaultValue: 0}, SMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, LADD: {type: ArgumentType.NUMBER, defaultValue: 0}, LMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'toneMap', blockType: BlockType.COMMAND, text: 'tone map [TYPE] exposure: [EXPOSURE] white point: [WHITE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'toneMapType'}, EXPOSURE: {type: ArgumentType.NUMBER, defaultValue: 0}, WHITE: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'autoExposure', blockType: BlockType.COMMAND, text: 'auto exposure target: [TARGET] min: [MIN] max: [MAX] mix: [MIX] %', arguments: {TARGET: {type: ArgumentType.NUMBER, defaultValue: 0.18}, MIN: {type: ArgumentType.NUMBER, defaultValue: 0.25}, MAX: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'paletteSwap', blockType: BlockType.COMMAND, text: 'palette map shadows: [C1] [C2] [C3] highlights: [C4] mix: [MIX] %', arguments: {C1: {type: ArgumentType.COLOR, defaultValue: '#0b1026'}, C2: {type: ArgumentType.COLOR, defaultValue: '#3b426e'}, C3: {type: ArgumentType.COLOR, defaultValue: '#8a6f7d'}, C4: {type: ArgumentType.COLOR, defaultValue: '#f6d6bd'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'chromaKey', blockType: BlockType.COMMAND, text: 'chroma key: [KEY] tolerance: [TOLERANCE] softness: [SOFTNESS] use [BEHAVIOR] colors: [COLOR1] [COLOR2] mix: [MIX] %', arguments: {KEY: {type: ArgumentType.COLOR, defaultValue: '#00ff00'}, TOLERANCE: {type: ArgumentType.NUMBER, defaultValue: 0.1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.05}, BEHAVIOR: {type: ArgumentType.STRING, menu: 'chromaBehavior'}, COLOR1: {type: ArgumentType.COLOR, defaultValue: '#000000'}, COLOR2: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'colorOverlay', blockType: BlockType.COMMAND, text: 'color overlay [COLOR] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'gradationOverlay', blockType: BlockType.COMMAND, text: 'gradation overlay [GRADIENT] dir: [DIR] mix: [MIX] %', arguments: {GRADIENT: {type: ArgumentType.STRING, defaultValue: '{"stops":[{"color":"#000000","position":0},{"color":"#ffffff","position":1}]}'}, DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          '---',
          {opcode: 'rgbShift', blockType: BlockType.COMMAND, text: 'rgb shift dir: [DIR] value: [VALUE] color: [COLOR] mix: [MIX] %', arguments: {DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, COLOR: {type: ArgumentType.STRING, menu: 'rgbPair'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'gaussianBlur', blockType: BlockType.COMMAND, text: 'gaussian blur type: [TYPE] value: [VALUE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'gaussianType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'directionalBlur', blockType: BlockType.COMMAND, text: 'directional blur dir: [DIR] value: [VALUE] mix: [MIX] %', arguments: {DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'radialBlur', blockType: BlockType.COMMAND, text: 'radial blur type: [TYPE] value: [VALUE] center x: [X] y: [Y] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'polarType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'lensBlur', blockType: BlockType.COMMAND, text: 'lens blur radius: [RADIUS] shape: [SHAPE] rotation: [ROTATION] mix: [MIX] %', arguments: {RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, SHAPE: {type: ArgumentType.STRING, menu: 'lensShape'}, ROTATION: {type: ArgumentType.ANGLE, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'depthOfField', blockType: BlockType.COMMAND, text: 'depth of field focus: [FOCUS] range: [RANGE] aperture: [APERTURE] max blur: [MAXBLUR] near: [NEAR] % far: [FAR] % edge softness: [EDGE] shape: [SHAPE] rotation: [ROTATION] mix: [MIX] %', arguments: {FOCUS: {type: ArgumentType.NUMBER, defaultValue: 480}, RANGE: {type: ArgumentType.NUMBER, defaultValue: 24}, APERTURE: {type: ArgumentType.NUMBER, defaultValue: 48}, MAXBLUR: {type: ArgumentType.NUMBER, defaultValue: 24}, NEAR: {type: ArgumentType.NUMBER, defaultValue: 100}, FAR: {type: ArgumentType.NUMBER, defaultValue: 100}, EDGE: {type: ArgumentType.NUMBER, defaultValue: 8}, SHAPE: {type: ArgumentType.STRING, menu: 'lensShape'}, ROTATION: {type: ArgumentType.ANGLE, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'fog', blockType: BlockType.COMMAND, text: 'fog [TYPE] start: [START] end: [END] near color: [NEARCOLOR] far color: [FARCOLOR] density: [DENSITY] % curve: [CURVE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'fogType'}, START: {type: ArgumentType.NUMBER, defaultValue: 100}, END: {type: ArgumentType.NUMBER, defaultValue: 1000}, NEARCOLOR: {type: ArgumentType.COLOR, defaultValue: '#d9e7f2'}, FARCOLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, DENSITY: {type: ArgumentType.NUMBER, defaultValue: 100}, CURVE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'lensDistortion', blockType: BlockType.COMMAND, text: 'lens distortion value: [VALUE] center x: [X] y: [Y] zoom: [ZOOM] % mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 25}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, ZOOM: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'bloom', blockType: BlockType.COMMAND, text: 'bloom threshold: [THRESHOLD] radius: [RADIUS] value: [VALUE] color: [COLOR] invert: [INVERT]', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.7}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}}},
          {opcode: 'deepGlow', blockType: BlockType.COMMAND, text: 'deep glow threshold: [THRESHOLD] radius: [RADIUS] value: [VALUE] color: [COLOR]', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.7}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}}},
          {opcode: 'edgeDetection', blockType: BlockType.COMMAND, text: 'edge detection threshold: [THRESHOLD] strength: [VALUE] radius: [RADIUS] softness: [SOFTNESS] color: [COLOR] background: [BACKGROUND] alpha: [ALPHA] % mix: [MIX] %', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.1}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, BACKGROUND: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, ALPHA: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'sharpen', blockType: BlockType.COMMAND, text: 'sharpen value: [VALUE] radius: [RADIUS] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'fxaa', blockType: BlockType.COMMAND, text: 'FXAA contrast: [CONTRAST] relative: [RELATIVE] subpixel: [SUBPIXEL] mix: [MIX] %', arguments: {CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 0.0312}, RELATIVE: {type: ArgumentType.NUMBER, defaultValue: 0.063}, SUBPIXEL: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'differenceOfGaussians', blockType: BlockType.COMMAND, text: 'difference of gaussians sigma: [SIGMA] scale: [SCALE] tau: [TAU] threshold: [THRESHOLD] colored: [COLORED] ink: [COLOR] mix: [MIX] %', arguments: {SIGMA: {type: ArgumentType.NUMBER, defaultValue: 1}, SCALE: {type: ArgumentType.NUMBER, defaultValue: 1.6}, TAU: {type: ArgumentType.NUMBER, defaultValue: 0.98}, THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLORED: {type: ArgumentType.STRING, menu: 'boolean'}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#101020'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'kuwahara', blockType: BlockType.COMMAND, text: 'kuwahara radius: [RADIUS] mix: [MIX] %', arguments: {RADIUS: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          '---',
          {opcode: 'chromaticAberration', blockType: BlockType.COMMAND, text: 'chromatic aberration intensity: [INTENSITY] radius: [RADIUS] hardness: [HARDNESS] offset x: [X] y: [Y] mix: [MIX] %', arguments: {INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 2}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, HARDNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'filmGrain', blockType: BlockType.COMMAND, text: 'film grain intensity: [INTENSITY] response: [RESPONSE] size: [SIZE] animate: [ANIMATE] mix: [MIX] %', arguments: {INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 0.15}, RESPONSE: {type: ArgumentType.NUMBER, defaultValue: 0.15}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 1}, ANIMATE: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'dither', blockType: BlockType.COMMAND, text: 'dither colors r: [R] g: [G] b: [B] spread: [SPREAD] scale: [SCALE] mix: [MIX] %', arguments: {R: {type: ArgumentType.NUMBER, defaultValue: 4}, G: {type: ArgumentType.NUMBER, defaultValue: 4}, B: {type: ArgumentType.NUMBER, defaultValue: 4}, SPREAD: {type: ArgumentType.NUMBER, defaultValue: 0.5}, SCALE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'halftone', blockType: BlockType.COMMAND, text: 'CMYK halftone size: [SIZE] mix: [MIX] %', arguments: {SIZE: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'ascii', blockType: BlockType.COMMAND, text: 'ASCII cell x: [X] y: [Y] foreground: [FG] background: [BG] invert: [INVERT] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 6}, Y: {type: ArgumentType.NUMBER, defaultValue: 8}, FG: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, BG: {type: ArgumentType.COLOR, defaultValue: '#000000'}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'crt', blockType: BlockType.COMMAND, text: 'CRT curvature: [CURVATURE] border: [BORDER] scan size: [SIZE] strength: [STRENGTH] mix: [MIX] %', arguments: {CURVATURE: {type: ArgumentType.NUMBER, defaultValue: 10}, BORDER: {type: ArgumentType.NUMBER, defaultValue: 0.08}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 2}, STRENGTH: {type: ArgumentType.NUMBER, defaultValue: 0.35}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'vhs', blockType: BlockType.COMMAND, text: 'VHS tracking: [TRACKING] px chroma bleed: [CHROMA] px noise: [NOISE] % scanlines: [SCANLINES] % seed: [SEED] evolution: [EVOLUTION] mix: [MIX] %', arguments: {TRACKING: {type: ArgumentType.NUMBER, defaultValue: 6}, CHROMA: {type: ArgumentType.NUMBER, defaultValue: 3}, NOISE: {type: ArgumentType.NUMBER, defaultValue: 12}, SCANLINES: {type: ArgumentType.NUMBER, defaultValue: 25}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'glitch', blockType: BlockType.COMMAND, text: 'digital glitch slices: [SLICES] shift: [SHIFT] px RGB split: [RGB] px density: [DENSITY] % seed: [SEED] evolution: [EVOLUTION] mix: [MIX] %', arguments: {SLICES: {type: ArgumentType.NUMBER, defaultValue: 24}, SHIFT: {type: ArgumentType.NUMBER, defaultValue: 28}, RGB: {type: ArgumentType.NUMBER, defaultValue: 6}, DENSITY: {type: ArgumentType.NUMBER, defaultValue: 35}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'vignette', blockType: BlockType.COMMAND, text: 'vignette color: [COLOR] size x: [X] y: [Y] offset x: [OFFSETX] y: [OFFSETY] intensity: [INTENSITY] roundness: [ROUNDNESS] softness: [SOFTNESS] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, X: {type: ArgumentType.NUMBER, defaultValue: 1}, Y: {type: ArgumentType.NUMBER, defaultValue: 1}, OFFSETX: {type: ArgumentType.NUMBER, defaultValue: 0}, OFFSETY: {type: ArgumentType.NUMBER, defaultValue: 0}, INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 1}, ROUNDNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'composition', blockType: BlockType.COMMAND, text: 'composition grid [DIVISIONS] divisions width: [WIDTH] color: [COLOR] opacity: [OPACITY] % mix: [MIX] %', arguments: {DIVISIONS: {type: ArgumentType.NUMBER, defaultValue: 3}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 50}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'framing', blockType: BlockType.COMMAND, text: 'frame [SHAPE] radius: [RADIUS] softness: [SOFTNESS] color: [COLOR] opacity: [OPACITY] % offset x: [X] y: [Y] mix: [MIX] %', arguments: {SHAPE: {type: ArgumentType.STRING, menu: 'frameShape'}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 0.45}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'zoom', blockType: BlockType.COMMAND, text: 'zoom scale: [VALUE] offset x: [X] y: [Y] sample: [SAMPLE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SAMPLE: {type: ArgumentType.STRING, menu: 'sampleMode'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'wavy', blockType: BlockType.COMMAND, text: 'wavy type: [TYPE] amount: [VALUE] size: [SIZE] complexity: [COMPLEXITY] evolution: [EVOLUTION] seed: [SEED] offset x: [X] y: [Y] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'turbulenceType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 8}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 64}, COMPLEXITY: {type: ArgumentType.NUMBER, defaultValue: 3}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {
            opcode: 'fractalnoise',
            blockType: BlockType.COMMAND,
            text: 'fractal noise fractal type: [FRACTALTYPE] noise type: [NOISETYPE] invert: [INVERT] contrast: [CONTRAST] brightness: [BRIGHTNESS] overflow: [OVERFLOW] rotate: [ROTATE] scale: [SCALE] width: [WIDTH] height: [HEIGHT] random offset: [OX] [OY] perspective offset: [PERSPECTIVE] depth: [DEPTH] evolution: [EVOLUTION] cycle evolution: [CYCLEEVOLUTION] cycle: [FREQ]',
            arguments: {
              FRACTALTYPE: {type: ArgumentType.STRING, menu: 'fractalType'},
              NOISETYPE: {type: ArgumentType.STRING, menu: 'fractalNoiseType'},
              INVERT: {type: ArgumentType.STRING, menu: 'boolean'},
              CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 100},
              BRIGHTNESS: {type: ArgumentType.NUMBER, defaultValue: 0},
              OVERFLOW: {type: ArgumentType.STRING, menu: 'fractalOverflowType'},
              ROTATE: {type: ArgumentType.ANGLE, defaultValue: 0},
              SCALE: {type: ArgumentType.NUMBER, defaultValue: 100},
              WIDTH: {type: ArgumentType.NUMBER, defaultValue: 100},
              HEIGHT: {type: ArgumentType.NUMBER, defaultValue: 100},
              OX: {type: ArgumentType.NUMBER, defaultValue: 0},
              OY: {type: ArgumentType.NUMBER, defaultValue: 0},
              PERSPECTIVE: {type: ArgumentType.STRING, menu: 'boolean'},
              DEPTH: {type: ArgumentType.NUMBER, defaultValue: 6},
              EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0},
              CYCLEEVOLUTION: {type: ArgumentType.STRING, menu: 'boolean'},
              FREQ: {type: ArgumentType.NUMBER, defaultValue: 1}
            }
          },
          {opcode: 'pulse', blockType: BlockType.COMMAND, text: 'pulse center x: [X] y: [Y] radius: [RADIUS] value: [VALUE] width: [WIDTH] frequency: [FREQUENCY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 80}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 12}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 18}, FREQUENCY: {type: ArgumentType.NUMBER, defaultValue: 0.55}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'pixelate', blockType: BlockType.COMMAND, text: 'pixelate size x: [X] y: [Y] offset x: [OFFSETX] y: [OFFSETY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 8}, Y: {type: ArgumentType.NUMBER, defaultValue: 8}, OFFSETX: {type: ArgumentType.NUMBER, defaultValue: 0}, OFFSETY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'pixelStretch', blockType: BlockType.COMMAND, text: 'pixel stretch type: [TYPE] position: [POSITION] size: [SIZE] sample width: [SAMPLE] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'stretchType'}, POSITION: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 100}, SAMPLE: {type: ArgumentType.NUMBER, defaultValue: 1}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'mirror', blockType: BlockType.COMMAND, text: 'mirror type: [TYPE] center x: [X] y: [Y] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'mirrorType'}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'transform', blockType: BlockType.COMMAND, text: 'transform x: [X] y: [Y] size: [SIZE] dir: [DIR] anchor x: [ANCHORX] y: [ANCHORY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 100}, DIR: {type: ArgumentType.ANGLE, defaultValue: 0}, ANCHORX: {type: ArgumentType.NUMBER, defaultValue: 0}, ANCHORY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'duplicate', blockType: BlockType.COMMAND, text: 'duplicate x: [X] y: [Y] size: [SIZE] dir: [DIR] anchor x: [ANCHORX] y: [ANCHORY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 50}, DIR: {type: ArgumentType.ANGLE, defaultValue: 0}, ANCHORX: {type: ArgumentType.NUMBER, defaultValue: 0}, ANCHORY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'pixelSort', blockType: BlockType.COMMAND, text: 'pixelsort [TYPE] span: [SPAN] min: [MIN] max: [MAX] invert mask: [INVERT] sort by: [SORTBY] reverse: [REVERSE] gamma: [GAMMA] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'sortAxis'}, SPAN: {type: ArgumentType.NUMBER, defaultValue: 64}, MIN: {type: ArgumentType.NUMBER, defaultValue: 0.4}, MAX: {type: ArgumentType.NUMBER, defaultValue: 0.72}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, SORTBY: {type: ArgumentType.STRING, menu: 'sortBy'}, REVERSE: {type: ArgumentType.STRING, menu: 'boolean'}, GAMMA: {type: ArgumentType.NUMBER, defaultValue: 1}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          {opcode: 'colorAdjustment', blockType: BlockType.COMMAND, text: 'color adjustment add: [ADD] mul: [MUL] div: [DIV] mix: [MIX] %', arguments: {ADD: {type: ArgumentType.COLOR, defaultValue: '#000000'}, MUL: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, DIV: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          '---',
          {opcode: 'displacementMap', blockType: BlockType.COMMAND, text: 'displacement map costume: [COSTUME] value: [VALUE] type: [TYPE] channel: [CHANNEL] center: [CENTER] invert: [INVERT] mix: [MIX] %', arguments: {COSTUME: {type: ArgumentType.COSTUME}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 10}, TYPE: {type: ArgumentType.STRING, menu: 'axisType'}, CHANNEL: {type: ArgumentType.STRING, menu: 'mapChannel'}, CENTER: {type: ArgumentType.NUMBER, defaultValue: 0.5}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
          '---',
          {opcode: 'stackCurrentDrawing', blockType: BlockType.COMMAND, text: 'stack current drawing weight: [WEIGHT] max samples: [LIMIT]', arguments: {WEIGHT: {type: ArgumentType.NUMBER, defaultValue: 1}, LIMIT: {type: ArgumentType.NUMBER, defaultValue: 10}}},
          {opcode: 'renderBufferStack', blockType: BlockType.COMMAND, text: 'render stacked drawings using [MODE] clear after: [CLEAR]', arguments: {MODE: {type: ArgumentType.STRING, menu: 'bufferMode'}, CLEAR: {type: ArgumentType.STRING, menu: 'boolean'}}},
          {opcode: 'clearBufferStack', blockType: BlockType.COMMAND, text: 'clear drawing stack'},
          {opcode: 'bufferStackSize', blockType: BlockType.REPORTER, text: 'drawing stack samples'},
          '---',
          {opcode: 'setBlendMode', blockType: BlockType.COMMAND, text: 'use [TYPE] blending mode opacity: [OPACITY] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'blendMode'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}}}
        ],
        menus: {
          rgbPair: {acceptReporters: true, items: ['RG', 'GB', 'BR']},
          colorBlindType: {acceptReporters: true, items: ['deuteranopia', 'protanopia', 'tritanopia']},
          toneMapType: {acceptReporters: true, items: ['clamp', 'aces hill', 'aces', 'reinhard']},
          chromaBehavior: {acceptReporters: true, items: ['solid', 'gradient', 'transparent']},
          gaussianType: {acceptReporters: true, items: ['normal', 'horizontal', 'vertical']},
          lensShape: {acceptReporters: true, items: ['circle', 'hexagon', 'octagon']},
          fogType: {acceptReporters: true, items: ['linear', 'smooth', 'exponential', 'exponential squared']},
          polarType: {acceptReporters: true, items: ['dir', 'size']},
          axisType: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
          sortAxis: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
          sortBy: {acceptReporters: true, items: ['luminance', 'saturation', 'hue']},
          frameShape: {acceptReporters: true, items: ['rectangle', 'circle']},
          sampleMode: {acceptReporters: true, items: ['clamp', 'mirror', 'wrap', 'border']},
          stretchType: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
          turbulenceType: {acceptReporters: true, items: ['both', 'x', 'y', 'size', 'dir']},
          fractalType: {acceptReporters: true, items: FRACTAL_TYPES},
          fractalNoiseType: {acceptReporters: true, items: FRACTAL_NOISE_TYPES},
          fractalOverflowType: {acceptReporters: true, items: FRACTAL_OVERFLOW_TYPES},
          mapChannel: {acceptReporters: true, items: ['luminance', 'r', 'g', 'b', 'a']},
          bufferMode: {acceptReporters: true, items: ['average', 'add', 'lighten', 'darken']},
          mirrorType: {acceptReporters: true, items: ['x', 'y', 'xy']},
          boolean: {acceptReporters: true, items: ['false', 'true']},
          blendMode: {acceptReporters: true, items: ['normal', 'add', 'mul', 'screen', 'overlay', 'darken', 'lighten', 'color dodge']}
        }
      };
    }

    _getEngine() {
      if (!this.engine) this.engine = new PenFXEngine();
      return this.engine;
    }

    _executeSafe(callback, blendMode, blendOpacity) {
      const previousBlendMode = this.blendMode;
      const previousBlendOpacity = this.blendOpacity;
      let engine;
      try {
        this.blendMode = blendMode;
        this.blendOpacity = blendOpacity;
        engine = this._getEngine();
        engine.blendOpacity = this.blendOpacity;
        callback(engine);
      } catch (error) {
        console.error('[Pen FX]', error);
      } finally {
        // _prepare disables blending before compiling the selected program. If compilation or rendering fails,
        // leaving that state active makes the transparent Pen framebuffer cover the stage as opaque black.
        if (engine && typeof engine._restoreGLState === 'function') engine._restoreGLState();
        this.blendMode = previousBlendMode;
        this.blendOpacity = previousBlendOpacity;
      }
    }

    _safe(callback) {
      if (this.effectCaptureStack.length) {
        this.effectCaptureStack[this.effectCaptureStack.length - 1].push({
          blendMode: this.blendMode,
          blendOpacity: this.blendOpacity,
          callback
        });
        return;
      }
      this._executeSafe(callback, this.blendMode, this.blendOpacity);
    }

    beginEffectCapture() {
      this.effectCaptureStack.push([]);
    }

    endEffectCapture() {
      return this.effectCaptureStack.pop() || [];
    }

    applyCapturedEffects(effects) {
      for (const effect of effects || []) {
        this._executeSafe(effect.callback, effect.blendMode, effect.blendOpacity);
      }
    }

    contrast(args) { this._safe(engine => engine.color(0, {value: number(args.VALUE), pivot: numberOr(args.PIVOT, 0.5), mix: mixAmount(args.MIX)}, this.blendMode)); }
    brightness(args) { this._safe(engine => engine.color(1, {color: color(args.COLOR), value: numberOr(args.VALUE, 1), mix: mixAmount(args.MIX)}, this.blendMode)); }
    gamma(args) { this._safe(engine => engine.color(2, {value: number(args.VALUE), mix: mixAmount(args.MIX)}, this.blendMode)); }
    saturation(args) { this._safe(engine => engine.color(3, {value: number(args.VALUE), mix: mixAmount(args.MIX)}, this.blendMode)); }
    alpha(args) { this._safe(engine => engine.alpha(numberOr(args.VALUE, 100) / 100, mixAmount(args.MIX), this.blendMode)); }

    colorGrade(args) {
      this._safe(engine => engine.colorGrade(number(args.EXPOSURE), number(args.TEMP), number(args.TINT),
        numberOr(args.CONTRAST, 1), numberOr(args.PIVOT, 0.5), color(args.COLOR || '#ffffff'),
        number(args.SATURATION), mixAmount(args.MIX), this.blendMode));
    }

    colorBlindness(args) {
      const type = ['deuteranopia', 'protanopia', 'tritanopia'].includes(String(args.TYPE)) ? String(args.TYPE) : 'deuteranopia';
      this._safe(engine => engine.colorBlindness(type, Math.min(1, Math.max(0, number(args.SEVERITY) / 100)), mixAmount(args.MIX), this.blendMode));
    }

    colorSpaceAdjust(args) {
      this._safe(engine => engine.colorSpaceAdjust(number(args.HADD), numberOr(args.HMUL, 1),
        number(args.SADD), numberOr(args.SMUL, 1), number(args.LADD), numberOr(args.LMUL, 1),
        mixAmount(args.MIX), this.blendMode));
    }

    toneMap(args) {
      const type = ['clamp', 'aces hill', 'aces', 'reinhard'].includes(String(args.TYPE)) ? String(args.TYPE) : 'aces';
      this._safe(engine => engine.toneMap(type, number(args.EXPOSURE), numberOr(args.WHITE, 4), mixAmount(args.MIX), this.blendMode));
    }

    autoExposure(args) {
      const minimum = Math.max(0, numberOr(args.MIN, 0.25));
      const maximum = Math.max(minimum, numberOr(args.MAX, 4));
      this._safe(engine => engine.autoExposure(Math.max(0.001, numberOr(args.TARGET, 0.18)), minimum, maximum, mixAmount(args.MIX), this.blendMode));
    }

    paletteSwap(args) {
      this._safe(engine => engine.paletteSwap([color(args.C1), color(args.C2), color(args.C3), color(args.C4)], mixAmount(args.MIX), this.blendMode));
    }

    colorOverlay(args) {
      this._safe(engine => engine.colorOverlay(color(args.COLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode));
    }

    gradationOverlay(args) {
      this._safe(engine => engine.gradationOverlay(
        gradient(args.GRADIENT), numberOr(args.DIR, 90), mixAmount(args.MIX), this.blendMode
      ));
    }

    chromaKey(args) {
      const behavior = ['solid', 'gradient', 'transparent'].includes(String(args.BEHAVIOR)) ? String(args.BEHAVIOR) : 'solid';
      this._safe(engine => engine.chromaKey(color(args.KEY), Math.max(0, number(args.TOLERANCE)),
        Math.max(0.0001, numberOr(args.SOFTNESS, 0.05)), behavior, color(args.COLOR1), color(args.COLOR2),
        mixAmount(args.MIX), this.blendMode));
    }

    rgbShift(args) {
      const pair = ['RG', 'GB', 'BR'].indexOf(String(args.COLOR).toUpperCase());
      this._safe(engine => engine.rgbShift(number(args.DIR), number(args.VALUE), Math.max(0, pair), mixAmount(args.MIX), this.blendMode));
    }

    gaussianBlur(args) {
      const type = ['normal', 'horizontal', 'vertical'].includes(String(args.TYPE)) ? String(args.TYPE) : 'normal';
      this._safe(engine => engine.gaussian(type, 0, number(args.VALUE), mixAmount(args.MIX), this.blendMode));
    }

    directionalBlur(args) {
      this._safe(engine => engine.gaussian('directional', number(args.DIR), number(args.VALUE), mixAmount(args.MIX), this.blendMode));
    }

    radialBlur(args) {
      const type = String(args.TYPE) === 'size' ? 'size' : 'dir';
      this._safe(engine => engine.radial(type, number(args.VALUE), numberOr(args.X, 0), numberOr(args.Y, 0), mixAmount(args.MIX), this.blendMode));
    }

    lensBlur(args) {
      const shape = ['circle', 'hexagon', 'octagon'].includes(String(args.SHAPE)) ? String(args.SHAPE) : 'circle';
      this._safe(engine => engine.lensBlur(number(args.RADIUS), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode));
    }

    depthOfField(args) {
      const shape = ['circle', 'hexagon', 'octagon'].includes(String(args.SHAPE)) ? String(args.SHAPE) : 'circle';
      this._safe(engine => engine.depthOfField(vm.runtime.movieZBuffer,
        numberOr(args.FOCUS, 480), numberOr(args.RANGE, 24), numberOr(args.APERTURE, 48),
        numberOr(args.MAXBLUR, 24), numberOr(args.NEAR, 100) / 100, numberOr(args.FAR, 100) / 100,
        numberOr(args.EDGE, 8), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode));
    }

    fog(args) {
      const type = ['linear', 'smooth', 'exponential', 'exponential squared'].includes(String(args.TYPE)) ?
        String(args.TYPE) : 'linear';
      this._safe(engine => engine.fog(vm.runtime.movieZBuffer, type, numberOr(args.START, 100),
        numberOr(args.END, 1000), numberOr(args.DENSITY, 100) / 100, numberOr(args.CURVE, 1),
        color(args.NEARCOLOR || '#d9e7f2'), color(args.FARCOLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode));
    }

    lensDistortion(args) {
      this._safe(engine => engine.lensDistortion(number(args.VALUE), number(args.X), number(args.Y), numberOr(args.ZOOM, 100), mixAmount(args.MIX), this.blendMode));
    }

    bloom(args) {
      this._safe(engine => engine.bloom(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE), boolean(args.INVERT), color(args.COLOR || '#ffffff'), this.blendMode));
    }

    deepGlow(args) {
      this._safe(engine => engine.deepGlow(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE), color(args.COLOR || '#ffffff'), this.blendMode));
    }

    edgeDetection(args) {
      const hasBackground = args.BACKGROUND !== undefined && args.BACKGROUND !== null && args.BACKGROUND !== '';
      this._safe(engine => engine.edgeDetection(number(args.THRESHOLD), numberOr(args.VALUE, 1),
        numberOr(args.RADIUS, 1), numberOr(args.SOFTNESS, 0.02), color(args.COLOR || '#000000'),
        color(hasBackground ? args.BACKGROUND : '#000000'), hasBackground,
        Math.min(1, Math.max(0, numberOr(args.ALPHA, 100) / 100)), mixAmount(args.MIX), this.blendMode));
    }

    sharpen(args) {
      this._safe(engine => engine.sharpen(number(args.VALUE), numberOr(args.RADIUS, 1), mixAmount(args.MIX), this.blendMode));
    }

    fxaa(args) {
      this._safe(engine => engine.fxaa(numberOr(args.CONTRAST, 0.0312), numberOr(args.RELATIVE, 0.063),
        numberOr(args.SUBPIXEL, 1), mixAmount(args.MIX), this.blendMode));
    }

    differenceOfGaussians(args) {
      this._safe(engine => engine.differenceOfGaussians(numberOr(args.SIGMA, 1), numberOr(args.SCALE, 1.6),
        numberOr(args.TAU, 0.98), numberOr(args.THRESHOLD, 0.02), boolean(args.COLORED),
        color(args.COLOR || '#101020'), mixAmount(args.MIX), this.blendMode));
    }

    kuwahara(args) {
      this._safe(engine => engine.kuwahara(numberOr(args.RADIUS, 4), mixAmount(args.MIX), this.blendMode));
    }

    chromaticAberration(args) {
      this._safe(engine => engine.chromaticAberration(number(args.INTENSITY), numberOr(args.RADIUS, 1),
        numberOr(args.HARDNESS, 1), number(args.X), number(args.Y), mixAmount(args.MIX), this.blendMode));
    }

    filmGrain(args) {
      this._safe(engine => engine.filmGrain(numberOr(args.INTENSITY, 0.15), numberOr(args.RESPONSE, 0.15),
        numberOr(args.SIZE, 1), boolean(args.ANIMATE), mixAmount(args.MIX), this.blendMode));
    }

    dither(args) {
      this._safe(engine => engine.dither(Math.min(32, Math.max(2, numberOr(args.R, 4))),
        Math.min(32, Math.max(2, numberOr(args.G, 4))), Math.min(32, Math.max(2, numberOr(args.B, 4))),
        numberOr(args.SPREAD, 0.5), Math.max(1, numberOr(args.SCALE, 1)), mixAmount(args.MIX), this.blendMode));
    }

    halftone(args) { this._safe(engine => engine.halftone(numberOr(args.SIZE, 4), mixAmount(args.MIX), this.blendMode)); }

    ascii(args) {
      this._safe(engine => engine.ascii(Math.max(2, numberOr(args.X, 6)), Math.max(2, numberOr(args.Y, 8)),
        color(args.FG), color(args.BG), boolean(args.INVERT), mixAmount(args.MIX), this.blendMode));
    }

    crt(args) {
      this._safe(engine => engine.crt(Math.max(1, numberOr(args.CURVATURE, 10)), Math.max(0.001, numberOr(args.BORDER, 0.08)),
        Math.max(1, numberOr(args.SIZE, 2)), Math.min(1, Math.max(0, numberOr(args.STRENGTH, 0.35))),
        mixAmount(args.MIX), this.blendMode));
    }

    vhs(args) {
      this._safe(engine => engine.vhs(numberOr(args.TRACKING, 6), numberOr(args.CHROMA, 3),
        numberOr(args.NOISE, 12) / 100, numberOr(args.SCANLINES, 25) / 100,
        seedAmount(args.SEED), evolutionAmount(args.EVOLUTION), mixAmount(args.MIX), this.blendMode));
    }

    glitch(args) {
      this._safe(engine => engine.digitalGlitch(numberOr(args.SLICES, 24), numberOr(args.SHIFT, 28),
        numberOr(args.RGB, 6), numberOr(args.DENSITY, 35) / 100, seedAmount(args.SEED), evolutionAmount(args.EVOLUTION),
        mixAmount(args.MIX), this.blendMode));
    }

    vignette(args) {
      this._safe(engine => engine.vignette(color(args.COLOR), numberOr(args.X, 1), numberOr(args.Y, 1),
        number(args.OFFSETX), number(args.OFFSETY), numberOr(args.INTENSITY, 1), numberOr(args.ROUNDNESS, 1),
        numberOr(args.SOFTNESS, 1), mixAmount(args.MIX), this.blendMode));
    }

    composition(args) {
      this._safe(engine => engine.composition(numberOr(args.DIVISIONS, 3), numberOr(args.WIDTH, 1),
        Math.min(1, Math.max(0, numberOr(args.OPACITY, 50) / 100)), color(args.COLOR), mixAmount(args.MIX), this.blendMode));
    }

    framing(args) {
      this._safe(engine => engine.framing(String(args.SHAPE) === 'circle' ? 'circle' : 'rectangle',
        numberOr(args.RADIUS, 0.45), numberOr(args.SOFTNESS, 0.02), color(args.COLOR),
        Math.min(1, Math.max(0, numberOr(args.OPACITY, 100) / 100)), number(args.X), number(args.Y),
        mixAmount(args.MIX), this.blendMode));
    }

    zoom(args) {
      const mode = ['clamp', 'mirror', 'wrap', 'border'].includes(String(args.SAMPLE)) ? String(args.SAMPLE) : 'clamp';
      this._safe(engine => engine.zoom(numberOr(args.VALUE, 1), number(args.X), number(args.Y), mode, mixAmount(args.MIX), this.blendMode));
    }

    wavy(args) {
      const type = ['both', 'x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'both';
      this._safe(engine => engine.wavy(number(args.VALUE), seedAmount(args.SEED), number(args.X), number(args.Y),
        number(args.SIZE), numberOr(args.COMPLEXITY, 3), evolutionAmount(args.EVOLUTION), type,
        number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    }

    fractalnoise(args) {
      const fractalType = FRACTAL_TYPES.includes(String(args.FRACTALTYPE)) ?
        String(args.FRACTALTYPE) : FRACTAL_TYPES[0];
      const noiseType = FRACTAL_NOISE_TYPES.includes(String(args.NOISETYPE)) ?
        String(args.NOISETYPE) : FRACTAL_NOISE_TYPES[0];
      const overflow = FRACTAL_OVERFLOW_TYPES.includes(String(args.OVERFLOW)) ?
        String(args.OVERFLOW) : FRACTAL_OVERFLOW_TYPES[0];
      this._safe(engine => engine.fractalNoise(fractalType, noiseType, boolean(args.INVERT),
        numberOr(args.CONTRAST, 100), number(args.BRIGHTNESS), overflow, number(args.ROTATE),
        numberOr(args.SCALE, 100), numberOr(args.WIDTH, 100), numberOr(args.HEIGHT, 100),
        number(args.OX), number(args.OY), boolean(args.PERSPECTIVE), numberOr(args.DEPTH, 6),
        evolutionAmount(args.EVOLUTION), boolean(args.CYCLEEVOLUTION), numberOr(args.FREQ, 1), this.blendMode));
    }

    pulse(args) {
      this._safe(engine => engine.geometry(0, 0, {
        center: [number(args.X), number(args.Y)], radius: number(args.RADIUS), value: number(args.VALUE),
        width: numberOr(args.WIDTH, Math.max(Math.abs(number(args.RADIUS)) * 0.22, 6)),
        frequency: numberOr(args.FREQUENCY, 0.55), mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    pixelate(args) {
      const oldSize = numberOr(args.SIZE, 8);
      this._safe(engine => engine.geometry(1, 0, {
        blockSize: [numberOr(args.X, oldSize), numberOr(args.Y, oldSize)],
        offset: [numberOr(args.OFFSETX, 0), numberOr(args.OFFSETY, 0)], mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    pixelStretch(args) {
      const type = ['x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'x';
      this._safe(engine => engine.pixelStretch(type, number(args.POSITION), number(args.SIZE),
        numberOr(args.SAMPLE, 1), number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    }

    mirror(args) {
      const type = ['x', 'y', 'xy'].indexOf(String(args.TYPE));
      this._safe(engine => engine.geometry(2, Math.max(0, type), {
        center: [numberOr(args.X, 0), numberOr(args.Y, 0)], mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    transform(args) {
      this._safe(engine => engine.geometry(3, 0, {
        offset: [number(args.X), number(args.Y)], size: number(args.SIZE), direction: number(args.DIR),
        anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)], mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    duplicate(args) {
      this._safe(engine => engine.geometry(4, 0, {
        offset: [number(args.X), number(args.Y)], size: numberOr(args.SIZE, 50), direction: number(args.DIR),
        anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)], mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    pixelSort(args) {
      const type = ['x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'x';
      const sortBy = ['luminance', 'saturation', 'hue'].includes(String(args.SORTBY)) ? String(args.SORTBY) : 'luminance';
      this._safe(engine => engine.pixelSort(type, numberOr(args.SPAN, numberOr(args.VALUE, 64)), boolean(args.INVERT),
        Math.min(1, Math.max(0, numberOr(args.MIN, 0))), Math.min(1, Math.max(0, numberOr(args.MAX, 1))),
        sortBy, boolean(args.REVERSE), Math.max(0.01, numberOr(args.GAMMA, 1)), number(args.CENTERX),
        number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    }

    colorAdjustment(args) {
      this._safe(engine => engine.color(4, {
        add: color(args.ADD), mul: color(args.MUL), div: color(args.DIV), mix: mixAmount(args.MIX)
      }, this.blendMode));
    }

    displacementMap(args, util) {
      const type = ['x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'x';
      const channel = ['luminance', 'r', 'g', 'b', 'a'].includes(String(args.CHANNEL)) ? String(args.CHANNEL) : 'luminance';
      this._safe(engine => engine.displacement(args.COSTUME, number(args.VALUE), type, channel,
        boolean(args.INVERT), numberOr(args.CENTER, 0.5), mixAmount(args.MIX), util.target, this.blendMode));
    }

    stackCurrentDrawing(args) {
      this._safe(engine => engine.stackCurrent(numberOr(args.WEIGHT, 1), numberOr(args.LIMIT, 10)));
    }

    renderBufferStack(args) {
      const mode = ['average', 'add', 'lighten', 'darken'].includes(String(args.MODE)) ? String(args.MODE) : 'average';
      this._safe(engine => engine.renderBufferStack(mode, boolean(args.CLEAR)));
    }

    clearBufferStack() {
      if (!this.engine) return;
      this._safe(engine => engine.clearBufferStack());
    }

    bufferStackSize() {
      return this.engine ? this.engine.bufferStackSize() : 0;
    }

    beginGroup() {
      this._safe(engine => engine.beginGroup());
    }

    endGroup() {
      this._safe(engine => engine.endGroup());
    }

    beginFrame() {
      try {
        return this._getEngine().beginFrame();
      } catch (error) {
        console.error('[Pen FX]', error);
        return false;
      }
    }

    commitFrame() {
      try {
        return this._getEngine().commitFrame();
      } catch (error) {
        console.error('[Pen FX]', error);
        return false;
      }
    }

    cancelFrame() {
      try {
        return this._getEngine().cancelFrame();
      } catch (error) {
        console.error('[Pen FX]', error);
        return false;
      }
    }

    cancelGroups() {
      this.effectCaptureStack.length = 0;
      if (!this.engine) return;
      try {
        this.engine.clearGroupStack();
        this.engine._restoreGLState();
      } catch (error) {
        console.error('[Pen FX]', error);
      }
    }

    drawDefaultBackground(color4f) {
      const pen = vm.runtime.ext_pen;
      if (pen && typeof pen._getPenLayerID === 'function') pen._getPenLayerID();
      try {
        this._getEngine().drawDefaultBackground(color4f);
      } catch (error) {
        console.error('[Pen FX]', error);
      }
    }

    setBlendMode(args) {
      const mode = String(args.TYPE);
      this.blendMode = BLEND_MODES.includes(mode) ? mode : 'normal';
      this.blendOpacity = mixAmount(args.OPACITY);
    }
  }

  return PenFX;
};

const installPenFX = vm => {
  const extensionManager = vm.extensionManager;
  if (extensionManager.isExtensionLoaded('penfx')) return vm;

  const PenFX = createPenFXClass(vm);
  extensionManager.addBuiltinExtension('penfx', PenFX);
  extensionManager.loadExtensionIdSync('penfx');
  return vm;
};

export {
  createPenFXClass,
  installPenFX as default
};
