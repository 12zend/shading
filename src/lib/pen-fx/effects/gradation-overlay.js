/* eslint-disable */

import {gradient, mixAmount, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.gradationOverlay = function (stops, direction, mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode) || !Array.isArray(stops) || !stops.length) return;
        const skin = this._prepare();
        if (!skin) return;

        const normalizedStops = stops.slice(0, 8);
        const lastStop = normalizedStops[normalizedStops.length - 1];
        const uniforms = {
            u_direction: direction,
            u_mix: mixValue,
            u_stopCount: normalizedStops.length
        };
        for (let index = 0; index < 8; index++) {
            const stop = normalizedStops[index] || lastStop;
            uniforms[`u_color${index}`] = stop.color;
            uniforms[`u_position${index}`] = stop.position;
        }
        this._renderEffect(skin, this._program('gradationOverlay'), [
            {name: 'u_image', texture: this.textures[0]}
        ], uniforms, ['u_stopCount'], blendMode);
    };

    PenFX.prototype.gradationOverlay = function (args) {
        this._safe(engine => engine.gradationOverlay(
            gradient(args.GRADIENT), numberOr(args.DIR, 90), mixAmount(args.MIX), this.blendMode
        ));
    };
};

export default install;
