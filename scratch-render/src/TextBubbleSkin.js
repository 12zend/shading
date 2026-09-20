const twgl = require('twgl.js');

const CanvasMeasurementProvider = require('./util/canvas-measurement-provider');
const Skin = require('./Skin');

const DEFAULT_BUBBLE_STYLE = {
    maxLineWidth: 170, // Maximum width, in Scratch pixels, of a single line of text

    minWidth: 50, // Minimum width, in Scratch pixels, of a text bubble
    strokeWidth: 4, // Thickness of the stroke around the bubble. Only half's visible because it's drawn under the fill
    padding: 10, // Padding around the text area
    cornerRadius: 16, // Radius of the rounded corners
    tailHeight: 12, // Height of the speech bubble's "tail". Probably should be a constant.

    font: 'Helvetica', // Font to render the text with
    fontSize: 14, // Font size, in Scratch pixels
    fontHeightRatio: 0.9, // Height, in Scratch pixels, of the text, as a proportion of the font's size
    lineHeight: 16, // Spacing between each line of text

    bubbleFill: 'white',
    bubbleStroke: 'rgba(0, 0, 0, 0.15)',
    textFill: '#575E75'
};

const MAX_SCALE = 10;

class TextBubbleSkin extends Skin {
    /**
     * Create a new text bubble skin.
     * @param {!int} id - The ID for this Skin.
     * @param {!RenderWebGL} renderer - The renderer which will use this skin.
     * @constructor
     * @extends Skin
     */
    constructor (id, renderer) {
        super(id, renderer);

        /** @type {HTMLCanvasElement} */
        this._canvas = document.createElement('canvas');

        /** @type {Array<number>} */
        this._size = [0, 0];

        /** @type {number} */
        this._renderedScale = 0;

        /** @type {Array<string>} */
        this._lines = [];

        /** @type {object} */
        this._textAreaSize = {width: 0, height: 0};

        /** @type {string} */
        this._bubbleType = '';

        /** @type {boolean} */
        this._pointsLeft = false;

        /** @type {boolean} */
        this._textDirty = true;

        /** @type {boolean} */
        this._textureDirty = true;

        /**
         * Use setStyle() instead of modfying directly.
         * Supplied values are considered trusted and will not be further checked or sanitized.
         * Updating skin style will not reposition drawables.
         */
        this._style = DEFAULT_BUBBLE_STYLE;

        this.measurementProvider = new CanvasMeasurementProvider(this._canvas.getContext('2d'));
        this.textWrapper = renderer.createTextWrapper(this.measurementProvider);

        this._restyleCanvas();
    }

    /**
     * Dispose of this object. Do not use it after calling this method.
     */
    dispose () {
        if (this._texture) {
            this._renderer.gl.deleteTexture(this._texture);
            this._texture = null;
        }
        this._canvas = null;
        super.dispose();
    }

    /**
     * @return {Array<number>} the dimensions, in Scratch units, of this skin.
     */
    get size () {
        if (this._textDirty) {
            this._reflowLines();
        }
        return this._size;
    }

    /**
     * Set parameters for this text bubble.
     * @param {!string} type - either "say" or "think".
     * @param {!string} text - the text for the bubble.
     * @param {!boolean} pointsLeft - which side the bubble is pointing.
     */
    setTextBubble (type, text, pointsLeft) {
        this._text = text;
        this._bubbleType = type;
        this._pointsLeft = pointsLeft;

        this._textDirty = true;
        this._textureDirty = true;
        this.emitWasAltered();
    }

    /**
     * Change style used for rendering the bubble. Properties not specified will be unchanged.
     * Given argument will be copied internally, so you can freely change it later without
     * affecting the skin.
     * @param {object} newStyle New styles to be applied.
     */
    setStyle (newStyle) {
        this._style = Object.assign({}, this._style, newStyle);
        this.measurementProvider.clearCache();
        this._restyleCanvas();
        this._textDirty = true;
        this._textureDirty = true;
        this.emitWasAltered();
    }

    /**
     * Re-style the canvas after resizing it. This is necessary to ensure proper text measurement.
     */
    _restyleCanvas () {
        this._canvas.getContext('2d').font = `${this._style.fontSize}px ${this._style.font}, sans-serif`;
    }

    /**
     * Update the array of wrapped lines and the text dimensions.
     */
    _reflowLines () {
        this._lines = this.textWrapper.wrapText(this._style.maxLineWidth, this._text);

        // Measure width of longest line to avoid extra-wide bubbles
        let longestLineWidth = 0;
        for (const line of this._lines) {
            longestLineWidth = Math.max(longestLineWidth, this.measurementProvider.measureText(line));
        }

        // Calculate the canvas-space sizes of the padded text area and full text bubble
        const paddedWidth = Math.max(longestLineWidth, this._style.minWidth) + (this._style.padding * 2);
        const paddedHeight = (this._style.lineHeight * this._lines.length) + (this._style.padding * 2);

        this._textAreaSize.width = paddedWidth;
        this._textAreaSize.height = paddedHeight;

        this._size[0] = paddedWidth + this._style.strokeWidth;
        this._size[1] = paddedHeight + this._style.strokeWidth + this._style.tailHeight;

        this._textDirty = false;
    }

