/* eslint-disable */

import { boolean, color, mixAmount, number, numberOr } from '../helpers';

const CHROMA_KEY_BEHAVIORS = ['solid', 'gradient', 'transparent'];
const COLOR_BLINDNESS_TYPES = ['deuteranopia', 'protanopia', 'tritanopia'];
const TONE_MAP_TYPES = ['clamp', 'aces hill', 'aces', 'reinhard'];

const install = ({ PenFX }) => {

  PenFX.prototype.alpha = function (args) {
    this._safe((engine) => engine.alpha(numberOr(args.VALUE, 100) / 100, mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.colorGrade = function (args) {
    this._safe((engine) => engine.colorGrade(number(args.EXPOSURE), number(args.TEMP), number(args.TINT),
    numberOr(args.CONTRAST, 1), numberOr(args.PIVOT, 0.5), color(args.COLOR || '#ffffff'),
    number(args.SATURATION), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.colorBlindness = function (args) {
    const requested = String(args.TYPE);
    const type = COLOR_BLINDNESS_TYPES.includes(requested) ? requested : 'deuteranopia';
    this._safe((engine) => engine.colorBlindness(type, Math.min(1, Math.max(0, number(args.SEVERITY) / 100)), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.colorSpaceAdjust = function (args) {
    const hueAdd = number(args.HADD);
    const hueMultiply = numberOr(args.HMUL, 1);
    const saturationAdd = number(args.SADD);
    const saturationMultiply = numberOr(args.SMUL, 1);
    const lightnessAdd = number(args.LADD);
    const lightnessMultiply = numberOr(args.LMUL, 1);
    const mixValue = mixAmount(args.MIX);
    this._safe((engine) => engine.colorSpaceAdjust(hueAdd, hueMultiply, saturationAdd, saturationMultiply,
    lightnessAdd, lightnessMultiply, mixValue, this.blendMode));
  };

  PenFX.prototype.toneMap = function (args) {
    const requested = String(args.TYPE);
    const type = TONE_MAP_TYPES.includes(requested) ? requested : 'aces';
    this._safe((engine) => engine.toneMap(type, number(args.EXPOSURE), numberOr(args.WHITE, 4), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.autoExposure = function (args) {
    const minimum = Math.max(0, numberOr(args.MIN, 0.25));
    const maximum = Math.max(minimum, numberOr(args.MAX, 4));
    this._safe((engine) => engine.autoExposure(Math.max(0.001, numberOr(args.TARGET, 0.18)), minimum, maximum, mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.paletteSwap = function (args) {
    this._safe((engine) => engine.paletteSwap([color(args.C1), color(args.C2), color(args.C3), color(args.C4)], mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.chromaKey = function (args) {
    const requested = String(args.BEHAVIOR);
    const behavior = CHROMA_KEY_BEHAVIORS.includes(requested) ? requested : 'solid';
    this._safe((engine) => engine.chromaKey(color(args.KEY), Math.max(0, number(args.TOLERANCE)),
    Math.max(0.0001, numberOr(args.SOFTNESS, 0.05)), behavior, color(args.COLOR1), color(args.COLOR2),
    mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.vignette = function (args) {
    this._safe((engine) => engine.vignette(color(args.COLOR), numberOr(args.X, 1), numberOr(args.Y, 1),
    number(args.OFFSETX), number(args.OFFSETY), numberOr(args.INTENSITY, 1), numberOr(args.ROUNDNESS, 1),
    numberOr(args.SOFTNESS, 1), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.composition = function (args) {
    this._safe((engine) => engine.composition(numberOr(args.DIVISIONS, 3), numberOr(args.WIDTH, 1),
    Math.min(1, Math.max(0, numberOr(args.OPACITY, 50) / 100)), color(args.COLOR), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.filmGrain = function (args) {
    this._safe((engine) => engine.filmGrain(numberOr(args.INTENSITY, 0.15), numberOr(args.RESPONSE, 0.15),
    numberOr(args.SIZE, 1), boolean(args.ANIMATE), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.dither = function (args) {
    this._safe((engine) => engine.dither(Math.min(32, Math.max(2, numberOr(args.R, 4))),
    Math.min(32, Math.max(2, numberOr(args.G, 4))), Math.min(32, Math.max(2, numberOr(args.B, 4))),
    numberOr(args.SPREAD, 0.5), Math.max(1, numberOr(args.SCALE, 1)), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.halftone = function (args) {
    this._safe((engine) => engine.halftone(numberOr(args.SIZE, 4), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.ascii = function (args) {
    this._safe((engine) => engine.ascii(Math.max(2, numberOr(args.X, 6)), Math.max(2, numberOr(args.Y, 8)),
    color(args.FG), color(args.BG), boolean(args.INVERT), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.crt = function (args) {
    this._safe((engine) => engine.crt(Math.max(1, numberOr(args.CURVATURE, 10)), Math.max(0.001, numberOr(args.BORDER, 0.08)),
    Math.max(1, numberOr(args.SIZE, 2)), Math.min(1, Math.max(0, numberOr(args.STRENGTH, 0.35))),
    mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.framing = function (args) {
    this._safe((engine) => engine.framing(String(args.SHAPE) === 'circle' ? 'circle' : 'rectangle',
    numberOr(args.RADIUS, 0.45), numberOr(args.SOFTNESS, 0.02), color(args.COLOR),
    Math.min(1, Math.max(0, numberOr(args.OPACITY, 100) / 100)), number(args.X), number(args.Y),
    mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
