/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

// Consumed synchronously by Engine._render via gl.uniform2fv and never
// retained, so a single reusable buffer is safe to fill per call.

const install = ({ PenFX }) => {

  PenFX.prototype.lensDistortion = function (args) {
    this._safe((engine) => engine.lensDistortion(number(args.VALUE), number(args.X), number(args.Y),
    numberOr(args.ZOOM, 100), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
