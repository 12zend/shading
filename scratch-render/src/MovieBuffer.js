const twgl = require('twgl.js');
const RenderConstants = require('./RenderConstants');
const Skin = require('./Skin');
const ShaderManager = require('./ShaderManager');

/** Persistent Movie surface. Group/frame transactions swap its current drawing attachment. */
class MovieBuffer extends Skin {
    /**
     * Create a Skin which implements a Movie drawing surface.
     * @param {int} id - The unique ID for this Skin.
     * @param {RenderWebGL} renderer - The renderer which will use this Skin.
     * @extends Skin
     * @listens RenderWebGL#event:NativeSizeChanged
     */
    constructor (id, renderer) {
        super(id, renderer);

        /** @type {Array<number>} */
        this._size = null;

        /** @type {WebGLFramebuffer} */
        this._framebuffer = null;

        /** @type {boolean} */
        this._silhouetteDirty = false;

        /** @type {Uint8Array} */
        this._silhouettePixels = null;

        /** @type {ImageData} */
        this._silhouetteImageData = null;

        /** @type {object} */
        this._useBufferDrawRegionId = {
            enter: () => this._enterUseBuffer(),
            exit: () => this._exitUseBuffer()
        };

        // Render quality attribute
        this.renderQuality = 1;

        // tw: keep track of native size
        this._nativeSize = renderer.getNativeSize();

        const NO_EFFECTS = 0;

        // Draw region used to preserve texture when resizing
        this._drawTextureShader = this._renderer._shaderManager.getShader(ShaderManager.DRAW_MODE.default, NO_EFFECTS);
        /** @type {object} */
        this._drawTextureRegionId = {
            enter: () => this._enterDrawTexture(),
            exit: () => this._exitDrawTexture()
        };

        this.onNativeSizeChanged = this.onNativeSizeChanged.bind(this);
        this._renderer.on(RenderConstants.Events.NativeSizeChanged, this.onNativeSizeChanged);

        this._setCanvasSize(renderer.getNativeSize());
    }

    /**
     * Dispose of this object. Do not use it after calling this method.
     */
    dispose () {
        this._renderer.removeListener(RenderConstants.Events.NativeSizeChanged, this.onNativeSizeChanged);
        this._renderer._doExitDrawRegion();
        this._renderer.gl.deleteFramebuffer(this._framebuffer.framebuffer);
        this._renderer.gl.deleteTexture(this._texture);
        this._texture = null;
        super.dispose();
    }

    /**
     * @return {Array<number>} the "native" size, in texels, of this skin. [width, height]
     */
    get size () {
        // tw: use native size for Drawable positioning logic
        return this._nativeSize;
    }

    useNearest (scale) {
        // Use nearest-neighbor interpolation when scaling up the drawing surface-- this matches Scratch 2.0.
        // When scaling it down, use linear interpolation to avoid giving edges a "dashed" appearance.
        return Math.max(scale[0], scale[1]) >= 100;
    }

    /**
     * @param {Array<number>} scale The X and Y scaling factors to be used, as percentages of this skin's "native" size.
     * @return {WebGLTexture} The GL texture representation of this skin when drawing at the given size.
     */
    // eslint-disable-next-line no-unused-vars
    getTexture (scale) {
        return this._texture;
    }

    /**
     * Clear the drawing surface.
     */
    clear () {
        this._renderer.enterDrawRegion(this._useBufferDrawRegionId);

        /* Reset framebuffer to transparent black */
        const gl = this._renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this._silhouetteDirty = true;
    }

    /**
     * Prepare to do things with this MovieBuffer's framebuffer
     */
    _enterUseBuffer () {
        twgl.bindFramebufferInfo(this._renderer.gl, this._framebuffer);
    }

    /**
     * Return to a base state
     */
    _exitUseBuffer () {
        twgl.bindFramebufferInfo(this._renderer.gl, null);
    }

