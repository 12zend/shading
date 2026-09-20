/* eslint-disable */

import { evolutionAmount, mixAmount, numberOr, seedAmount } from '../helpers';

// Read-only downstream (_render only calls indexOf), safe to share across calls.

const install = ({ PenFX }) => {

  PenFX.prototype.vhs = function (args) {
    this._safe((engine) => engine.vhs(numberOr(args.TRACKING, 6), numberOr(args.CHROMA, 3),
    numberOr(args.NOISE, 12) / 100, numberOr(args.SCANLINES, 25) / 100,
    seedAmount(args.SEED), evolutionAmount(args.EVOLUTION), mixAmount(args.MIX), this.blendMode),
    { groupEffectScope: 'expanded' });
  };

  PenFX.prototype.glitch = function (args) {
    this._safe((engine) => engine.digitalGlitch(numberOr(args.SLICES, 24), numberOr(args.SHIFT, 28),
    numberOr(args.RGB, 6), numberOr(args.DENSITY, 35) / 100, seedAmount(args.SEED), evolutionAmount(args.EVOLUTION),
    mixAmount(args.MIX), this.blendMode),
    { groupEffectScope: 'expanded' });
  };
};

export default install;
