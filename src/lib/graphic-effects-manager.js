import * as twgl from 'twgl.js';
import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';

import spriteVertexShader from '!raw-loader!scratch-render/src/shaders/sprite.vert';
import spriteFragmentShader from '!raw-loader!./graphic-effects.frag';

const CUSTOM_BLOCKS = [
    'looks_bloom',
    'looks_circularripple',
    'looks_displacementmap',
    'looks_edgedetection',
    'looks_effectweight',
    'looks_pixelstretch',
    'looks_posterize',
    'looks_rgbshift',
    'looks_setheightto',
    'looks_setwidthto',
    'looks_turbulentdisplace'
];

const EFFECT_NAMES = [
    'gaussianblur',
    'lensblur',
    'radialblur',
    'directionalblur',
    'turbulentdisplace',
    'posterize',
    'rgbshift',
    'edgedetection',
    'circularripple',
    'pixelstretch',
    'bloom',
    'displacementmap',
    'effectweight'
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const number = value => {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
};
const radians = value => number(value) * Math.PI / 180;
const vector = (value, length) => (
    Array.isArray(value) ? value.slice(0, length) : new Array(length).fill(0)
);

const EFFECT_INFO = {
    gaussianblur: {
        uniformName: 'u_gaussianBlur',
        mask: 1 << 7,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    lensblur: {
        uniformName: 'u_lensBlur',
        mask: 1 << 8,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    radialblur: {
        uniformName: 'u_radialBlur',
        mask: 1 << 9,
        converter: value => clamp(Math.abs(number(value)) / 100, 0, 1),
        shapeChanges: true
    },
    directionalblur: {
        uniformName: 'u_directionalBlur',
        mask: 1 << 10,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    turbulentdisplace: {
        uniformName: 'u_turbulentDisplace',
        mask: 1 << 11,
        converter: value => vector(value, 4),
        shapeChanges: true
    },
    posterize: {
        uniformName: 'u_posterize',
        mask: 1 << 12,
        converter: value => clamp(Math.round(Math.abs(number(value))), 2, 64),
        shapeChanges: false
    },
    rgbshift: {
        uniformName: 'u_rgbShift',
        mask: 1 << 13,
        converter: value => vector(value, 2),
        shapeChanges: false
    },
    edgedetection: {
        uniformName: 'u_edgeDetection',
        mask: 1 << 14,
        converter: value => clamp(Math.abs(number(value)) / 100, 0, 4),
        shapeChanges: false
    },
    circularripple: {
        uniformName: 'u_circularRipple',
        mask: 1 << 15,
        converter: value => vector(value, 3),
        shapeChanges: true
    },
    pixelstretch: {
        uniformName: 'u_pixelStretchA',
        mask: 1 << 16,
        converter: value => vector(value, 4),
        shapeChanges: true
    },
    bloom: {
        uniformName: 'u_bloom',
        mask: 1 << 17,
        converter: value => vector(value, 3),
        shapeChanges: false
    },
    displacementmap: {
        uniformName: 'u_displacement',
        mask: 1 << 18,
        converter: value => vector(value, 2),
        shapeChanges: true
    },
    effectweight: {
        uniformName: 'u_effectWeightAmount',
        mask: 1 << 19,
        converter: value => number(value),
        shapeChanges: false
    }
};

/* eslint-disable no-invalid-this */
const buildShader = function (drawMode, effectBits) {
    const defines = [`#define DRAW_MODE_${drawMode}`];
    for (let index = 0; index < this.constructor.EFFECTS.length; index++) {
        if ((effectBits & (1 << index)) !== 0) {
            defines.push(`#define ENABLE_${this.constructor.EFFECTS[index]}`);
        }
    }
    const definesText = `${defines.join('\n')}\n`;
    let errorMessage = null;
    const onError = error => {
        // eslint-disable-next-line no-console
        console.error(error);
        const match = error.match(/\*\*\* Error compiling shader: ([\s\S]+)/);
        errorMessage = match ? match[1].trim() : error;
    };
    const program = twgl.createProgramInfo(
        this._gl,
        [definesText + spriteVertexShader, definesText + spriteFragmentShader],
        null,
        null,
        onError
    );
    if (!program) {
        throw new Error(`Failed to compile shader (mode ${drawMode}, effects ${effectBits}): ${errorMessage}`);
    }
    return program;
};
/* eslint-enable no-invalid-this */

const initializeDrawable = drawable => {
    if (!drawable) return;
    for (const effectName of EFFECT_NAMES) {
        const effectInfo = EFFECT_INFO[effectName];
        if (!Object.prototype.hasOwnProperty.call(drawable._uniforms, effectInfo.uniformName)) {
            drawable._uniforms[effectInfo.uniformName] = effectInfo.converter(0);
        }
    }
    if (!Object.prototype.hasOwnProperty.call(drawable._uniforms, 'u_rgbShiftColor')) {
        drawable._uniforms.u_rgbShiftColor = 0;
        drawable._uniforms.u_pixelStretchB = [0, 0, 0, 0];
    }
};

const installRendererEffects = renderer => {
    if (!renderer || !renderer._shaderManager) return;
    const ShaderManager = renderer._shaderManager.constructor;
    if (!ShaderManager.__movieGraphicEffects) {
        Object.assign(ShaderManager.EFFECT_INFO, EFFECT_INFO);
        ShaderManager.EFFECTS = Object.keys(ShaderManager.EFFECT_INFO);
        ShaderManager.prototype._buildShader = buildShader;
        ShaderManager.__movieGraphicEffects = true;
    }
    renderer._shaderManager._shaderCache = {};
    for (const drawMode in ShaderManager.DRAW_MODE) {
        if (!Object.prototype.hasOwnProperty.call(ShaderManager.DRAW_MODE, drawMode)) continue;
        renderer._shaderManager._shaderCache[ShaderManager.DRAW_MODE[drawMode]] = [];
    }
    renderer._allDrawables.forEach(initializeDrawable);
};

const defaultTargetState = () => ({
    displacementCostume: null,
    effectWeightCostume: null,
    height: 100,
    pixelStretchB: [0, 0, 0, 0],
    rgbShiftColor: 0,
    width: 100
});

class GraphicEffectsManager {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.targetStates = new Map();
        this.handleTargetCreated = this.handleTargetCreated.bind(this);
        this.handleTargetRemoved = this.handleTargetRemoved.bind(this);

        installRendererEffects(this.runtime.renderer);
        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.targets.forEach(target => this.patchTarget(target));
        this.installPrimitives();
    }

    installPrimitives () {
        const primitives = this.runtime._primitives;
        primitives.looks_setwidthto = (args, util) => this.setScale(util.target, 'width', args.WIDTH);
        primitives.looks_setheightto = (args, util) => this.setScale(util.target, 'height', args.HEIGHT);
        primitives.looks_turbulentdisplace = (args, util) => this.turbulentDisplace(util.target, args);
        primitives.looks_posterize = (args, util) => this.posterize(util.target, args.VALUE);
        primitives.looks_rgbshift = (args, util) => this.rgbShift(util.target, args);
        primitives.looks_edgedetection = (args, util) => this.edgeDetection(util.target, args.VALUE);
        primitives.looks_circularripple = (args, util) => this.circularRipple(util.target, args);
        primitives.looks_pixelstretch = (args, util) => this.pixelStretch(util.target, args);
        primitives.looks_bloom = (args, util) => this.bloom(util.target, args);
        primitives.looks_displacementmap = (args, util) => this.displacementMap(util.target, args);
        primitives.looks_effectweight = (args, util) => this.effectWeight(util.target, args.COSTUME);

        for (const opcode of CUSTOM_BLOCKS) {
            if (!compatBlocks.stacked.includes(opcode)) compatBlocks.stacked.push(opcode);
        }
    }

    handleTargetCreated (target, sourceTarget) {
        this.patchTarget(target, sourceTarget);
    }

    handleTargetRemoved (target) {
        this.targetStates.delete(target.id);
    }

    patchTarget (target, sourceTarget) {
        if (!target || target.__movieGraphicEffectsPatched) return;
        target.__movieGraphicEffectsPatched = true;

        const sourceState = sourceTarget && this.targetStates.get(sourceTarget.id);
        const state = sourceState ? JSON.parse(JSON.stringify(sourceState)) : defaultTargetState();
        this.targetStates.set(target.id, state);

        for (const effectName of EFFECT_NAMES) {
            if (!Object.prototype.hasOwnProperty.call(target.effects, effectName)) target.effects[effectName] = 0;
        }

        const originalRenderedScale = target._getRenderedDirectionAndScale.bind(target);
        target._getRenderedDirectionAndScale = () => {
            const rendered = originalRenderedScale();
            const currentState = this.targetStates.get(target.id) || defaultTargetState();
            rendered.scale = [
                rendered.scale[0] * currentState.width / 100,
                rendered.scale[1] * currentState.height / 100
            ];
            return rendered;
        };

        const originalUpdateAll = target.updateAllDrawableProperties.bind(target);
        target.updateAllDrawableProperties = () => {
            const result = originalUpdateAll();
            this.restoreExtraUniforms(target);
            return result;
        };

        this.restoreExtraUniforms(target);
    }

    getDrawable (target) {
        const renderer = this.runtime.renderer;
        const drawable = renderer && renderer._allDrawables[target.drawableID];
        initializeDrawable(drawable);
        return drawable;
    }

    updateExtraUniforms (target, uniforms) {
        const drawable = this.getDrawable(target);
        if (drawable) Object.assign(drawable._uniforms, uniforms);
    }

    resolveCostume (target, requestedCostume) {
        const costumes = target.getCostumes();
        if (!costumes.length) return null;
        if (typeof requestedCostume === 'number' || /^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(String(requestedCostume))) {
            const index = clamp(Math.round(number(requestedCostume)) - 1, 0, costumes.length - 1);
            return costumes[index];
        }
        return costumes.find(costume => costume.name === String(requestedCostume)) || costumes[target.currentCostume];
    }

    getCostumeTexture (target, requestedCostume) {
        const costume = this.resolveCostume(target, requestedCostume);
        const renderer = this.runtime.renderer;
        if (!costume || !renderer) return null;
        const skin = renderer._allSkins[costume.skinId];
        return skin ? skin.getTexture([100, 100]) : null;
    }

    restoreExtraUniforms (target) {
        const state = this.targetStates.get(target.id);
        if (!state) return;
        const uniforms = {
            u_pixelStretchB: state.pixelStretchB,
            u_rgbShiftColor: state.rgbShiftColor
        };
        if (state.displacementCostume !== null) {
            uniforms.u_displacementMap = this.getCostumeTexture(target, state.displacementCostume);
        }
        if (state.effectWeightCostume !== null) {
            uniforms.u_effectWeight = this.getCostumeTexture(target, state.effectWeightCostume);
        }
        this.updateExtraUniforms(target, uniforms);
    }

    setScale (target, axis, value) {
        const state = this.targetStates.get(target.id);
        if (!state || target.isStage) return;
        state[axis] = number(value);
        const {direction, scale} = target._getRenderedDirectionAndScale();
        if (this.runtime.renderer) {
            this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, direction, scale);
        }
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
        this.runtime.requestTargetsUpdate(target);
    }

    turbulentDisplace (target, args) {
        const amount = clamp(number(args.AMOUNT), -100, 100);
        const value = [
            amount,
            clamp(Math.abs(number(args.SIZE)), 1, 1000),
            clamp(Math.round(Math.abs(number(args.COMPLEXITY))), 1, 5),
            radians(args.EVOLUTION)
        ];
        target.setEffect('turbulentdisplace', amount === 0 ? 0 : value);
    }

    posterize (target, value) {
        const levels = number(value);
        target.setEffect('posterize', levels === 0 ? 0 : levels);
    }

    rgbShift (target, args) {
        const amount = clamp(number(args.VALUE), -100, 100);
        const colorCodes = {RG: 0, GB: 1, BR: 2};
        const state = this.targetStates.get(target.id);
        state.rgbShiftColor = colorCodes[args.COLOR] || 0;
        this.updateExtraUniforms(target, {u_rgbShiftColor: state.rgbShiftColor});
        target.setEffect('rgbshift', amount === 0 ? 0 : [amount, radians(args.DIR)]);
    }

    edgeDetection (target, value) {
        const amount = number(value);
        target.setEffect('edgedetection', amount === 0 ? 0 : amount);
    }

    circularRipple (target, args) {
        const amount = clamp(number(args.VALUE), -100, 100);
        target.setEffect('circularripple', amount === 0 ? 0 : [
            clamp(Math.abs(number(args.FREQUENCY)), 0, 100),
            amount,
            radians(args.OFFSET)
        ]);
    }

    pixelStretch (target, args) {
        const offset = clamp(number(args.OFFSET), -200, 200);
        const state = this.targetStates.get(target.id);
        state.pixelStretchB = [
            clamp(number(args.X) / 100, -2, 2),
            clamp(number(args.Y) / 100, -2, 2),
            radians(args.ANGLE),
            0
        ];
        this.updateExtraUniforms(target, {u_pixelStretchB: state.pixelStretchB});
        target.setEffect('pixelstretch', offset === 0 ? 0 : [
            offset,
            clamp(Math.abs(number(args.SMOOTHNESS)) / 100, 0, 1),
            clamp(Math.abs(number(args.FALLOFF)) / 100, 0, 4),
            clamp(Math.abs(number(args.RADIUS)) / 100, 0.001, 4)
        ]);
    }

    bloom (target, args) {
        const value = clamp(number(args.VALUE), -400, 400);
        target.setEffect('bloom', value === 0 ? 0 : [
            clamp(number(args.THRESHOLD) / 100, 0, 1),
            clamp(Math.abs(number(args.BLUR)), 0, 64),
            value / 100
        ]);
    }

    displacementMap (target, args) {
        const typeCodes = {x: 0, y: 1, size: 2, dir: 3};
        const value = clamp(number(args.VALUE), -360, 360);
        const state = this.targetStates.get(target.id);
        state.displacementCostume = String(args.COSTUME);
        const texture = this.getCostumeTexture(target, args.COSTUME);
        this.updateExtraUniforms(target, {u_displacementMap: texture});
        target.setEffect('displacementmap', !texture || value === 0 ? 0 : [typeCodes[args.TYPE] || 0, value]);
    }

    effectWeight (target, requestedCostume) {
        const state = this.targetStates.get(target.id);
        state.effectWeightCostume = String(requestedCostume);
        const texture = this.getCostumeTexture(target, requestedCostume);
        this.updateExtraUniforms(target, {u_effectWeight: texture});
        target.setEffect('effectweight', texture ? 1 : 0);
    }
}

const installGraphicEffectsManager = vm => {
    if (!vm.__graphicEffectsManager) {
        vm.__graphicEffectsManager = new GraphicEffectsManager(vm);
        vm.runtime.graphicEffectsManager = vm.__graphicEffectsManager;
    }
    return vm.__graphicEffectsManager;
};

export {
    EFFECT_INFO,
    GraphicEffectsManager,
    installRendererEffects,
    installGraphicEffectsManager as default
};
