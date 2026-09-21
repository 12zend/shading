const Cast = require('../util/cast');
const Clone = require('../util/clone');
const Color = require('../util/color');
const MathUtil = require('../util/math-util');
const log = require('../util/log');

// Legacy project commands retain only target/color state; all drawing belongs to scratch-render.
const ColorParam = {
    COLOR: 'color',
    SATURATION: 'saturation',
    BRIGHTNESS: 'brightness',
    TRANSPARENCY: 'transparency'
};

class MovieDrawingCommands {
    constructor (runtime) {
        this.runtime = runtime;
        runtime.movieDrawing = this;

        this.onTargetCreated = this.onTargetCreated.bind(this);
        this.onTargetMoved = this.onTargetMoved.bind(this);

        runtime.on('targetWasCreated', this.onTargetCreated);
        runtime.on('RUNTIME_DISPOSED', this.clear.bind(this));
    }

    static get DEFAULT_STATE () {
        return {
            drawing: false,
            color: 66.66,
            saturation: 100,
            brightness: 100,
            transparency: 0,
            _shade: 50, // Used only for legacy `change shade by` blocks
            stroke: {
                color4f: [0, 0, 1, 1],
                diameter: 1
            }
        };
    }


    static get SIZE_RANGE () {
        return {min: 1, max: 1200};
    }

    static get STATE_KEY () {
        // tw: We've hardcoded this value in various places for slight performance gains
        // Make sure to update those if this changes.
        return 'Movie.drawing';
    }

    clampSize (requestedSize) {
        if (
            (this.runtime.renderer && this.runtime.renderer.useHighQualityRender) ||
            !this.runtime.runtimeOptions.miscLimits
        ) {
            return Math.max(0, requestedSize);
        }
        return MathUtil.clamp(
            requestedSize,
            MovieDrawingCommands.SIZE_RANGE.min,
            MovieDrawingCommands.SIZE_RANGE.max
        );
    }

    getState (target) {
        let state = target._customState['Movie.drawing'];
        if (!state) {
            state = Clone.simple(MovieDrawingCommands.DEFAULT_STATE);
            target.setCustomState(MovieDrawingCommands.STATE_KEY, state);
        }
        return state;
    }

    onTargetCreated (newTarget, sourceTarget) {
        if (sourceTarget) {
            const state = sourceTarget.getCustomState(MovieDrawingCommands.STATE_KEY);
            if (state) {
                newTarget.setCustomState(MovieDrawingCommands.STATE_KEY, Clone.simple(state));
                if (state.drawing) {
                    newTarget.onTargetMoved = this.onTargetMoved;
                }
            }
        }
    }

    onTargetMoved (target, oldX, oldY, isForce) {
        // Only move the pen if the movement isn't forced (ie. dragged).
        if (!isForce) {
            this.drawStroke(this.getState(target).stroke, oldX, oldY, target.x, target.y);
        }
    }

    _wrapColor (value) {
        return MathUtil.wrapClamp(value, 0, 100);
    }

    _clampColorParam (value) {
        return MathUtil.clamp(value, 0, 100);
    }

    _alphaToTransparency (alpha) {
        return (1.0 - alpha) * 100.0;
    }

    _transparencyToAlpha (transparency) {
        return 1.0 - (transparency / 100.0);
    }

    getPrimitives () {
        return {
            pen_clear: this.clear,
            pen_stamp: this.stamp,
            pen_penDown: this.penDown,
            pen_penUp: this.penUp,
            pen_changePenColorParamBy: this.changePenColorParamBy,
            pen_setPenColorParamTo: this.setPenColorParamTo,
            pen_setPenColorToColor: this.setPenColorToColor,
            pen_changePenSizeBy: this.changePenSizeBy,
            pen_setPenSizeTo: this.setPenSizeTo,
            pen_setPenShadeToNumber: this.setPenShadeToNumber,
            pen_changePenShadeBy: this.changePenShadeBy,
            pen_setPenHueToNumber: this.setPenHueToNumber,
            pen_changePenHueBy: this.changePenHueBy
        };
    }

    clear () {
        const manager = this.runtime.movieAssetManager;
        if (manager && manager.enqueueFrameGraphDrawingOperation('clear')) return;
        if (manager) manager.beginFrameTransaction();
        this.clearSurface();
        if (manager) {
            manager.drawDefaultBackground();
            manager.invalidateDepthResources();
        }
    }

    clearSurface () {
        if (!this.runtime.renderer) return;
        this.runtime.renderer.clearMovieBuffer();
        this.runtime.requestRedraw();
    }

    stamp (args, util) {
        this.drawSprite(util.target);
    }

    drawSprite (target) {
        const manager = this.runtime.movieAssetManager;
        if (manager && manager.enqueueFrameGraphDrawingOperation('sprite', target)) return;
        this.drawTarget(target);
    }

    drawTarget (target) {
        if (!target || !this.runtime.renderer) return;
        this.runtime.renderer.drawMovieDrawable(target.drawableID);
        this.runtime.requestRedraw();
    }

    drawStroke (attributes, x0, y0, x1 = x0, y1 = y0) {
        if (!this.runtime.renderer) return;
        this.runtime.renderer.drawMovieStroke(attributes, x0, y0, x1, y1);
        this.runtime.requestRedraw();
    }

    penDown (args, util) {
        this.startTrail(util.target);
    }
    startTrail (target) { // used by compiler
        const state = this.getState(target);

        if (!state.drawing) {
            state.drawing = true;
            target.onTargetMoved = this.onTargetMoved;
        }

        this.drawStroke(state.stroke, target.x, target.y);
    }

