/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.lensBlur = function (args) {
    const shapeName = String(args.SHAPE);
    const shape = shapeName === 'hexagon' || shapeName === 'octagon' ? shapeName : 'circle';
    this._safe((engine) => engine.lensBlur(number(args.RADIUS), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
