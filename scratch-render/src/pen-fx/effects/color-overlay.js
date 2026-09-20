/* eslint-disable */

const install = ({ Engine }) => {
  Engine.prototype.colorOverlay = function (overlayColor, mixValue, blendMode) {
    if (this._isNoOp(mixValue, blendMode)) return;
    this._singlePass(this._program('colorOverlay'), {
      u_color: overlayColor,
      u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
