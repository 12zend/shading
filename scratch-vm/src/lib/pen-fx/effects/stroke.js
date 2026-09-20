/* eslint-disable */

import { color, numberOr } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.stroke = function (args) {
    this._safe((engine) => engine.stroke(color(args.COLOR || '#000000'), numberOr(args.WIDTH, 4), this.blendMode));
  };
};

export default install;
