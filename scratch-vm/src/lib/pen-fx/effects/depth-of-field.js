/* eslint-disable */

import { depthResource, mixAmount, numberOr } from '../helpers';

const SHAPES = ['circle', 'hexagon', 'octagon'];

const install = ({ PenFX }) => {

  PenFX.prototype.depthOfField = function (args, util) {
    const shapeName = String(args.SHAPE);
    const shape = SHAPES.includes(shapeName) ? shapeName : 'circle';
    this._safe((engine, renderContext) => engine.depthOfField(depthResource(renderContext),
    numberOr(args.FOCUS, 480), numberOr(args.RANGE, 24), numberOr(args.APERTURE, 48),
    numberOr(args.MAXBLUR, 24), numberOr(args.NEAR, 100) / 100, numberOr(args.FAR, 100) / 100,
    numberOr(args.EDGE, 8), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode), {
      target: util && util.target
    });
  };
};

export default install;