    // tw: draw region used to preserve texture when resizing
    _enterDrawTexture () {
        this._enterUseBuffer();
        const gl = this._renderer.gl;
        gl.viewport(0, 0, this._size[0], this._size[1]);
        gl.useProgram(this._drawTextureShader.program);
        twgl.setBuffersAndAttributes(gl, this._drawTextureShader, this._renderer._bufferInfo);
    }
    _exitDrawTexture () {
        this._exitUseBuffer();
    }
    _copyTexture (texture) {
        this._renderer.enterDrawRegion(this._drawTextureRegionId);
        const gl = this._renderer.gl;
        const width = this._size[0];
        const height = this._size[1];

        const uniforms = {
            u_skin: texture,
            u_projectionMatrix: twgl.m4.ortho(
                width / 2,
                width / -2,
                height / -2,
                height / 2,
                -1,
                1,
                twgl.m4.identity()
            ),
            u_modelMatrix: twgl.m4.scaling(twgl.v3.create(
                width,
                height,
                0
            ), twgl.m4.identity())
        };

        twgl.setTextureParameters(gl, texture, {
            // Always use NEAREST because this most closely matches Scratch behavior
            minMag: gl.NEAREST
        });
        twgl.setUniforms(this._drawTextureShader, uniforms);
        twgl.drawBufferInfo(gl, this._renderer._bufferInfo, gl.TRIANGLES);
    }

    /**
     * React to a change in the renderer's native size.
     * @param {object} event - The change event.
     */
    onNativeSizeChanged (event) {
        // tw: keep track of native size
        this._nativeSize = event.newSize;
        this._setCanvasSize([
            event.newSize[0] * this.renderQuality,
            event.newSize[1] * this.renderQuality
        ]);
        this.emitWasAltered();
    }

    /**
     * Set the size of the drawing buffer.
     * @param {Array<int>} canvasSize - the new width and height for the canvas.
     * @private
     */
    _setCanvasSize (canvasSize) {
        const [width, height] = canvasSize;

        // tw: do not resize if new size === old size
        if (this._size && this._size[0] === width && this._size[1] === height) {
            return;
        }

        this._renderer._doExitDrawRegion();
        const oldFramebuffer = this._framebuffer;
        this._size = canvasSize;
        // tw: use native size for Drawable positioning logic
        this._rotationCenter[0] = this._nativeSize[0] / 2;
        this._rotationCenter[1] = this._nativeSize[1] / 2;

        const gl = this._renderer.gl;

        // tw: store current texture to redraw it later
        const oldTexture = this._texture;

        this._texture = twgl.createTexture(
            gl,
            {
                mag: gl.NEAREST,
                min: gl.NEAREST,
                wrap: gl.CLAMP_TO_EDGE,
                width,
                height
            }
        );

        const attachments = [
            {
                format: gl.RGBA,
                attachment: this._texture
            }
        ];

        this._framebuffer = twgl.createFramebufferInfo(gl, attachments, width, height);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // tw: preserve old texture when resizing
        if (oldTexture) {
            this._copyTexture(oldTexture);
        }

        this._renderer._doExitDrawRegion();
        if (oldTexture) gl.deleteTexture(oldTexture);
        if (oldFramebuffer) gl.deleteFramebuffer(oldFramebuffer.framebuffer);

        this._silhouettePixels = new Uint8Array(Math.floor(width * height * 4));
        this._silhouetteImageData = new ImageData(width, height);

        this._silhouetteDirty = true;
    }

    // tw: sets the "quality" of the drawing surface
    setRenderQuality (quality) {
        if (this.renderQuality === quality) {
            return;
        }
        this.renderQuality = quality;
        this._setCanvasSize([Math.round(this._nativeSize[0] * quality), Math.round(this._nativeSize[1] * quality)]);
    }

    /**
     * If there have been drawing operations that have dirtied the canvas, update
     * now before someone wants to use our silhouette.
     */
    updateSilhouette () {
        if (this._silhouetteDirty) {
            this._renderer.enterDrawRegion(this._useBufferDrawRegionId);
            // Sample the framebuffer's pixels into the silhouette instance
            const gl = this._renderer.gl;
            gl.readPixels(
                0, 0,
                this._size[0], this._size[1],
                gl.RGBA, gl.UNSIGNED_BYTE, this._silhouettePixels
            );

            this._silhouetteImageData.data.set(this._silhouettePixels);
            this._silhouette.update(this._silhouetteImageData, true /* isPremultiplied */);

            this._silhouetteDirty = false;
        }
    }
}

module.exports = MovieBuffer;
