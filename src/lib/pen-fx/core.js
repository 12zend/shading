/* eslint-disable */

import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';
import createPenFXEngine from './engine';
import installEffects from './effects';
import {BLEND_MODES, FRACTAL_NOISE_TYPES, FRACTAL_OVERFLOW_TYPES, FRACTAL_TYPES} from './constants';
import {mixAmount} from './helpers';

const createPenFXClass = vm => {
    const renderer = vm.runtime.renderer;
    const gl = renderer._gl || renderer.gl;
    const PenFXEngine = createPenFXEngine(gl, renderer);

    class PenFX {
        constructor() {
            this.engine = null;
            this.blendMode = 'normal';
            this.blendOpacity = 1;
            this.warned = false;
            this.effectCaptureStack = [];
            vm.runtime.penFX = this;
            const movieAssetManager = vm.runtime.movieAssetManager;
            if (movieAssetManager && typeof movieAssetManager.attachPenFrameTransactions === 'function') {
                movieAssetManager.attachPenFrameTransactions(this);
            }
        }

        getInfo() {
            return {
                id: 'penfx',
                name: 'Looks',
                color1: '#6b56d9',
                color2: '#5945c2',
                color3: '#46359f',
                blocks: [
                    {opcode: 'contrast', blockType: BlockType.COMMAND, text: 'contrast value: [VALUE] pivot: [PIVOT] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, PIVOT: {type: ArgumentType.NUMBER, defaultValue: 0.5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'brightness', blockType: BlockType.COMMAND, text: 'brightness color: [COLOR] value: [VALUE] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#101010'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'gamma', blockType: BlockType.COMMAND, text: 'gamma value: [VALUE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'saturation', blockType: BlockType.COMMAND, text: 'saturation value: [VALUE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'alpha', blockType: BlockType.COMMAND, text: 'alpha [VALUE] % mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'colorGrade', blockType: BlockType.COMMAND, text: 'color grade exposure: [EXPOSURE] temp: [TEMP] tint: [TINT] contrast: [CONTRAST] pivot: [PIVOT] filter: [COLOR] saturation: [SATURATION] mix: [MIX] %', arguments: {EXPOSURE: {type: ArgumentType.NUMBER, defaultValue: 0}, TEMP: {type: ArgumentType.NUMBER, defaultValue: 0}, TINT: {type: ArgumentType.NUMBER, defaultValue: 0}, CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 1}, PIVOT: {type: ArgumentType.NUMBER, defaultValue: 0.5}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, SATURATION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'colorBlindness', blockType: BlockType.COMMAND, text: 'color blindness [TYPE] severity: [SEVERITY] % mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'colorBlindType'}, SEVERITY: {type: ArgumentType.NUMBER, defaultValue: 50}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'colorSpaceAdjust', blockType: BlockType.COMMAND, text: 'HSL adjust hue add: [HADD] mul: [HMUL] saturation add: [SADD] mul: [SMUL] lightness add: [LADD] mul: [LMUL] mix: [MIX] %', arguments: {HADD: {type: ArgumentType.NUMBER, defaultValue: 0}, HMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, SADD: {type: ArgumentType.NUMBER, defaultValue: 0}, SMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, LADD: {type: ArgumentType.NUMBER, defaultValue: 0}, LMUL: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'toneMap', blockType: BlockType.COMMAND, text: 'tone map [TYPE] exposure: [EXPOSURE] white point: [WHITE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'toneMapType'}, EXPOSURE: {type: ArgumentType.NUMBER, defaultValue: 0}, WHITE: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'autoExposure', blockType: BlockType.COMMAND, text: 'auto exposure target: [TARGET] min: [MIN] max: [MAX] mix: [MIX] %', arguments: {TARGET: {type: ArgumentType.NUMBER, defaultValue: 0.18}, MIN: {type: ArgumentType.NUMBER, defaultValue: 0.25}, MAX: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'paletteSwap', blockType: BlockType.COMMAND, text: 'palette map shadows: [C1] [C2] [C3] highlights: [C4] mix: [MIX] %', arguments: {C1: {type: ArgumentType.COLOR, defaultValue: '#0b1026'}, C2: {type: ArgumentType.COLOR, defaultValue: '#3b426e'}, C3: {type: ArgumentType.COLOR, defaultValue: '#8a6f7d'}, C4: {type: ArgumentType.COLOR, defaultValue: '#f6d6bd'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'chromaKey', blockType: BlockType.COMMAND, text: 'chroma key: [KEY] tolerance: [TOLERANCE] softness: [SOFTNESS] use [BEHAVIOR] colors: [COLOR1] [COLOR2] mix: [MIX] %', arguments: {KEY: {type: ArgumentType.COLOR, defaultValue: '#00ff00'}, TOLERANCE: {type: ArgumentType.NUMBER, defaultValue: 0.1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.05}, BEHAVIOR: {type: ArgumentType.STRING, menu: 'chromaBehavior'}, COLOR1: {type: ArgumentType.COLOR, defaultValue: '#000000'}, COLOR2: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'colorOverlay', blockType: BlockType.COMMAND, text: 'color overlay [COLOR] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'gradationOverlay', blockType: BlockType.COMMAND, text: 'gradation overlay [GRADIENT] dir: [DIR] mix: [MIX] %', arguments: {GRADIENT: {type: ArgumentType.STRING, defaultValue: '{"stops":[{"color":"#000000","position":0},{"color":"#ffffff","position":1}]}'}, DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'stroke', blockType: BlockType.COMMAND, text: 'stroke color: [COLOR] width: [WIDTH]', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 4}}},
                    {opcode: 'blob', blockType: BlockType.COMMAND, text: 'blob [MODE] key: [KEY] threshold: [THRESHOLD] blur: [BLUR] min: [MIN] % max: [MAX] % boxes: [SHAPE] color: [COLOR] width: [WIDTH] opacity: [OPACITY] % fill: [FILL] % markers: [MARKER]', arguments: {MODE: {type: ArgumentType.STRING, menu: 'blobMode', defaultValue: 'bright'}, KEY: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 50}, BLUR: {type: ArgumentType.NUMBER, defaultValue: 1}, MIN: {type: ArgumentType.NUMBER, defaultValue: 1}, MAX: {type: ArgumentType.NUMBER, defaultValue: 100}, SHAPE: {type: ArgumentType.STRING, menu: 'blobShape', defaultValue: 'rectangle'}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#00ffff'}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 2}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}, FILL: {type: ArgumentType.NUMBER, defaultValue: 0}, MARKER: {type: ArgumentType.STRING, menu: 'boolean', defaultValue: 'true'}}},
                    '---',
                    {opcode: 'rgbShift', blockType: BlockType.COMMAND, text: 'rgb shift dir: [DIR] value: [VALUE] color: [COLOR] mix: [MIX] %', arguments: {DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, COLOR: {type: ArgumentType.STRING, menu: 'rgbPair'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'gaussianBlur', blockType: BlockType.COMMAND, text: 'gaussian blur type: [TYPE] value: [VALUE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'gaussianType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'directionalBlur', blockType: BlockType.COMMAND, text: 'directional blur dir: [DIR] value: [VALUE] mix: [MIX] %', arguments: {DIR: {type: ArgumentType.ANGLE, defaultValue: 90}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'radialBlur', blockType: BlockType.COMMAND, text: 'radial blur type: [TYPE] value: [VALUE] center x: [X] y: [Y] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'polarType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 5}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'lensBlur', blockType: BlockType.COMMAND, text: 'lens blur radius: [RADIUS] shape: [SHAPE] rotation: [ROTATION] mix: [MIX] %', arguments: {RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, SHAPE: {type: ArgumentType.STRING, menu: 'lensShape'}, ROTATION: {type: ArgumentType.ANGLE, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'depthOfField', blockType: BlockType.COMMAND, text: 'depth of field focus: [FOCUS] range: [RANGE] aperture: [APERTURE] max blur: [MAXBLUR] near: [NEAR] % far: [FAR] % edge softness: [EDGE] shape: [SHAPE] rotation: [ROTATION] mix: [MIX] %', arguments: {FOCUS: {type: ArgumentType.NUMBER, defaultValue: 480}, RANGE: {type: ArgumentType.NUMBER, defaultValue: 24}, APERTURE: {type: ArgumentType.NUMBER, defaultValue: 48}, MAXBLUR: {type: ArgumentType.NUMBER, defaultValue: 24}, NEAR: {type: ArgumentType.NUMBER, defaultValue: 100}, FAR: {type: ArgumentType.NUMBER, defaultValue: 100}, EDGE: {type: ArgumentType.NUMBER, defaultValue: 8}, SHAPE: {type: ArgumentType.STRING, menu: 'lensShape'}, ROTATION: {type: ArgumentType.ANGLE, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'fog', blockType: BlockType.COMMAND, text: 'fog [TYPE] start: [START] end: [END] near color: [NEARCOLOR] far color: [FARCOLOR] density: [DENSITY] % curve: [CURVE] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'fogType'}, START: {type: ArgumentType.NUMBER, defaultValue: 100}, END: {type: ArgumentType.NUMBER, defaultValue: 1000}, NEARCOLOR: {type: ArgumentType.COLOR, defaultValue: '#d9e7f2'}, FARCOLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, DENSITY: {type: ArgumentType.NUMBER, defaultValue: 100}, CURVE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'lensDistortion', blockType: BlockType.COMMAND, text: 'lens distortion value: [VALUE] center x: [X] y: [Y] zoom: [ZOOM] % mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 25}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, ZOOM: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'bloom', blockType: BlockType.COMMAND, text: 'bloom threshold: [THRESHOLD] radius: [RADIUS] value: [VALUE] color: [COLOR] invert: [INVERT]', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.7}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}}},
                    {opcode: 'deepGlow', blockType: BlockType.COMMAND, text: 'deep glow threshold: [THRESHOLD] radius: [RADIUS] value: [VALUE] color: [COLOR]', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.7}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 8}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}}},
                    {opcode: 'edgeDetection', blockType: BlockType.COMMAND, text: 'edge detection threshold: [THRESHOLD] strength: [VALUE] radius: [RADIUS] softness: [SOFTNESS] color: [COLOR] background: [BACKGROUND] alpha: [ALPHA] % mix: [MIX] %', arguments: {THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.1}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, BACKGROUND: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, ALPHA: {type: ArgumentType.NUMBER, defaultValue: 100}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'sharpen', blockType: BlockType.COMMAND, text: 'sharpen value: [VALUE] radius: [RADIUS] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'fxaa', blockType: BlockType.COMMAND, text: 'FXAA contrast: [CONTRAST] relative: [RELATIVE] subpixel: [SUBPIXEL] mix: [MIX] %', arguments: {CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 0.0312}, RELATIVE: {type: ArgumentType.NUMBER, defaultValue: 0.063}, SUBPIXEL: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'differenceOfGaussians', blockType: BlockType.COMMAND, text: 'difference of gaussians sigma: [SIGMA] scale: [SCALE] tau: [TAU] threshold: [THRESHOLD] colored: [COLORED] ink: [COLOR] mix: [MIX] %', arguments: {SIGMA: {type: ArgumentType.NUMBER, defaultValue: 1}, SCALE: {type: ArgumentType.NUMBER, defaultValue: 1.6}, TAU: {type: ArgumentType.NUMBER, defaultValue: 0.98}, THRESHOLD: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLORED: {type: ArgumentType.STRING, menu: 'boolean'}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#101020'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'kuwahara', blockType: BlockType.COMMAND, text: 'kuwahara radius: [RADIUS] mix: [MIX] %', arguments: {RADIUS: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    '---',
                    {opcode: 'chromaticAberration', blockType: BlockType.COMMAND, text: 'chromatic aberration intensity: [INTENSITY] radius: [RADIUS] hardness: [HARDNESS] offset x: [X] y: [Y] mix: [MIX] %', arguments: {INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 2}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 1}, HARDNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'filmGrain', blockType: BlockType.COMMAND, text: 'film grain intensity: [INTENSITY] response: [RESPONSE] size: [SIZE] animate: [ANIMATE] mix: [MIX] %', arguments: {INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 0.15}, RESPONSE: {type: ArgumentType.NUMBER, defaultValue: 0.15}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 1}, ANIMATE: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'dither', blockType: BlockType.COMMAND, text: 'dither colors r: [R] g: [G] b: [B] spread: [SPREAD] scale: [SCALE] mix: [MIX] %', arguments: {R: {type: ArgumentType.NUMBER, defaultValue: 4}, G: {type: ArgumentType.NUMBER, defaultValue: 4}, B: {type: ArgumentType.NUMBER, defaultValue: 4}, SPREAD: {type: ArgumentType.NUMBER, defaultValue: 0.5}, SCALE: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'halftone', blockType: BlockType.COMMAND, text: 'CMYK halftone size: [SIZE] mix: [MIX] %', arguments: {SIZE: {type: ArgumentType.NUMBER, defaultValue: 4}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'ascii', blockType: BlockType.COMMAND, text: 'ASCII cell x: [X] y: [Y] foreground: [FG] background: [BG] invert: [INVERT] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 6}, Y: {type: ArgumentType.NUMBER, defaultValue: 8}, FG: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, BG: {type: ArgumentType.COLOR, defaultValue: '#000000'}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'crt', blockType: BlockType.COMMAND, text: 'CRT curvature: [CURVATURE] border: [BORDER] scan size: [SIZE] strength: [STRENGTH] mix: [MIX] %', arguments: {CURVATURE: {type: ArgumentType.NUMBER, defaultValue: 10}, BORDER: {type: ArgumentType.NUMBER, defaultValue: 0.08}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 2}, STRENGTH: {type: ArgumentType.NUMBER, defaultValue: 0.35}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'vhs', blockType: BlockType.COMMAND, text: 'VHS tracking: [TRACKING] px chroma bleed: [CHROMA] px noise: [NOISE] % scanlines: [SCANLINES] % seed: [SEED] evolution: [EVOLUTION] mix: [MIX] %', arguments: {TRACKING: {type: ArgumentType.NUMBER, defaultValue: 6}, CHROMA: {type: ArgumentType.NUMBER, defaultValue: 3}, NOISE: {type: ArgumentType.NUMBER, defaultValue: 12}, SCANLINES: {type: ArgumentType.NUMBER, defaultValue: 25}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'glitch', blockType: BlockType.COMMAND, text: 'digital glitch slices: [SLICES] shift: [SHIFT] px RGB split: [RGB] px density: [DENSITY] % seed: [SEED] evolution: [EVOLUTION] mix: [MIX] %', arguments: {SLICES: {type: ArgumentType.NUMBER, defaultValue: 24}, SHIFT: {type: ArgumentType.NUMBER, defaultValue: 28}, RGB: {type: ArgumentType.NUMBER, defaultValue: 6}, DENSITY: {type: ArgumentType.NUMBER, defaultValue: 35}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'vignette', blockType: BlockType.COMMAND, text: 'vignette color: [COLOR] size x: [X] y: [Y] offset x: [OFFSETX] y: [OFFSETY] intensity: [INTENSITY] roundness: [ROUNDNESS] softness: [SOFTNESS] mix: [MIX] %', arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, X: {type: ArgumentType.NUMBER, defaultValue: 1}, Y: {type: ArgumentType.NUMBER, defaultValue: 1}, OFFSETX: {type: ArgumentType.NUMBER, defaultValue: 0}, OFFSETY: {type: ArgumentType.NUMBER, defaultValue: 0}, INTENSITY: {type: ArgumentType.NUMBER, defaultValue: 1}, ROUNDNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 1}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'composition', blockType: BlockType.COMMAND, text: 'composition grid [DIVISIONS] divisions width: [WIDTH] color: [COLOR] opacity: [OPACITY] % mix: [MIX] %', arguments: {DIVISIONS: {type: ArgumentType.NUMBER, defaultValue: 3}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 1}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 50}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'framing', blockType: BlockType.COMMAND, text: 'frame [SHAPE] radius: [RADIUS] softness: [SOFTNESS] color: [COLOR] opacity: [OPACITY] % offset x: [X] y: [Y] mix: [MIX] %', arguments: {SHAPE: {type: ArgumentType.STRING, menu: 'frameShape'}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 0.45}, SOFTNESS: {type: ArgumentType.NUMBER, defaultValue: 0.02}, COLOR: {type: ArgumentType.COLOR, defaultValue: '#000000'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'zoom', blockType: BlockType.COMMAND, text: 'zoom scale: [VALUE] offset x: [X] y: [Y] sample: [SAMPLE] mix: [MIX] %', arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SAMPLE: {type: ArgumentType.STRING, menu: 'sampleMode'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'wavy', blockType: BlockType.COMMAND, text: 'wavy type: [TYPE] amount: [VALUE] size: [SIZE] complexity: [COMPLEXITY] evolution: [EVOLUTION] seed: [SEED] offset x: [X] y: [Y] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'turbulenceType'}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 8}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 64}, COMPLEXITY: {type: ArgumentType.NUMBER, defaultValue: 3}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, SEED: {type: ArgumentType.NUMBER, defaultValue: 0}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'fractalnoise', blockType: BlockType.COMMAND, text: 'fractal noise fractal type: [FRACTALTYPE] noise type: [NOISETYPE] invert: [INVERT] contrast: [CONTRAST] brightness: [BRIGHTNESS] overflow: [OVERFLOW] rotate: [ROTATE] scale: [SCALE] width: [WIDTH] height: [HEIGHT] random offset: [OX] [OY] perspective offset: [PERSPECTIVE] depth: [DEPTH] evolution: [EVOLUTION] cycle evolution: [CYCLEEVOLUTION] cycle: [FREQ]', arguments: {FRACTALTYPE: {type: ArgumentType.STRING, menu: 'fractalType'}, NOISETYPE: {type: ArgumentType.STRING, menu: 'fractalNoiseType'}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, CONTRAST: {type: ArgumentType.NUMBER, defaultValue: 100}, BRIGHTNESS: {type: ArgumentType.NUMBER, defaultValue: 0}, OVERFLOW: {type: ArgumentType.STRING, menu: 'fractalOverflowType'}, ROTATE: {type: ArgumentType.ANGLE, defaultValue: 0}, SCALE: {type: ArgumentType.NUMBER, defaultValue: 100}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 100}, HEIGHT: {type: ArgumentType.NUMBER, defaultValue: 100}, OX: {type: ArgumentType.NUMBER, defaultValue: 0}, OY: {type: ArgumentType.NUMBER, defaultValue: 0}, PERSPECTIVE: {type: ArgumentType.STRING, menu: 'boolean'}, DEPTH: {type: ArgumentType.NUMBER, defaultValue: 6}, EVOLUTION: {type: ArgumentType.NUMBER, defaultValue: 0}, CYCLEEVOLUTION: {type: ArgumentType.STRING, menu: 'boolean'}, FREQ: {type: ArgumentType.NUMBER, defaultValue: 1}}},
                    {opcode: 'pulse', blockType: BlockType.COMMAND, text: 'pulse center x: [X] y: [Y] radius: [RADIUS] value: [VALUE] width: [WIDTH] frequency: [FREQUENCY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, RADIUS: {type: ArgumentType.NUMBER, defaultValue: 80}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 12}, WIDTH: {type: ArgumentType.NUMBER, defaultValue: 18}, FREQUENCY: {type: ArgumentType.NUMBER, defaultValue: 0.55}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'pixelate', blockType: BlockType.COMMAND, text: 'pixelate size x: [X] y: [Y] offset x: [OFFSETX] y: [OFFSETY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 8}, Y: {type: ArgumentType.NUMBER, defaultValue: 8}, OFFSETX: {type: ArgumentType.NUMBER, defaultValue: 0}, OFFSETY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'pixelStretch', blockType: BlockType.COMMAND, text: 'pixel stretch type: [TYPE] position: [POSITION] size: [SIZE] sample width: [SAMPLE] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'stretchType'}, POSITION: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 100}, SAMPLE: {type: ArgumentType.NUMBER, defaultValue: 1}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'mirror', blockType: BlockType.COMMAND, text: 'mirror type: [TYPE] center x: [X] y: [Y] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'mirrorType'}, X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'transform', blockType: BlockType.COMMAND, text: 'transform x: [X] y: [Y] size: [SIZE] dir: [DIR] anchor x: [ANCHORX] y: [ANCHORY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 100}, DIR: {type: ArgumentType.ANGLE, defaultValue: 0}, ANCHORX: {type: ArgumentType.NUMBER, defaultValue: 0}, ANCHORY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'duplicate', blockType: BlockType.COMMAND, text: 'duplicate x: [X] y: [Y] size: [SIZE] dir: [DIR] anchor x: [ANCHORX] y: [ANCHORY] mix: [MIX] %', arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}, SIZE: {type: ArgumentType.NUMBER, defaultValue: 50}, DIR: {type: ArgumentType.ANGLE, defaultValue: 0}, ANCHORX: {type: ArgumentType.NUMBER, defaultValue: 0}, ANCHORY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'pixelSort', blockType: BlockType.COMMAND, text: 'pixelsort [TYPE] span: [SPAN] min: [MIN] max: [MAX] invert mask: [INVERT] sort by: [SORTBY] reverse: [REVERSE] gamma: [GAMMA] center x: [CENTERX] y: [CENTERY] mix: [MIX] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'sortAxis'}, SPAN: {type: ArgumentType.NUMBER, defaultValue: 64}, MIN: {type: ArgumentType.NUMBER, defaultValue: 0.4}, MAX: {type: ArgumentType.NUMBER, defaultValue: 0.72}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, SORTBY: {type: ArgumentType.STRING, menu: 'sortBy'}, REVERSE: {type: ArgumentType.STRING, menu: 'boolean'}, GAMMA: {type: ArgumentType.NUMBER, defaultValue: 1}, CENTERX: {type: ArgumentType.NUMBER, defaultValue: 0}, CENTERY: {type: ArgumentType.NUMBER, defaultValue: 0}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    {opcode: 'colorAdjustment', blockType: BlockType.COMMAND, text: 'color adjustment add: [ADD] mul: [MUL] div: [DIV] mix: [MIX] %', arguments: {ADD: {type: ArgumentType.COLOR, defaultValue: '#000000'}, MUL: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, DIV: {type: ArgumentType.COLOR, defaultValue: '#ffffff'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    '---',
                    {opcode: 'displacementMap', blockType: BlockType.COMMAND, text: 'displacement map costume: [COSTUME] value: [VALUE] type: [TYPE] channel: [CHANNEL] center: [CENTER] invert: [INVERT] mix: [MIX] %', arguments: {COSTUME: {type: ArgumentType.COSTUME}, VALUE: {type: ArgumentType.NUMBER, defaultValue: 10}, TYPE: {type: ArgumentType.STRING, menu: 'axisType'}, CHANNEL: {type: ArgumentType.STRING, menu: 'mapChannel'}, CENTER: {type: ArgumentType.NUMBER, defaultValue: 0.5}, INVERT: {type: ArgumentType.STRING, menu: 'boolean'}, MIX: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                    '---',
                    {opcode: 'stackCurrentDrawing', blockType: BlockType.COMMAND, text: 'stack current drawing weight: [WEIGHT] max samples: [LIMIT]', arguments: {WEIGHT: {type: ArgumentType.NUMBER, defaultValue: 1}, LIMIT: {type: ArgumentType.NUMBER, defaultValue: 10}}},
                    {opcode: 'renderBufferStack', blockType: BlockType.COMMAND, text: 'render stacked drawings using [MODE] clear after: [CLEAR]', arguments: {MODE: {type: ArgumentType.STRING, menu: 'bufferMode'}, CLEAR: {type: ArgumentType.STRING, menu: 'boolean'}}},
                    {opcode: 'clearBufferStack', blockType: BlockType.COMMAND, text: 'clear drawing stack'},
                    {opcode: 'bufferStackSize', blockType: BlockType.REPORTER, text: 'drawing stack samples'},
                    '---',
                    {opcode: 'setBlendMode', blockType: BlockType.COMMAND, text: 'use [TYPE] blending mode opacity: [OPACITY] %', arguments: {TYPE: {type: ArgumentType.STRING, menu: 'blendMode'}, OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}}}
                ],
                menus: {
                    rgbPair: {acceptReporters: true, items: ['RG', 'GB', 'BR']},
                    colorBlindType: {acceptReporters: true, items: ['deuteranopia', 'protanopia', 'tritanopia']},
                    toneMapType: {acceptReporters: true, items: ['clamp', 'aces hill', 'aces', 'reinhard']},
                    chromaBehavior: {acceptReporters: true, items: ['solid', 'gradient', 'transparent']},
                    gaussianType: {acceptReporters: true, items: ['normal', 'horizontal', 'vertical']},
                    lensShape: {acceptReporters: true, items: ['circle', 'hexagon', 'octagon']},
                    fogType: {acceptReporters: true, items: ['linear', 'smooth', 'exponential', 'exponential squared']},
                    polarType: {acceptReporters: true, items: ['dir', 'size']},
                    axisType: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
                    sortAxis: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
                    sortBy: {acceptReporters: true, items: ['luminance', 'saturation', 'hue']},
                    frameShape: {acceptReporters: true, items: ['rectangle', 'circle']},
                    sampleMode: {acceptReporters: true, items: ['clamp', 'mirror', 'wrap', 'border']},
                    stretchType: {acceptReporters: true, items: ['x', 'y', 'size', 'dir']},
                    turbulenceType: {acceptReporters: true, items: ['both', 'x', 'y', 'size', 'dir']},
                    fractalType: {acceptReporters: true, items: FRACTAL_TYPES},
                    fractalNoiseType: {acceptReporters: true, items: FRACTAL_NOISE_TYPES},
                    fractalOverflowType: {acceptReporters: true, items: FRACTAL_OVERFLOW_TYPES},
                    mapChannel: {acceptReporters: true, items: ['luminance', 'r', 'g', 'b', 'a']},
                    blobMode: {acceptReporters: true, items: ['bright', 'dark', 'color', 'motion', 'alpha']},
                    blobShape: {acceptReporters: true, items: ['rectangle', 'ellipse']},
                    bufferMode: {acceptReporters: true, items: ['average', 'add', 'lighten', 'darken']},
                    mirrorType: {acceptReporters: true, items: ['x', 'y', 'xy']},
                    boolean: {acceptReporters: true, items: ['false', 'true']},
                    blendMode: {acceptReporters: true, items: BLEND_MODES}
                }
            };
        }

        _getEngine() {
            if (!this.engine) this.engine = new PenFXEngine();
            return this.engine;
        }

        _executeSafe(callback, blendMode, blendOpacity) {
            const previousBlendMode = this.blendMode;
            const previousBlendOpacity = this.blendOpacity;
            let engine;
            try {
                this.blendMode = blendMode;
                this.blendOpacity = blendOpacity;
                engine = this._getEngine();
                engine.blendOpacity = this.blendOpacity;
                callback(engine);
            } catch (error) {
                console.error('[Pen FX]', error);
            } finally {
                // _prepare disables blending before compiling the selected program. If compilation or rendering fails,
                // leaving that state active makes the transparent Pen framebuffer cover the stage as opaque black.
                if (engine && typeof engine._restoreGLState === 'function') engine._restoreGLState();
                this.blendMode = previousBlendMode;
                this.blendOpacity = previousBlendOpacity;
            }
        }

        _safe(callback) {
            if (this.effectCaptureStack.length) {
                this.effectCaptureStack[this.effectCaptureStack.length - 1].push({
                    blendMode: this.blendMode,
                    blendOpacity: this.blendOpacity,
                    callback
                });
                return;
            }
            const movieAssetManager = vm.runtime.movieAssetManager;
            if (movieAssetManager && typeof movieAssetManager.enqueueFrameGraphEffect === 'function' &&
                movieAssetManager.enqueueFrameGraphEffect({
                    blendMode: this.blendMode,
                    blendOpacity: this.blendOpacity,
                    callback
                })) return;
            this._executeSafe(callback, this.blendMode, this.blendOpacity);
        }

        beginEffectCapture() {
            this.effectCaptureStack.push([]);
        }

        endEffectCapture() {
            return this.effectCaptureStack.pop() || [];
        }

        applyCapturedEffects(effects) {
            for (const effect of effects || []) {
                this._executeSafe(effect.callback, effect.blendMode, effect.blendOpacity);
            }
        }

        beginGroup() { this._safe(engine => engine.beginGroup()); }
        endGroup(options) { this._safe(engine => engine.endGroup(options)); }
        drawRenderPass(name, options) { this._safe(engine => engine.drawRenderPass(name, options)); }
        clearRenderPass(name) {
            if (!this.engine) return;
            this._safe(engine => engine.clearRenderPass(name));
        }
        clearRenderPasses() {
            if (!this.engine) return;
            this._safe(engine => engine.clearRenderPasses());
        }

        beginMatte() {
            try {
                return this._getEngine().beginMatte();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        beginMatteMask() {
            try {
                return this._getEngine().beginMatteMask();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        endMatte(options) {
            try {
                return this._getEngine().endMatte(options);
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        beginFrame() {
            try {
                return this._getEngine().beginFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        commitFrame() {
            try {
                return this._getEngine().commitFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        cancelFrame() {
            try {
                return this._getEngine().cancelFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        cancelGroups() {
            this.effectCaptureStack.length = 0;
            if (!this.engine) return;
            try {
                this.engine.clearGroupStack();
                this.engine.clearMatteStack();
                this.engine._restoreGLState();
            } catch (error) {
                console.error('[Pen FX]', error);
            }
        }

        drawDefaultBackground(color4f) {
            const pen = vm.runtime.ext_pen;
            if (pen && typeof pen._getPenLayerID === 'function') pen._getPenLayerID();
            try {
                this._getEngine().drawDefaultBackground(color4f);
            } catch (error) {
                console.error('[Pen FX]', error);
            }
        }

        setBlendMode(args) {
            const mode = String(args.TYPE);
            this.blendMode = BLEND_MODES.includes(mode) ? mode : 'normal';
            this.blendOpacity = mixAmount(args.OPACITY);
        }
    }

    installEffects({Engine: PenFXEngine, PenFX, vm});
    return PenFX;
};

const installPenFX = vm => {
    const extensionManager = vm.extensionManager;
    if (extensionManager.isExtensionLoaded('penfx')) return vm;

    const PenFX = createPenFXClass(vm);
    extensionManager.addBuiltinExtension('penfx', PenFX);
    extensionManager.loadExtensionIdSync('penfx');
    return vm;
};

export {createPenFXClass};
export default installPenFX;
