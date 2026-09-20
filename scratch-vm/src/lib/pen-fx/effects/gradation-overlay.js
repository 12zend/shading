/* eslint-disable */

import { gradient, mixAmount, numberOr } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.gradationOverlay = function (args) {
    this._safe((engine) => engine.gradationOverlay(
      gradient(args.GRADIENT), numberOr(args.DIR, 90), mixAmount(args.MIX), this.blendMode
    ));
  };
};

export default install;
