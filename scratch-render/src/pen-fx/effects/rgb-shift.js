/* eslint-disable */

const install = ({ Engine }) => {
  Engine.prototype.rgbShift = function (direction, value, pair, mixValue, blendMode) {
    if (this._isNoOp(mixValue, blendMode)) return;
    this._singlePass(this._program('rgbShift'), {
      u_resolution: this.resolution,
      u_direction: direction,
      u_value: value,
      u_pair: pair,
      u_mix: mixValue
    }, ['u_pair'], blendMode);
  };

};

export default install;
