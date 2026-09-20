/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

const TYPES = ['x', 'y', 'size', 'dir'];

const install = ({ PenFX }) => {

  PenFX.prototype.pixelStretch = function (args) {
    const rawType = String(args.TYPE);
    const type = TYPES.includes(rawType) ? rawType : 'x';
    this._safe((engine) => engine.pixelStretch(type, number(args.POSITION), number(args.SIZE),
    numberOr(args.SAMPLE, 1), number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
