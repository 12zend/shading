/* eslint-disable */

import { FRACTAL_NOISE_TYPES, FRACTAL_OVERFLOW_TYPES, FRACTAL_TYPES } from '../constants';

const install = ({ Engine }) => {
  Engine.prototype.fractalNoise = function (fractalType, noiseType, invert, contrast, brightness, overflow, rotation, scale,
  width, height, offsetX, offsetY, perspective, depth, evolution, cycleEvolution, cycle, blendMode) {
    this._singlePass(this._program('fractalNoise'), {
      u_resolution: this.resolution,
      u_fractalType: Math.max(0, FRACTAL_TYPES.indexOf(fractalType)),
      u_noiseType: Math.max(0, FRACTAL_NOISE_TYPES.indexOf(noiseType)),
      u_invert: invert ? 1 : 0,
      u_contrast: contrast,
      u_brightness: brightness,
      u_overflow: Math.max(0, FRACTAL_OVERFLOW_TYPES.indexOf(overflow)),
      u_rotation: rotation,
      u_scale: scale,
      u_scaleDimensions: [width, height],
      u_offset: [offsetX, offsetY],
      u_perspective: perspective ? 1 : 0,
      u_depth: Math.min(10, Math.max(1, depth)),
      u_evolution: evolution,
      u_cycleEvolution: cycleEvolution ? 1 : 0,
      u_cycle: cycle
    }, ['u_fractalType', 'u_noiseType', 'u_invert', 'u_overflow', 'u_perspective', 'u_cycleEvolution'], blendMode);
  };

};

export default install;
