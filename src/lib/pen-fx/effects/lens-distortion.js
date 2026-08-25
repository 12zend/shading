/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.lensDistortion = function (value, centerX, centerY, zoom, mixValue, blendMode) {
        this._singlePass(this._program('lensDistortion'), {
            u_resolution: this.resolution,
            u_center: [centerX, centerY],
            u_value: Math.min(2, Math.max(-2, value / 100)),
            u_zoom: Math.max(0.01, zoom / 100),
            u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.lensDistortion = function (args) {
        this._safe(engine => engine.lensDistortion(number(args.VALUE), number(args.X), number(args.Y),
            numberOr(args.ZOOM, 100), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
