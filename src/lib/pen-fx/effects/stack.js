/* eslint-disable */

import {boolean, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.stackCurrent = function (weight, limit) {
        const gl = this.gl;
        const skin = this._prepare(false, false);
        if (!skin) return;
        const safeLimit = Math.min(120, Math.max(1, Math.floor(limit)));
        while (this.bufferStack.length > safeLimit) {
            const removed = this.bufferStack.shift();
            gl.deleteFramebuffer(removed.framebuffer);
            gl.deleteTexture(removed.texture);
        }
        const entry = this.bufferStack.length === safeLimit ?
            this.bufferStack.shift() : this._createBufferTexture();
        entry.weight = Math.max(0.0001, weight);
        this._render(this._program('copy'), entry.framebuffer, [{name: 'u_image', texture: skin._texture}], {}, []);
        this.bufferStack.push(entry);
        this._restoreGLState();
    };

    Engine.prototype.renderBufferStack = function (mode, clearAfter) {
        if (this.bufferStack.length === 0) return;
        const skin = this._prepare(false, false);
        if (!skin) return;
        if (this.bufferStack.length === 0) {
            this._restoreGLState();
            return;
        }
        const modeIndex = ['average', 'add', 'lighten', 'darken'].indexOf(mode);
        const firstEntry = this.bufferStack[0];
        let accumTexture = firstEntry.texture;
        let accumWeight = firstEntry.weight;
        let outputIndex = 1;
        let renderedDirectly = false;
        const target = skin._framebuffer.framebuffer || skin._framebuffer;
        if (modeIndex === 1 && firstEntry.weight !== 1) {
            let firstTarget = target;
            if (this.bufferStack.length !== 1) {
                this._ensureSecondaryBuffer();
                firstTarget = this.framebuffers[outputIndex];
            }
            this._render(this._program('stack'), firstTarget, [
                {name: 'u_accum', texture: firstEntry.texture},
                {name: 'u_sample', texture: firstEntry.texture}
            ], {
                u_mode: modeIndex,
                u_first: 1,
                u_accumWeight: 0,
                u_sampleWeight: firstEntry.weight
            }, ['u_mode', 'u_first']);
            if (this.bufferStack.length === 1) {
                this._markSkinChanged(skin);
                renderedDirectly = true;
            } else {
                accumTexture = this.textures[outputIndex];
                outputIndex = 1 - outputIndex;
            }
        }
        for (let i = 1; i < this.bufferStack.length; i++) {
            const entry = this.bufferStack[i];
            const isLast = i === this.bufferStack.length - 1;
            if (!isLast) this._ensureSecondaryBuffer();
            this._render(this._program('stack'), isLast ? target : this.framebuffers[outputIndex], [
                {name: 'u_accum', texture: accumTexture},
                {name: 'u_sample', texture: entry.texture}
            ], {
                u_mode: Math.max(0, modeIndex),
                u_first: 0,
                u_accumWeight: accumWeight,
                u_sampleWeight: entry.weight
            }, ['u_mode', 'u_first']);
            if (isLast) {
                this._markSkinChanged(skin);
                renderedDirectly = true;
            } else {
                accumTexture = this.textures[outputIndex];
                accumWeight += entry.weight;
                outputIndex = 1 - outputIndex;
            }
        }
        if (!renderedDirectly) this._replaceSkin(skin, accumTexture);
        if (clearAfter) this.clearBufferStack();
    };

    Engine.prototype.clearBufferStack = function () {
        const gl = this.gl;
        if (!this.bufferStack) return;
        for (const entry of this.bufferStack) {
            gl.deleteFramebuffer(entry.framebuffer);
            gl.deleteTexture(entry.texture);
        }
        this.bufferStack.length = 0;
    };

    Engine.prototype.bufferStackSize = function () {
        return this.bufferStack.length;
    };

    PenFX.prototype.stackCurrentDrawing = function (args) {
        this._safe(engine => engine.stackCurrent(numberOr(args.WEIGHT, 1), numberOr(args.LIMIT, 10)));
    };

    PenFX.prototype.renderBufferStack = function (args) {
        const mode = ['average', 'add', 'lighten', 'darken'].includes(String(args.MODE)) ? String(args.MODE) : 'average';
        this._safe(engine => engine.renderBufferStack(mode, boolean(args.CLEAR)));
    };

    PenFX.prototype.clearBufferStack = function () {
        if (!this.engine) return;
        this._safe(engine => engine.clearBufferStack());
    };

    PenFX.prototype.bufferStackSize = function () {
        return this.engine ? this.engine.bufferStackSize() : 0;
    };
};

export default install;
