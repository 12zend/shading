/* eslint-disable */

// Shared default vec3 uniforms and the integer-uniform list are read-only as
// far as Engine._render is concerned (values are copied via gl.uniform*fv /
// matched via indexOf), so every call can reference the same instances
// instead of allocating fresh ones per rendered frame.
const VEC3_ZERO = [0, 0, 0];
const VEC3_ONE = [1, 1, 1];
const COLOR_INTEGER_UNIFORMS = ['u_mode'];

const install = ({ Engine }) => {
  Engine.prototype.lut = function (entry, amount, blendMode) {
    if (!entry || !entry.gpu || this._isNoOp(amount, blendMode)) return;
    const skin = this._prepare();
    if (!skin) return;
    this._renderEffect(skin, this._program('lut'), [
      {name: 'u_image', texture: this.textures[0]},
      {name: 'u_lut', texture: entry.gpu.texture}
    ], {
      u_lutResolution: [entry.gpu.width, entry.gpu.height],
      u_size: entry.size,
      u_columns: entry.gpu.columns,
      u_mix: amount
    }, [], blendMode);
  };

  Engine.prototype.color = function (mode, uniforms, blendMode) {
    const mix = uniforms.mix === undefined ? 1 : uniforms.mix;
    if (this._isNoOp(mix, blendMode)) return;
    this._singlePass(this._program('color'), {
      u_mode: mode,
      u_value: uniforms.value === undefined ? 1 : uniforms.value,
      u_mix: mix,
      u_pivot: uniforms.pivot === undefined ? 0.5 : uniforms.pivot,
      u_color: uniforms.color || VEC3_ZERO,
      u_add: uniforms.add || VEC3_ZERO,
      u_mul: uniforms.mul || VEC3_ONE,
      u_div: uniforms.div || VEC3_ONE
    }, COLOR_INTEGER_UNIFORMS, blendMode);
  };

};

export default install;
