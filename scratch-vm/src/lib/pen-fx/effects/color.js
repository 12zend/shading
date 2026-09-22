/* eslint-disable */

import { color, mixAmount, number, numberOr } from '../helpers';

// Shared default vec3 uniforms and the integer-uniform list are read-only as
// far as Engine._render is concerned (values are copied via gl.uniform*fv /
// matched via indexOf), so every call can reference the same instances
// instead of allocating fresh ones per rendered frame.

const install = ({ PenFX }) => {
  PenFX.prototype.applyLUT = function (args) {
    const entry = this.luts.find(args.LUT);
    if (!entry) return;
    const amount = mixAmount(args.MIX);
    this._safe(engine => engine.lut(entry, amount, this.blendMode));
  };


  const invokeColor = (mode, values) => function (args) {
    const uniforms = values(args);
    this._safe((engine) => engine.color(mode, uniforms, this.blendMode));
  };
  PenFX.prototype.contrast = invokeColor(0, (args) => ({
    value: number(args.VALUE), pivot: numberOr(args.PIVOT, 0.5), mix: mixAmount(args.MIX)
  }));
  PenFX.prototype.brightness = invokeColor(1, (args) => ({
    color: color(args.COLOR), value: numberOr(args.VALUE, 1), mix: mixAmount(args.MIX)
  }));
  PenFX.prototype.gamma = invokeColor(2, (args) => ({ value: number(args.VALUE), mix: mixAmount(args.MIX) }));
  PenFX.prototype.saturation = invokeColor(3, (args) => ({ value: number(args.VALUE), mix: mixAmount(args.MIX) }));
  PenFX.prototype.colorAdjustment = invokeColor(4, (args) => ({
    add: color(args.ADD), mul: color(args.MUL), div: color(args.DIV), mix: mixAmount(args.MIX)
  }));
};

export default install;
