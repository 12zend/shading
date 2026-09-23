/* eslint-disable */

const CAPTURE_SHADER = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_step;
  void main() {
    vec4 sum = vec4(0.0);
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        sum += texture2D(u_image, v_uv + (vec2(float(x), float(y)) - 1.5) * 0.25 * u_step);
      }
    }
    gl_FragColor = sum / 16.0;
  }
`;

const install = ({ Engine }) => {
  Engine.prototype.colorGrading = function (uniforms, mixValue, blendMode, time) {
    if (!uniforms || this._isNoOp(mixValue, blendMode)) return;
    this._singlePass(this._program('colorGrading'), Object.assign({}, uniforms, {
      u_mix: mixValue,
      u_resolution: this.resolution,
      u_time: Number(time) || 0
    }), [], blendMode);
  };

  // Reads a small premultiplied copy of the current effect input (the active group buffer, or the whole pen
  // layer outside a group). The Easy picker requests this only while it is open, so normal playback never
  // pays for the GPU readback.
  Engine.prototype.captureEffectInput = function (maxWidth = 320, maxHeight = 320) {
    const gl = this.gl;
    const skin = this._prepare(false, false);
    if (!skin) return null;
    const source = this._getGroupEffectSource(skin);
    const scale = Math.min(1, maxWidth / this.width, maxHeight / this.height);
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));
    let target = this.captureTarget;
    if (!target || target.width !== width || target.height !== height) {
      if (target) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      target = this.captureTarget = {framebuffer, height, texture, width};
    }
    if (!this.captureProgram) this.captureProgram = this._createProgram(CAPTURE_SHADER);
    const pixels = new Uint8Array(width * height * 4);
    try {
      this._render(this.captureProgram, target.framebuffer, [{name: 'u_image', texture: source}],
        {u_step: [1 / width, 1 / height]}, [], [width, height]);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      this._restoreGLState();
    }
    return {width, height, pixels};
  };
};

export default install;
