/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.sharpen = function (args) {
    this._safe((engine) => engine.sharpen(number(args.VALUE), numberOr(args.RADIUS, 1), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
