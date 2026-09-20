/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

const GAUSSIAN_TYPES = ['normal', 'horizontal', 'vertical'];

const install = ({ PenFX }) => {

  PenFX.prototype.gaussianBlur = function (args) {
    const rawType = String(args.TYPE);
    const type = GAUSSIAN_TYPES.includes(rawType) ? rawType : 'normal';
    this._safe((engine) => engine.gaussian(type, 0, number(args.VALUE), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.directionalBlur = function (args) {
    this._safe((engine) => engine.gaussian('directional', number(args.DIR), number(args.VALUE), mixAmount(args.MIX), this.blendMode));
  };

  PenFX.prototype.radialBlur = function (args) {
    const type = String(args.TYPE) === 'size' ? 'size' : 'dir';
    this._safe((engine) => engine.radial(type, number(args.VALUE), numberOr(args.X, 0), numberOr(args.Y, 0), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
