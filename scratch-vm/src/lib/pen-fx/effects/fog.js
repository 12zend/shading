/* eslint-disable */

import { color, depthResource, mixAmount, numberOr } from '../helpers';

const FOG_TYPES = ['linear', 'smooth', 'exponential', 'exponential squared'];

const install = ({ PenFX }) => {

  PenFX.prototype.fog = function (args, util) {
    const typeKey = String(args.TYPE);
    const type = FOG_TYPES.includes(typeKey) ? typeKey : 'linear';
    this._safe((engine, renderContext) => engine.fog(depthResource(renderContext), type, numberOr(args.START, 100),
    numberOr(args.END, 1000), numberOr(args.DENSITY, 100) / 100, numberOr(args.CURVE, 1),
    color(args.NEARCOLOR || '#d9e7f2'), color(args.FARCOLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode), {
      target: util && util.target
    });
  };
};

export default install;
