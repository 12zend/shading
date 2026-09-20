/* eslint-disable */

const CHROMA_KEY_BEHAVIORS = ['solid', 'gradient', 'transparent'];
const COLOR_BLINDNESS_TYPES = ['deuteranopia', 'protanopia', 'tritanopia'];
const TONE_MAP_TYPES = ['clamp', 'aces hill', 'aces', 'reinhard'];

const install = ({ Engine }) => {
  Engine.prototype.alpha = function (value, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 0, { u_value: value, u_mix: mixValue }, [], blendMode);
  };

  Engine.prototype.chromaKey = function (keyColor, tolerance, softness, behavior, replacement, gradientEnd, mixValue, blendMode) {
    const behaviorIndex = CHROMA_KEY_BEHAVIORS.indexOf(behavior);
    this._acerolaPass(this._program('acerolaColor'), 1, {
      u_type: Math.max(0, behaviorIndex),
      u_value: tolerance,
      u_value2: softness,
      u_color: keyColor,
      u_color2: replacement,
      u_color3: gradientEnd,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.colorBlindness = function (type, severity, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 2, {
      u_type: Math.max(0, COLOR_BLINDNESS_TYPES.indexOf(type)),
      u_value: severity,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.colorGrade = function (exposure, temperature, tint, contrast, pivot, filter, saturation, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 3, {
      u_value: exposure,
      u_value2: temperature,
      u_value3: tint,
      u_vec: [pivot, contrast],
      u_color: filter,
      u_color2: [saturation, 0, 0],
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.dither = function (redCount, greenCount, blueCount, spread, scale, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 4, {
      u_vec: [redCount, greenCount],
      u_value: blueCount,
      u_value2: spread,
      u_value3: scale,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.filmGrain = function (intensity, response, size, animate, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 5, {
      u_value: intensity,
      u_value2: response,
      u_value3: size,
      u_time: animate ? performance.now() / 1000 : 0,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.toneMap = function (type, exposure, whitePoint, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 6, {
      u_type: Math.max(0, TONE_MAP_TYPES.indexOf(type)),
      u_value: exposure,
      u_value2: whitePoint,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.vignette = function (vignetteColor, sizeX, sizeY, offsetX, offsetY, intensity, roundness, softness, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 7, {
      u_vec: [sizeX, sizeY],
      u_vec2: [offsetX, offsetY],
      u_value: intensity,
      u_value2: roundness,
      u_value3: softness,
      u_color: vignetteColor,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.composition = function (divisions, width, opacity, lineColor, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 8, {
      u_type: Math.min(12, Math.max(2, Math.round(divisions))),
      u_value: width,
      u_value2: opacity,
      u_color: lineColor,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.halftone = function (size, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 9, {
      u_value: Math.max(1, size), u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.crt = function (curvature, border, scanSize, scanStrength, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 10, {
      u_value: curvature,
      u_value2: border,
      u_value3: scanSize,
      u_vec: [scanStrength, 0],
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.paletteSwap = function (colors, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 11, {
      u_color: colors[0],
      u_color2: colors[1],
      u_color3: colors[2],
      u_color4: colors[3],
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.colorSpaceAdjust = function (hueAdd, hueMultiply, saturationAdd, saturationMultiply, lightnessAdd, lightnessMultiply, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 12, {
      u_value: hueAdd,
      u_value2: hueMultiply,
      u_vec: [saturationAdd, saturationMultiply],
      u_vec2: [lightnessAdd, lightnessMultiply],
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.ascii = function (cellWidth, cellHeight, foreground, background, invert, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 13, {
      u_type: invert ? 1 : 0,
      u_vec: [cellWidth, cellHeight],
      u_color: foreground,
      u_color2: background,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.framing = function (shape, radius, softness, frameColor, opacity, offsetX, offsetY, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 14, {
      u_type: shape === 'circle' ? 1 : 0,
      u_value: radius,
      u_value2: softness,
      u_value3: opacity,
      u_vec2: [offsetX, offsetY],
      u_color: frameColor,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.autoExposure = function (target, minimum, maximum, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaColor'), 15, {
      u_value: target, u_value2: minimum, u_value3: maximum, u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
