/* eslint-disable */

const INTEGER_UNIFORMS = ['u_mode', 'u_type'];

const install = ({ Engine }) => {
  Engine.prototype.geometry = function (mode, type, uniforms, blendMode) {
    const value = uniforms.value;
    const radius = uniforms.radius;
    const center = uniforms.center;
    const offset = uniforms.offset;
    const anchor = uniforms.anchor;
    const blockSize = uniforms.blockSize;
    const size = uniforms.size;
    const direction = uniforms.direction;
    const width = uniforms.width;
    const frequency = uniforms.frequency;
    const mix = uniforms.mix;
    this._singlePass(this._program('geometry'), {
      u_resolution: this.resolution,
      u_mode: mode,
      u_type: type,
      u_value: value === undefined ? 0 : value,
      u_radius: radius === undefined ? 0 : radius,
      u_center: center || [0, 0],
      u_offset: offset || [0, 0],
      u_anchor: anchor || [0, 0],
      u_blockSize: blockSize || [1, 1],
      u_size: size === undefined ? 100 : size,
      u_direction: direction === undefined ? 0 : direction,
      u_width: width === undefined ? 6 : width,
      u_frequency: frequency === undefined ? 0.55 : frequency,
      u_mix: mix === undefined ? 1 : mix
    }, INTEGER_UNIFORMS, blendMode);
  };

};

export default install;
