/* eslint-disable */

const TYPES = ['x', 'y', 'size', 'dir'];

const install = ({ Engine }) => {
  Engine.prototype.pixelStretch = function (type, position, size, sampleSize, centerX, centerY, mixValue, blendMode) {
    this._singlePass(this._program('pixelStretch'), {
      u_resolution: this.resolution,
      u_type: Math.max(0, TYPES.indexOf(type)),
      u_position: position,
      u_size: Math.max(0, Math.abs(size)),
      u_sampleSize: Math.min(9, Math.max(1, Math.abs(sampleSize))),
      u_center: [centerX, centerY],
      u_mix: mixValue
    }, ['u_type'], blendMode);
  };

};

export default install;