    /**
     * Render this text bubble at a certain scale, using the current parameters, to the canvas.
     * @param {number} scale The scale to render the bubble at
     */
    _renderTextBubble (scale) {
        const ctx = this._canvas.getContext('2d');

        if (this._textDirty) {
            this._reflowLines();
        }

        // Calculate the canvas-space sizes of the padded text area and full text bubble
        const paddedWidth = this._textAreaSize.width;
        const paddedHeight = this._textAreaSize.height;

        // Resize the canvas to the correct screen-space size
        this._canvas.width = Math.ceil(this._size[0] * scale);
        this._canvas.height = Math.ceil(this._size[1] * scale);
        this._restyleCanvas();

        // Reset the transform before clearing to ensure 100% clearage
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        ctx.scale(scale, scale);
        ctx.translate(this._style.strokeWidth * 0.5, this._style.strokeWidth * 0.5);

        // If the text bubble points leftward, flip the canvas
        ctx.save();
        if (this._pointsLeft) {
            ctx.scale(-1, 1);
            ctx.translate(-paddedWidth, 0);
        }

        // Draw the bubble's rounded borders
        ctx.beginPath();
        ctx.moveTo(this._style.cornerRadius, paddedHeight);
        ctx.arcTo(0, paddedHeight, 0, paddedHeight - this._style.cornerRadius, this._style.cornerRadius);
        ctx.arcTo(0, 0, paddedWidth, 0, this._style.cornerRadius);
        ctx.arcTo(paddedWidth, 0, paddedWidth, paddedHeight, this._style.cornerRadius);
        ctx.arcTo(paddedWidth, paddedHeight, paddedWidth - this._style.cornerRadius, paddedHeight,
            this._style.cornerRadius);

        // Translate the canvas so we don't have to do a bunch of width/height arithmetic
        ctx.save();
        ctx.translate(paddedWidth - this._style.cornerRadius, paddedHeight);

        // Draw the bubble's "tail"
        if (this._bubbleType === 'say') {
            // For a speech bubble, draw one swoopy thing
            ctx.bezierCurveTo(0, 4, 4, 8, 4, 10);
            ctx.arcTo(4, 12, 2, 12, 2);
            ctx.bezierCurveTo(-1, 12, -11, 8, -16, 0);

            ctx.closePath();
        } else {
            // For a thinking bubble, draw a partial circle attached to the bubble...
            ctx.arc(-16, 0, 4, 0, Math.PI);

            ctx.closePath();

            // and two circles detached from it
            ctx.moveTo(-7, 7.25);
            ctx.arc(-9.25, 7.25, 2.25, 0, Math.PI * 2);

            ctx.moveTo(0, 9.5);
            ctx.arc(-1.5, 9.5, 1.5, 0, Math.PI * 2);
        }

        // Un-translate the canvas and fill + stroke the text bubble
        ctx.restore();

        ctx.fillStyle = this._style.bubbleFill;
        ctx.strokeStyle = this._style.bubbleStroke;
        ctx.lineWidth = this._style.strokeWidth;

        ctx.stroke();
        ctx.fill();

        // Un-flip the canvas if it was flipped
        ctx.restore();

        // Draw each line of text
        ctx.fillStyle = this._style.textFill;
        const lines = this._lines;
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];
            ctx.fillText(
                line,
                this._style.padding,
                this._style.padding + (this._style.lineHeight * lineNumber) +
                    (this._style.fontHeightRatio * this._style.fontSize)
            );
        }

        this._renderedScale = scale;
    }

    updateSilhouette (scale = [100, 100]) {
        // Ensure a silhouette exists.
        this.getTexture(scale);
    }

    /**
     * @param {Array<number>} scale - The scaling factors to be used, each in the [0,100] range.
     * @return {WebGLTexture} The GL texture representation of this skin when drawing at the given scale.
     */
    getTexture (scale) {
        // The texture only ever gets uniform scale. Take the larger of the two axes.
        const scaleMax = scale ? Math.max(Math.abs(scale[0]), Math.abs(scale[1])) : 100;
        const requestedScale = Math.min(MAX_SCALE, scaleMax / 100);

        // If we already rendered the text bubble at this scale, we can skip re-rendering it.
        if (this._textureDirty || this._renderedScale !== requestedScale) {
            this._renderTextBubble(requestedScale);
            this._textureDirty = false;

            const context = this._canvas.getContext('2d');
            const textureData = context.getImageData(0, 0, this._canvas.width, this._canvas.height);

            const gl = this._renderer.gl;

            if (this._texture === null) {
                const textureOptions = {
                    auto: false,
                    wrap: gl.CLAMP_TO_EDGE
                };

                this._texture = twgl.createTexture(gl, textureOptions);
            }

            this._setTexture(textureData);
        }

        return this._texture;
    }
}

module.exports = TextBubbleSkin;
