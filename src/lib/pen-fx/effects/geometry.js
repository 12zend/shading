/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.geometry = function (mode, type, uniforms, blendMode) {
        this._singlePass(this._program('geometry'), {
            u_resolution: this.resolution,
            u_mode: mode,
            u_type: type,
            u_value: uniforms.value === undefined ? 0 : uniforms.value,
            u_radius: uniforms.radius === undefined ? 0 : uniforms.radius,
            u_center: uniforms.center || [0, 0],
            u_offset: uniforms.offset || [0, 0],
            u_anchor: uniforms.anchor || [0, 0],
            u_blockSize: uniforms.blockSize || [1, 1],
            u_size: uniforms.size === undefined ? 100 : uniforms.size,
            u_direction: uniforms.direction === undefined ? 0 : uniforms.direction,
            u_width: uniforms.width === undefined ? 6 : uniforms.width,
            u_frequency: uniforms.frequency === undefined ? 0.55 : uniforms.frequency,
            u_mix: uniforms.mix === undefined ? 1 : uniforms.mix
        }, ['u_mode', 'u_type'], blendMode);
    };

    PenFX.prototype.pulse = function (args) {
        this._safe(engine => engine.geometry(0, 0, {
            center: [number(args.X), number(args.Y)],
            radius: number(args.RADIUS),
            value: number(args.VALUE),
            width: numberOr(args.WIDTH, Math.max(Math.abs(number(args.RADIUS)) * 0.22, 6)),
            frequency: numberOr(args.FREQUENCY, 0.55),
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.pixelate = function (args) {
        const oldSize = numberOr(args.SIZE, 8);
        this._safe(engine => engine.geometry(1, 0, {
            blockSize: [numberOr(args.X, oldSize), numberOr(args.Y, oldSize)],
            offset: [numberOr(args.OFFSETX, 0), numberOr(args.OFFSETY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.mirror = function (args) {
        const type = ['x', 'y', 'xy'].indexOf(String(args.TYPE));
        this._safe(engine => engine.geometry(2, Math.max(0, type), {
            center: [numberOr(args.X, 0), numberOr(args.Y, 0)], mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.transform = function (args) {
        this._safe(engine => engine.geometry(3, 0, {
            offset: [number(args.X), number(args.Y)],
            size: number(args.SIZE),
            direction: number(args.DIR),
            anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.duplicate = function (args) {
        this._safe(engine => engine.geometry(4, 0, {
            offset: [number(args.X), number(args.Y)],
            size: numberOr(args.SIZE, 50),
            direction: number(args.DIR),
            anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };
};

export default install;
