/* eslint-disable */

const install = ({ Engine }) => {
  Engine.prototype.sharpen = function (value, radius, mixValue, blendMode) {
    this._singlePass(this._program('sharpen'), {
      u_resolution: this.resolution,
      u_value: Math.min(8, Math.max(0, value)),
      u_radius: Math.min(8, Math.max(1, Math.abs(radius))),
      u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
