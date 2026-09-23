/* eslint-disable */

import {findPreset} from 'scratch-render/src/pen-fx/color-grading/presets';
import {colorGradingUniforms} from 'scratch-render/src/pen-fx/color-grading/uniforms';
import {mixAmount} from '../helpers';

const PREVIEW_INTERVAL_MS = 250;
const MAX_CACHED_PREVIEWS = 24;
const uniformCache = new Map();

const uniformsFor = preset => {
  if (!uniformCache.has(preset.id)) uniformCache.set(preset.id, colorGradingUniforms(preset));
  return uniformCache.get(preset.id);
};

const currentBlockId = util => {
  const thread = util && util.thread;
  return thread && typeof thread.peekStack === 'function' ? thread.peekStack() || null : null;
};

const install = ({ PenFX, vm }) => {
  PenFX.prototype.easyColorGrading = function (args, util) {
    const preset = findPreset(args.PRESET);
    if (!preset) return;
    const uniforms = uniformsFor(preset);
    const mix = mixAmount(args.MIX);
    const blockId = currentBlockId(util);
    this._safe((engine) => {
      this._captureEasyPreview(engine, blockId);
      const timeline = vm.runtime.movieAssetManager && vm.runtime.movieAssetManager.timeline;
      engine.colorGrading(uniforms, mix, this.blendMode, Number(timeline && timeline.currentTime) || 0);
    }, {target: util && util.target});
  };

  // An Easy picker subscribes while it is open. Captures run inside the render transaction, when the effect's
  // input is current, and listeners are notified afterwards so the UI never runs inside the frame.
  PenFX.prototype.requestEasyPreview = function (blockId, listener) {
    const key = String(blockId || '');
    if (!this.easyPreviewListeners) this.easyPreviewListeners = new Map();
    if (!this.easyPreviewListeners.has(key)) this.easyPreviewListeners.set(key, new Set());
    const listeners = this.easyPreviewListeners.get(key);
    listeners.add(listener);
    const cached = this.easyPreviews && this.easyPreviews.get(key);
    if (cached) setTimeout(() => listeners.has(listener) && listener(cached), 0);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.easyPreviewListeners.delete(key);
    };
  };

  PenFX.prototype._hasEasyPreviewListener = function (blockId) {
    const listeners = blockId && this.easyPreviewListeners && this.easyPreviewListeners.get(blockId);
    return Boolean(listeners && listeners.size);
  };

  PenFX.prototype.captureCurrentPenLayer = function () {
    try {
      if (vm.runtime.renderer && typeof vm.runtime.renderer.getMovieBufferId === 'function') {
        vm.runtime.renderer.getMovieBufferId();
      }
      return this._getEngine().captureEffectInput();
    } catch (error) {
      console.error('[Pen FX]', error);
      return null;
    }
  };

  PenFX.prototype._captureEasyPreview = function (engine, blockId) {
    const listeners = blockId && this.easyPreviewListeners && this.easyPreviewListeners.get(blockId);
    if (!listeners || !listeners.size || typeof engine.captureEffectInput !== 'function') return;
    const now = Date.now();
    if (!this.easyPreviewTimes) this.easyPreviewTimes = new Map();
    if (now - (this.easyPreviewTimes.get(blockId) || 0) < PREVIEW_INTERVAL_MS) return;
    this.easyPreviewTimes.set(blockId, now);
    let snapshot = null;
    try {
      snapshot = engine.captureEffectInput();
    } catch (error) {
      console.error('[Pen FX]', error);
    }
    if (!snapshot) return;
    if (!this.easyPreviews) this.easyPreviews = new Map();
    this.easyPreviews.delete(blockId);
    this.easyPreviews.set(blockId, snapshot);
    if (this.easyPreviews.size > MAX_CACHED_PREVIEWS) {
      this.easyPreviews.delete(this.easyPreviews.keys().next().value);
    }
    setTimeout(() => {
      for (const listener of Array.from(listeners)) listener(snapshot);
    }, 0);
  };
};

export default install;
