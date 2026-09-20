/* eslint-disable */

import { mixAmount, number, numberOr } from '../helpers';

const MIRROR_TYPES = ['x', 'y', 'xy'];

const install = ({ PenFX }) => {

  PenFX.prototype.pulse = function (args) {
    this._safe((engine) => {
      const radius = number(args.RADIUS);
      return engine.geometry(0, 0, {
        center: [number(args.X), number(args.Y)],
        radius,
        value: number(args.VALUE),
        width: numberOr(args.WIDTH, Math.max(Math.abs(radius) * 0.22, 6)),
        frequency: numberOr(args.FREQUENCY, 0.55),
        mix: mixAmount(args.MIX)
      }, this.blendMode);
    });
  };

  PenFX.prototype.pixelate = function (args) {
    const oldSize = numberOr(args.SIZE, 8);
    this._safe((engine) => engine.geometry(1, 0, {
      blockSize: [numberOr(args.X, oldSize), numberOr(args.Y, oldSize)],
      offset: [numberOr(args.OFFSETX, 0), numberOr(args.OFFSETY, 0)],
      mix: mixAmount(args.MIX)
    }, this.blendMode));
  };

  PenFX.prototype.mirror = function (args) {
    const type = MIRROR_TYPES.indexOf(String(args.TYPE));
    this._safe((engine) => engine.geometry(2, Math.max(0, type), {
      center: [numberOr(args.X, 0), numberOr(args.Y, 0)], mix: mixAmount(args.MIX)
    }, this.blendMode));
  };

  PenFX.prototype.transform = function (args) {
    this._safe((engine) => engine.geometry(3, 0, {
      offset: [number(args.X), number(args.Y)],
      size: number(args.SIZE),
      direction: number(args.DIR),
      anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
      mix: mixAmount(args.MIX)
    }, this.blendMode));
  };

  PenFX.prototype.duplicate = function (args) {
    this._safe((engine) => engine.geometry(4, 0, {
      offset: [number(args.X), number(args.Y)],
      size: numberOr(args.SIZE, 50),
      direction: number(args.DIR),
      anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
      mix: mixAmount(args.MIX)
    }, this.blendMode));
  };
};

export default install;
