/* eslint-disable */

import { evolutionAmount, mixAmount, number, numberOr, seedAmount } from '../helpers';

const WAVY_TYPES = ['both', 'x', 'y', 'size', 'dir'];

const install = ({ PenFX }) => {

  PenFX.prototype.wavy = function (args) {
    const rawType = String(args.TYPE);
    const type = WAVY_TYPES.includes(rawType) ? rawType : 'both';
    this._safe((engine) => engine.wavy(number(args.VALUE), seedAmount(args.SEED), number(args.X), number(args.Y),
    number(args.SIZE), numberOr(args.COMPLEXITY, 3), evolutionAmount(args.EVOLUTION), type,
    number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
  };
};

export default install;
