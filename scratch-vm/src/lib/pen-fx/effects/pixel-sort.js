/* eslint-disable */

import { boolean, mixAmount, number, numberOr } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.pixelSort = function (args) {
    const type = ['x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'x';
    const sortBy = ['luminance', 'saturation', 'hue'].includes(String(args.SORTBY)) ? String(args.SORTBY) : 'luminance';
    this._safe((engine) => engine.pixelSort(type, numberOr(args.SPAN, numberOr(args.VALUE, 64)), boolean(args.INVERT),
    Math.min(1, Math.max(0, numberOr(args.MIN, 0))), Math.min(1, Math.max(0, numberOr(args.MAX, 1))),
    sortBy, boolean(args.REVERSE), Math.max(0.01, numberOr(args.GAMMA, 1)), number(args.CENTERX),
    number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
