/* eslint-disable */

const install = ({ Engine }) => {
  Engine.prototype.stroke = function (strokeColor, width, blendMode) {
    const safeWidth = Math.min(64, Math.max(0, Math.abs(width)));
    if (safeWidth <= 0) return;
    this._singlePass(this._program('stroke'), {
      u_resolution: this.resolution,
      u_color: strokeColor,
      u_width: safeWidth
    }, [], blendMode);
  };

};

export default install;
