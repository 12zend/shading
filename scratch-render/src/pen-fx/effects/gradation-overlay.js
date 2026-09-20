/* eslint-disable */

const COLOR_KEYS = ['u_color0', 'u_color1', 'u_color2', 'u_color3', 'u_color4', 'u_color5', 'u_color6', 'u_color7'];
const POSITION_KEYS = ['u_position0', 'u_position1', 'u_position2', 'u_position3', 'u_position4', 'u_position5', 'u_position6', 'u_position7'];
const INTEGER_UNIFORMS = ['u_stopCount'];

const install = ({ Engine }) => {
  Engine.prototype.gradationOverlay = function (stops, direction, mixValue, blendMode) {
    if (this._isNoOp(mixValue, blendMode) || !Array.isArray(stops) || !stops.length) return;

    const stopCount = Math.min(8, stops.length);
    const lastStop = stops[stopCount - 1];
    const uniforms = {
      u_direction: direction,
      u_mix: mixValue,
      u_stopCount: stopCount
    };
    for (let index = 0; index < 8; index++) {
      const stop = stops[index] || lastStop;
      uniforms[COLOR_KEYS[index]] = stop.color;
      uniforms[POSITION_KEYS[index]] = stop.position;
    }
    this._singlePass(this._program('gradationOverlay'),
    uniforms, INTEGER_UNIFORMS, blendMode);
  };

};

export default install;
