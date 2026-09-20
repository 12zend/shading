/* eslint-disable */

import { color, number } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.deepGlow = function (args) {
    this._safe((engine) => engine.deepGlow(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE),
    color(args.COLOR || '#ffffff'), this.blendMode));
  };
};

export default install;
