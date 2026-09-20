/* eslint-disable */

// Consumed synchronously by Engine._render via gl.uniform2fv and never
// retained, so a single reusable buffer is safe to fill per call.
const CENTER_SCRATCH = [0, 0];

const install = ({ Engine }) => {
  Engine.prototype.lensDistortion = function (value, centerX, centerY, zoom, mixValue, blendMode) {
    CENTER_SCRATCH[0] = centerX;
    CENTER_SCRATCH[1] = centerY;
    this._singlePass(this._program('lensDistortion'), {
      u_resolution: this.resolution,
      u_center: CENTER_SCRATCH,
      u_value: Math.min(2, Math.max(-2, value / 100)),
      u_zoom: Math.max(0.01, zoom / 100),
      u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
