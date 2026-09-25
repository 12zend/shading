import createPenFXEngine from 'scratch-render/src/pen-fx/engine';

// Renders effect thumbnails with the real PenFX blocks on a private WebGL 2 context. The caller queues blocks
// through the live PenFX instance while its effect capture is open, so every block keeps the program overrides and
// argument handling it has on the stage, and the captured effects then run against a sandbox engine whose only
// surface is the preview image. The stage renderer's context and pen layer are never touched.

const PREVIEW_BUFFER_ID = 'effect-preview';
const PREVIEW_CONTEXT = Object.freeze({resources: Object.freeze({depth: null}), targetId: null});

class EffectPreviewRenderer {
    constructor (penFX) {
        this.penFX = penFX;
        this.canvas = document.createElement('canvas');
        const options = {alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false};
        const gl = this.canvas.getContext('webgl2', options);
        if (!gl) throw new Error('WebGL 2 is not available for effect previews.');
        this.gl = gl;
        this.surface = {_texture: null, _framebuffer: null, _size: [0, 0], _silhouetteDirty: false};
        const PreviewEngine = createPenFXEngine(gl, {
            dirty: false,
            _allSkins: {[PREVIEW_BUFFER_ID]: this.surface},
            getMovieBufferId: () => PREVIEW_BUFFER_ID
        });
        this.engine = new PreviewEngine();
        this.sourceTexture = null;
        this.snapshot = null;
    }

    _createTexture (width, height, pixels = null) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return texture;
    }

    _releaseTextures () {
        const gl = this.gl;
        if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
        if (this.surface._texture) gl.deleteTexture(this.surface._texture);
        if (this.surface._framebuffer) gl.deleteFramebuffer(this.surface._framebuffer.framebuffer);
        this.sourceTexture = null;
        this.surface._texture = null;
        this.surface._framebuffer = null;
    }

    setSnapshot (snapshot) {
        if (this.snapshot === snapshot) return;
        const gl = this.gl;
        const {width, height} = snapshot;
        this.snapshot = snapshot;
        this.canvas.width = width;
        this.canvas.height = height;
        if (this.surface._size[0] !== width || this.surface._size[1] !== height || !this.surface._texture) {
            this._releaseTextures();
            this.surface._texture = this._createTexture(width, height);
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.surface._texture, 0);
            this.surface._framebuffer = {framebuffer};
            this.surface._size = [width, height];
            this.sourceTexture = this._createTexture(width, height, snapshot.pixels);
        } else {
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, snapshot.pixels);
        }
        // Imported shader packages can change between pickers; registration is lazy, so refreshing is cheap.
        if (this.penFX.customShaders) this.penFX.customShaders.installIntoEngine(this.engine);
    }

    _copy (texture, framebuffer) {
        const engine = this.engine;
        engine.withProgramOverrides(null, () => engine._render(engine._program('copy'), framebuffer,
            [{name: 'u_image', texture}], {}, [], this.surface._size));
    }

    // Runs `queue(penFX)` (which calls PenFX block methods) on the snapshot and draws the result into the target
    // canvas. A null queue draws the input. Returns false when an effect failed; the thumbnail then shows whatever
    // the other effects produced.
    draw (queue, targetCanvas) {
        if (!this.snapshot) return false;
        const gl = this.gl;
        const engine = this.engine;
        const penFX = this.penFX;
        let ok = true;
        this._copy(this.sourceTexture, this.surface._framebuffer.framebuffer);
        let effects = [];
        const previousBlendMode = penFX.blendMode;
        const previousBlendOpacity = penFX.blendOpacity;
        try {
            // The preview ignores the project's current blend mode; steps that set their own still keep it.
            penFX.blendMode = 'normal';
            penFX.blendOpacity = 1;
            if (queue) {
                penFX.beginEffectCapture();
                try {
                    queue(penFX);
                } finally {
                    effects = penFX.endEffectCapture();
                }
            }
            for (const effect of effects) {
                // Callbacks read the live blend state when they run, as they do in PenFX's own executor.
                penFX.blendMode = effect.blendMode;
                penFX.blendOpacity = effect.blendOpacity;
                engine.blendOpacity = effect.blendOpacity;
                engine.groupEffectScope = null;
                try {
                    effect.callback(engine, PREVIEW_CONTEXT);
                } catch (error) {
                    ok = false;
                } finally {
                    engine._restoreGLState();
                }
            }
        } finally {
            penFX.blendMode = previousBlendMode;
            penFX.blendOpacity = previousBlendOpacity;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._copy(this.surface._texture, null);
        engine._restoreGLState();
        if (gl.getError() !== gl.NO_ERROR) ok = false;
        if (targetCanvas.width !== this.canvas.width || targetCanvas.height !== this.canvas.height) {
            targetCanvas.width = this.canvas.width;
            targetCanvas.height = this.canvas.height;
        }
        const context = targetCanvas.getContext('2d');
        context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        // Snapshot rows are top-down but WebGL presents row 0 at the bottom, so flip back to stage orientation.
        context.save();
        context.translate(0, targetCanvas.height);
        context.scale(1, -1);
        context.drawImage(this.canvas, 0, 0);
        context.restore();
        return ok;
    }

    dispose () {
        this._releaseTextures();
        if (typeof this.engine.dispose === 'function') this.engine.dispose();
        const lose = this.gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
    }
}

export {EffectPreviewRenderer};
