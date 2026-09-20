/* eslint-disable */

import { color, mixAmount } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.colorOverlay = function (args) {
    this._safe((engine) => engine.colorOverlay(color(args.COLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
