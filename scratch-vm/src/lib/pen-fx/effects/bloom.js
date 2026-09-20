/* eslint-disable */

import { boolean, color, number } from '../helpers';

const install = ({ PenFX }) => {

  PenFX.prototype.bloom = function (args) {
    this._safe((engine) => engine.bloom(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE),
    boolean(args.INVERT), color(args.COLOR || '#ffffff'), this.blendMode));
  };
};

export default install;
