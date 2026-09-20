/* eslint-disable */

import { boolean, color, number, numberOr } from '../helpers';

const BLOB_MODES = ['alpha', 'bright', 'color', 'dark', 'motion'];

const install = ({ PenFX }) => {

  PenFX.prototype.blob = function (args) {
    const modeArg = String(args.MODE);
    const mode = BLOB_MODES.includes(modeArg) ? modeArg : 'dark';
    const shape = String(args.SHAPE) === 'ellipse' ? 'ellipse' : 'rectangle';
    this._safe((engine) => engine.blob({
      blurRadius: Math.max(0, number(args.BLUR)),
      color: color(args.COLOR || '#00ffff'),
      fillOpacity: Math.min(1, Math.max(0, number(args.FILL) / 100)),
      marker: boolean(args.MARKER),
      maximumSize: Math.min(100, Math.max(0, numberOr(args.MAX, 100))),
      minimumSize: Math.min(100, Math.max(0, number(args.MIN))),
      mode,
      shape,
      strokeOpacity: Math.min(1, Math.max(0, numberOr(args.OPACITY, 100) / 100)),
      strokeWidth: Math.max(1, numberOr(args.WIDTH, 2)),
      targetColor: color(args.KEY || '#ffffff'),
      threshold: Math.min(255, Math.max(0, numberOr(args.THRESHOLD, 50)))
    }, this.blendMode));
  };
};

export default install;
