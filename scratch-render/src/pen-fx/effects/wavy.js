/* eslint-disable */

const WAVY_TYPES = ['both', 'x', 'y', 'size', 'dir'];

const install = ({ Engine }) => {
  Engine.prototype.wavy = function (value, seed, offsetX, offsetY, size, complexity, evolution, type, centerX, centerY,
  mixValue, blendMode) {
    if (this._isNoOp(mixValue, blendMode)) return;
    this._singlePass(this._program('wavy'), {
      u_resolution: this.resolution,
      u_value: value,
      u_seed: seed,
      u_offset: [offsetX, offsetY],
      u_center: [centerX, centerY],
      u_size: size,
      u_complexity: Math.min(8, Math.max(1, complexity)),
      u_evolution: evolution,
      u_type: Math.max(0, WAVY_TYPES.indexOf(type)),
      u_mix: mixValue
    }, ['u_type'], blendMode);
  };

};

export default install;