    penUp (args, util) {
        this.stopTrail(util.target);
    }
    stopTrail (target) { // used by compiler
        const state = this.getState(target);

        if (state.drawing) {
            state.drawing = false;
            target.onTargetMoved = null;
        }
    }

    setPenColorToColor (args, util) {
        this.setColor(args.COLOR, util.target);
    }
    setColor (color, target) { // used by compiler
        const state = this.getState(target);
        const rgb = Cast.toRgbColorObject(color);
        const hsv = Color.rgbToHsv(rgb);
        state.color = (hsv.h / 360) * 100;
        state.saturation = hsv.s * 100;
        state.brightness = hsv.v * 100;
        if (Object.prototype.hasOwnProperty.call(rgb, 'a')) {
            state.transparency = 100 * (1 - (rgb.a / 255.0));
        } else {
            state.transparency = 0;
        }

        // Set the legacy "shade" value the same way scratch 2 did.
        state._shade = state.brightness / 2;

        this.updateColor(state);
    }

    updateColor (state) {
        const rgb = Color.hsvToRgb({
            h: state.color * 360 / 100,
            s: state.saturation / 100,
            v: state.brightness / 100
        });
        state.stroke.color4f[0] = rgb.r / 255.0;
        state.stroke.color4f[1] = rgb.g / 255.0;
        state.stroke.color4f[2] = rgb.b / 255.0;
        state.stroke.color4f[3] = this._transparencyToAlpha(state.transparency);
    }

    _setOrChangeColorParam (param, value, state, change) { // used by compiler
        switch (param) {
        case ColorParam.COLOR:
            state.color = this._wrapColor(value + (change ? state.color : 0));
            break;
        case ColorParam.SATURATION:
            state.saturation = this._clampColorParam(value + (change ? state.saturation : 0));
            break;
        case ColorParam.BRIGHTNESS:
            state.brightness = this._clampColorParam(value + (change ? state.brightness : 0));
            break;
        case ColorParam.TRANSPARENCY:
            state.transparency = this._clampColorParam(value + (change ? state.transparency : 0));
            break;
        default:
            log.warn(`Tried to set or change unknown color parameter: ${param}`);
        }
        this.updateColor(state);
    }

    changePenColorParamBy (args, util) {
        const state = this.getState(util.target);
        this._setOrChangeColorParam(args.COLOR_PARAM, Cast.toNumber(args.VALUE), state, true);
    }

    setPenColorParamTo (args, util) {
        const state = this.getState(util.target);
        this._setOrChangeColorParam(args.COLOR_PARAM, Cast.toNumber(args.VALUE), state, false);
    }

    changePenSizeBy (args, util) {
        this.changeSize(Cast.toNumber(args.SIZE), util.target);
    }
    changeSize (size, target) { // used by compiler
        const stroke = this.getState(target).stroke;
        stroke.diameter = this.clampSize(stroke.diameter + size);
    }

    setPenSizeTo (args, util) {
        this.setSize(Cast.toNumber(args.SIZE), util.target);
    }
    setSize (size, target) { // used by compiler
        const stroke = this.getState(target).stroke;
        stroke.diameter = this.clampSize(size);
    }

    /* LEGACY OPCODES */
    setPenHueToNumber (args, util) {
        this.setHue(Cast.toNumber(args.HUE), util.target);
    }
    setHue (hueValue, target) {
        const state = this.getState(target);
        const colorValue = hueValue / 2;
        this._setOrChangeColorParam(ColorParam.COLOR, colorValue, state, false);
        this._setOrChangeColorParam(ColorParam.TRANSPARENCY, 0, state, false);
        this._legacyUpdatePenColor(state);
    }

    changePenHueBy (args, util) {
        this.changeHue(Cast.toNumber(args.HUE), util.target);
    }
    changeHue (hueChange, target) { // used by compiler
        const state = this.getState(target);
        const colorChange = hueChange / 2;
        this._setOrChangeColorParam(ColorParam.COLOR, colorChange, state, true);

        this._legacyUpdatePenColor(state);
    }

    setPenShadeToNumber (args, util) {
        this.setShade(Cast.toNumber(args.SHADE), util.target);
    }
    setShade (shade, target) {
        const state = this.getState(target);
        let newShade = Cast.toNumber(shade);

        // Wrap clamp the new shade value the way scratch 2 did.
        newShade = newShade % 200;
        if (newShade < 0) newShade += 200;

        // And store the shade that was used to compute this new color for later use.
        state._shade = newShade;

        this._legacyUpdatePenColor(state);
    }

    changePenShadeBy (args, util) {
        this.changeShade(args.SHADE, util.target);
    }
    changeShade (shade, target) {
        const state = this.getState(target);
        const shadeChange = Cast.toNumber(shade);
        this.setShade(state._shade + shadeChange, target);
    }

    _legacyUpdatePenColor (state) {
        // Create the new color in RGB using the scratch 2 "shade" model
        let rgb = Color.hsvToRgb({h: state.color * 360 / 100, s: 1, v: 1});
        const shade = (state._shade > 100) ? 200 - state._shade : state._shade;
        if (shade < 50) {
            rgb = Color.mixRgb(Color.RGB_BLACK, rgb, (10 + shade) / 60);
        } else {
            rgb = Color.mixRgb(rgb, Color.RGB_WHITE, (shade - 50) / 60);
        }

        // Update the pen state according to new color
        const hsv = Color.rgbToHsv(rgb);
        state.color = 100 * hsv.h / 360;
        state.saturation = 100 * hsv.s;
        state.brightness = 100 * hsv.v;

        this.updateColor(state);
    }
}

module.exports = MovieDrawingCommands;
