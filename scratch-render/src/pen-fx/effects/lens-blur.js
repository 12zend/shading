/* eslint-disable */

import lensBlurSource, {lensBlurKernel} from '../shaders/lens-blur';

const install = ({ Engine }) => {
  Engine.prototype.lensBlur = function (radius, shape, rotation, mixValue, blendMode) {
    const blades = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : 0;
    const safeRadius = Math.min(256, Math.max(0, Math.abs(radius)));
    const key = this.programOverrides && this.programOverrides.lensBlur || 'lensBlur';
    const source = this.programSources[key];
    const gl = this.gl;
    if (this.lensKernelSupported === undefined) {
      this.lensKernelSupported = typeof gl.getParameter === 'function' &&
        gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) >= 40;
    }
    if (this.lensKernelSupported && source.trim() === lensBlurSource.trim()) {
      if (!this.lensKernelProgram) this.lensKernelProgram = this._createProgram(lensBlurKernel);
      const samples = this.lensSamples || (this.lensSamples = new Float32Array(96));
      const rotationRad = rotation * Math.PI / 180;
      const bladesSafe = Math.max(blades, 3);
      const sector = 6.28318530718 / bladesSafe;
      const halfSector = sector * 0.5;
      const polyCos = Math.cos(3.14159265359 / bladesSafe);
      for (let i = 0; i < 32; i++) {
        const fi = i + 0.5;
        const angle = fi * 2.39996322973;
        const delta = angle - rotationRad + halfSector;
        const localAngle = delta - sector * Math.floor(delta / sector) - halfSector;
        const shape = blades >= 3 ? polyCos / Math.max(Math.cos(localAngle), 0.001) : 1;
        const normRadius = Math.sqrt(fi * 0.03125) * shape;
        samples[i * 3] = Math.cos(angle) * normRadius * safeRadius;
        samples[i * 3 + 1] = Math.sin(angle) * normRadius * safeRadius;
        samples[i * 3 + 2] = 1 + normRadius * 0.35;
      }
      this._singlePass(this.lensKernelProgram, {
        u_resolution: this.resolution, u_radius: safeRadius, u_mix: mixValue,
        u_lensSamples: samples
      }, [], blendMode);
      return;
    }
    this._singlePass(this._program('lensBlur'), {
      u_resolution: this.resolution,
      u_radius: Math.min(256, Math.max(0, Math.abs(radius))),
      u_blades: blades,
      u_rotation: rotation,
      u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
