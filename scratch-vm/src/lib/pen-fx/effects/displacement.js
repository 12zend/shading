/* eslint-disable */

import { boolean, mixAmount, number, numberOr } from '../helpers';

const TYPE_NAMES = ['x', 'y', 'size', 'dir'];
const CHANNEL_NAMES = ['luminance', 'r', 'g', 'b', 'a'];

const install = ({ PenFX }) => {

  PenFX.prototype.displacementMap = function (args, util) {
    const typeKey = String(args.TYPE);
    const channelKey = String(args.CHANNEL);
    const type = TYPE_NAMES.includes(typeKey) ? typeKey : 'x';
    const channel = CHANNEL_NAMES.includes(channelKey) ? channelKey : 'luminance';
    this._safe((engine) => engine.displacement(args.COSTUME, number(args.VALUE), type, channel,
    boolean(args.INVERT), numberOr(args.CENTER, 0.5), mixAmount(args.MIX), util.target, this.blendMode));
  };
};

export default install;
