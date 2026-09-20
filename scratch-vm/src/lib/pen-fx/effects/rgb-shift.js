/* eslint-disable */

import { mixAmount, number } from '../helpers';

const RGB_PAIRS = ['RG', 'GB', 'BR'];

const install = ({ PenFX }) => {

  PenFX.prototype.rgbShift = function (args) {
    const pair = RGB_PAIRS.indexOf(String(args.COLOR).toUpperCase());
    this._safe((engine) => engine.rgbShift(number(args.DIR), number(args.VALUE), Math.max(0, pair), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
