/* eslint-disable */

import {color, mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.color = function (mode, uniforms, blendMode) {
        if (this._isNoOp(uniforms.mix === undefined ? 1 : uniforms.mix, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        this._renderEffect(skin, this._program('color'), [{name: 'u_image', texture: this.textures[0]}], {
            u_mode: mode,
            u_value: uniforms.value === undefined ? 1 : uniforms.value,
            u_mix: uniforms.mix === undefined ? 1 : uniforms.mix,
            u_pivot: uniforms.pivot === undefined ? 0.5 : uniforms.pivot,
            u_color: uniforms.color || [0, 0, 0],
            u_add: uniforms.add || [0, 0, 0],
            u_mul: uniforms.mul || [1, 1, 1],
            u_div: uniforms.div || [1, 1, 1]
        }, ['u_mode'], blendMode);
    };

    const invokeColor = (mode, values) => function (args) {
        const uniforms = values(args);
        this._safe(engine => engine.color(mode, uniforms, this.blendMode));
    };
    PenFX.prototype.contrast = invokeColor(0, args => ({
        value: number(args.VALUE), pivot: numberOr(args.PIVOT, 0.5), mix: mixAmount(args.MIX)
    }));
    PenFX.prototype.brightness = invokeColor(1, args => ({
        color: color(args.COLOR), value: numberOr(args.VALUE, 1), mix: mixAmount(args.MIX)
    }));
    PenFX.prototype.gamma = invokeColor(2, args => ({value: number(args.VALUE), mix: mixAmount(args.MIX)}));
    PenFX.prototype.saturation = invokeColor(3, args => ({value: number(args.VALUE), mix: mixAmount(args.MIX)}));
    PenFX.prototype.colorAdjustment = invokeColor(4, args => ({
        add: color(args.ADD), mul: color(args.MUL), div: color(args.DIV), mix: mixAmount(args.MIX)
    }));
};

export default install;
