/* eslint-disable */

const SAMPLE_MODES = ['clamp', 'mirror', 'wrap', 'border'];

const install = ({ Engine }) => {
  Engine.prototype.edgeDetection = function (threshold, value, radius, softness, edgeColor, backgroundColor, hasBackground,
  alpha, mixValue, blendMode) {
    const normalizedThreshold = threshold > 1 ? threshold / 100 : threshold;
    const normalizedSoftness = softness > 1 ? softness / 100 : softness;
    this._acerolaPass(this._program('acerolaSpatial'), 0, {
      u_value: Math.min(4, Math.max(0, normalizedThreshold / Math.max(value, 0.0001))),
      u_value2: Math.min(8, Math.max(1, Math.abs(radius))),
      u_value3: Math.max(0.0001, normalizedSoftness),
      u_vec: [Math.min(1, Math.max(0, alpha)), hasBackground ? 1 : 0],
      u_color: edgeColor,
      u_color2: backgroundColor,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.fxaa = function (contrastThreshold, relativeThreshold, subpixel, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaSpatial'), 1, {
      u_value: contrastThreshold,
      u_value2: relativeThreshold,
      u_value3: subpixel,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.chromaticAberration = function (intensity, radius, hardness, offsetX, offsetY, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaSpatial'), 2, {
      u_value: intensity / 100,
      u_value2: radius,
      u_value3: hardness,
      u_vec: [offsetX, offsetY],
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.differenceOfGaussians = function (sigma, sigmaScale, tau, threshold, colored, inkColor, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaSpatial'), 3, {
      u_type: colored ? 1 : 0,
      u_value: Math.max(0.1, sigma),
      u_value2: Math.max(0.1, sigma * sigmaScale),
      u_value3: tau,
      u_vec: [Math.max(0.0001, threshold), 0],
      u_color: inkColor,
      u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.kuwahara = function (radius, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaSpatial'), 4, {
      u_value: Math.min(12, Math.max(1, radius)), u_mix: mixValue
    }, [], blendMode);
  };

  Engine.prototype.zoom = function (value, offsetX, offsetY, sampleMode, mixValue, blendMode) {
    this._acerolaPass(this._program('acerolaSpatial'), 5, {
      u_type: Math.max(0, SAMPLE_MODES.indexOf(sampleMode)),
      u_value: Math.max(0.001, value),
      u_vec: [offsetX, offsetY],
      u_mix: mixValue
    }, [], blendMode);
  };

};

export default install;
