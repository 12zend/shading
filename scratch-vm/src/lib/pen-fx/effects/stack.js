/* eslint-disable */

import { boolean, numberOr } from '../helpers';

// Shared lookup tables. Treated as read-only by consumers (_render only reads
// samplers/integerUniforms), so every invocation can reference the same
// instances instead of allocating fresh literals per block execution.
const STACK_MODES = ['average', 'add', 'lighten', 'darken'];

const install = ({ PenFX }) => {

  PenFX.prototype.stackCurrentDrawing = function (args) {
    this._safe((engine) => engine.stackCurrent(numberOr(args.WEIGHT, 1), numberOr(args.LIMIT, 10)));
  };

  PenFX.prototype.renderBufferStack = function (args) {
    const rawMode = String(args.MODE);
    const mode = STACK_MODES.includes(rawMode) ? rawMode : 'average';
    this._safe((engine) => engine.renderBufferStack(mode, boolean(args.CLEAR)));
  };

  PenFX.prototype.clearBufferStack = function () {
    if (!this.engine) return;
    this._safe((engine) => engine.clearBufferStack());
  };

  PenFX.prototype.bufferStackSize = function () {
    return this.engine ? this.engine.bufferStackSize() : 0;
  };
};

export default install;
