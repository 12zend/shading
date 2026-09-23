/* eslint-disable */

import defaultShaderManifest from './default-shader-package/shading-shader.json';
import {catalog as genshadeCatalog, genshadeOpcode} from './genshade';
import {BLEND_MODES} from './constants';
import {mixAmount} from './helpers';
import {localize} from '../movie-block-l10n';

// Easy blocks apply a finished look from one menu choice. Each preset is a recipe of existing PenFX blocks: a step
// names a built-in block by its opcode (with only the arguments that differ from the block's defaults) or a
// Genshade effect by its catalog id (with the ReShade uniforms that differ from the shader's defaults).
// The Easy mix scales every step's own mix, or the listed strength argument of blocks that have no mix input.
// A step can name a blend mode when it only produces a layer, such as outlines multiplied over the image.

const STRENGTH_ARGUMENTS = {bloom: 'VALUE', deepGlow: 'VALUE'};

const glowPresets = [
    ['soft', 'Soft Glow', 'ソフトグロー', [['bloom', {THRESHOLD: 0.65, RADIUS: 16, VALUE: 0.5}]]],
    ['soft', 'Dreamy', 'ドリーミー', [
        ['bloom', {THRESHOLD: 0.5, RADIUS: 24, VALUE: 0.5}],
        ['gaussianBlur', {VALUE: 3, MIX: 35}]
    ]],
    ['soft', 'Highlight Bloom', 'ハイライトブルーム', [['bloom', {THRESHOLD: 0.8, RADIUS: 16, VALUE: 0.8}]]],
    ['soft', 'Warm Glow', 'ウォームグロー', [['bloom', {THRESHOLD: 0.6, RADIUS: 18, VALUE: 0.6, COLOR: '#ffb070'}]]],
    ['soft', 'Cool Glow', 'クールグロー', [['bloom', {THRESHOLD: 0.6, RADIUS: 18, VALUE: 0.6, COLOR: '#9cc8ff'}]]],
    ['neon', 'Neon', 'ネオン', [['deepGlow', {THRESHOLD: 0.7, RADIUS: 16, VALUE: 0.4}]]],
    ['neon', 'Neon Pink', 'ネオンピンク', [['deepGlow', {THRESHOLD: 0.65, RADIUS: 18, VALUE: 0.45, COLOR: '#ff4fd8'}]]],
    ['neon', 'Neon Cyan', 'ネオンシアン', [['deepGlow', {THRESHOLD: 0.65, RADIUS: 18, VALUE: 0.45, COLOR: '#35e8ff'}]]],
    ['neon', 'Deep Glow', 'ディープグロー', [['deepGlow', {THRESHOLD: 0.7, RADIUS: 32, VALUE: 0.35}]]],
    ['neon', 'Neon Outline', 'ネオン輪郭', [
        ['edgeDetection', {THRESHOLD: 0.08, VALUE: 1.5, COLOR: '#40f0ff', BACKGROUND: '#000000', ALPHA: 100}],
        ['deepGlow', {THRESHOLD: 0.3, RADIUS: 12, VALUE: 0.6, COLOR: '#40f0ff'}]
    ]],
    ['lens', 'Film Bloom', 'フィルムブルーム', [['genshade-quint-quint-bloom-bloom', {
        BLOOM_INTENSITY: 0.8, BLOOM_ADAPT_STRENGTH: 0
    }]]],
    ['lens', 'Neo Bloom', 'ネオブルーム', [['genshade-neobloom-neobloom', {}]]],
    ['lens', 'Anamorphic Flare', 'アナモルフィックフレア', [['genshade-bloom-bloomandlensflares', {
        bAnamFlareEnable: 1, fAnamFlareThreshold: 0.8, fBloomAmount: 0.6
    }]]],
    ['lens', 'Lens Flare', 'レンズフレア', [['genshade-bloom-bloomandlensflares', {
        bLenzEnable: 1, bChapFlareEnable: 1, fLenzThreshold: 0.7, fChapFlareTreshold: 0.8, fBloomAmount: 0.5
    }]]],
    ['lens', 'Hex Flare', 'ヘックスフレア', [['genshade-hexlensflare-hexlensflare', {uThreshold: 0.8, uIntensity: 1.5}]]],
    ['lens', 'Unreal Lens', 'アンリアルレンズ', [['genshade-unreallens-unreallens', {Brightness: 0.8, Threshold: 0.4}]]]
];

const blurPresets = [
    ['soft', 'Soft Blur', 'ソフトぼかし', [['gaussianBlur', {VALUE: 3}]]],
    ['soft', 'Strong Blur', '強いぼかし', [['gaussianBlur', {VALUE: 12}]]],
    ['soft', 'Soft Focus', 'ソフトフォーカス', [
        ['gaussianBlur', {VALUE: 6, MIX: 45}],
        ['bloom', {THRESHOLD: 0.7, RADIUS: 12, VALUE: 0.3}]
    ]],
    ['soft', 'Frosted Glass', 'すりガラス', [
        ['gaussianBlur', {VALUE: 8}],
        ['filmGrain', {INTENSITY: 0.2, RESPONSE: 0, SIZE: 1.5}]
    ]],
    ['soft', 'Skin Smoothing', '美肌', [['genshade-surfaceblur-surfaceblur', {BlurRadius: 3, BlurEdge: 1.5}]]],
    ['motion', 'Motion Blur', 'モーションブラー', [['directionalBlur', {DIR: 90, VALUE: 16}]]],
    ['motion', 'Vertical Motion', '縦モーション', [['directionalBlur', {DIR: 0, VALUE: 16}]]],
    ['motion', 'Speed Lines', 'スピード線', [['gaussianBlur', {TYPE: 'horizontal', VALUE: 24}]]],
    ['motion', 'Zoom Burst', 'ズームバースト', [['radialBlur', {TYPE: 'size', VALUE: 20}]]],
    ['motion', 'Spin', 'スピン', [['radialBlur', {TYPE: 'dir', VALUE: 8}]]],
    ['lens', 'Bokeh', 'ボケ', [['lensBlur', {RADIUS: 8, SHAPE: 'circle'}]]],
    ['lens', 'Hexagon Bokeh', '六角ボケ', [['lensBlur', {RADIUS: 10, SHAPE: 'hexagon'}]]],
    ['lens', 'Tilt Shift', 'ティルトシフト', [['genshade-fubax-tiltshift-tiltshift', {BlurMultiplier: 12, Offset: 0}]]]
];

const lensPresets = [
    ['frame', 'Soft Vignette', 'ソフトビネット', [['vignette', {INTENSITY: 0.6, SOFTNESS: 1.2}]]],
    ['frame', 'Dark Vignette', 'ダークビネット', [['vignette', {INTENSITY: 1.4, SOFTNESS: 0.7}]]],
    ['frame', 'White Vignette', 'ホワイトビネット', [['vignette', {COLOR: '#ffffff', INTENSITY: 0.9, SOFTNESS: 1}]]],
    // A near-square vignette profile gives hard top and bottom bars: 2.39:1 and about 1.96:1 on a 16:9 stage.
    ['frame', 'Cinema Bars', 'シネマバー', [['vignette', {X: 0, Y: 2.69, INTENSITY: 1, ROUNDNESS: 40, SOFTNESS: 1}]]],
    ['frame', 'Thin Cinema Bars', '細いシネマバー', [['vignette', {X: 0, Y: 2.2, INTENSITY: 1, ROUNDNESS: 40, SOFTNESS: 1}]]],
    ['frame', 'Round Frame', '丸フレーム', [['framing', {SHAPE: 'circle', RADIUS: 0.48, SOFTNESS: 0.08}]]],
    ['optics', 'Chromatic Aberration', '色収差', [['chromaticAberration', {INTENSITY: 2}]]],
    ['optics', 'Strong Aberration', '強い色収差', [['chromaticAberration', {INTENSITY: 6, HARDNESS: 0.6}]]],
    ['optics', 'Prism', 'プリズム', [['genshade-fubax-prism-chromaticaberration', {Aberration: 24}]]],
    // Barrel distortion pulls the edges in, so these zoom back out to fill the stage.
    ['optics', 'Fisheye', '魚眼', [['lensDistortion', {VALUE: 45, ZOOM: 220}]]],
    ['optics', 'Barrel', 'たる型', [['lensDistortion', {VALUE: 18, ZOOM: 150}]]],
    ['optics', 'Pincushion', '糸巻き型', [['lensDistortion', {VALUE: -3}]]],
    ['film', 'Fine Grain', '細かい粒子', [['filmGrain', {INTENSITY: 0.12, SIZE: 1, ANIMATE: 'true'}]]],
    ['film', 'Heavy Grain', '粗い粒子', [['filmGrain', {INTENSITY: 0.35, SIZE: 2, ANIMATE: 'true'}]]],
    ['film', 'Old Film', '古いフィルム', [
        ['colorGrade', {SATURATION: -0.35, TEMP: 0.25, CONTRAST: 0.9}],
        ['filmGrain', {INTENSITY: 0.3, SIZE: 1.6, ANIMATE: 'true'}],
        ['vignette', {INTENSITY: 1.1, SOFTNESS: 0.9}]
    ]],
    ['film', 'Home Video', 'ホームビデオ', [
        ['chromaticAberration', {INTENSITY: 2.5}],
        ['filmGrain', {INTENSITY: 0.18, ANIMATE: 'true'}],
        ['vignette', {INTENSITY: 0.7}]
    ]],
    ['film', 'Night Vision', '暗視スコープ', [
        ['paletteSwap', {C1: '#000800', C2: '#0b4012', C3: '#3fcf4a', C4: '#d8ffd0'}],
        ['filmGrain', {INTENSITY: 0.3, SIZE: 1.2, ANIMATE: 'true'}],
        ['vignette', {INTENSITY: 1.3, ROUNDNESS: 1, SOFTNESS: 0.6}]
    ]]
];

const stylizePresets = [
    ['paint', 'Oil Paint', '油絵', [['kuwahara', {RADIUS: 5}]]],
    ['paint', 'Thick Paint', '厚塗り', [['kuwahara', {RADIUS: 9}]]],
    ['paint', 'Watercolor', '水彩', [
        ['kuwahara', {RADIUS: 4}],
        ['colorSpaceAdjust', {SMUL: 0.85, LADD: 0.04}],
        ['filmGrain', {INTENSITY: 0.08, RESPONSE: 0, SIZE: 2}]
    ]],
    ['paint', 'Cartoon', 'カートゥーン', [
        ['kuwahara', {RADIUS: 3}],
        ['genshade-daodan-colorfulposter-colorfulposter', {iUILumaLevels: 6, fUITint: 0.3}],
        ['edgeDetection', {
            THRESHOLD: 0.06, VALUE: 2, RADIUS: 1.5, COLOR: '#141414', BACKGROUND: '#ffffff', ALPHA: 100
        }, {blend: 'mul'}]
    ]],
    ['paint', 'Comic', 'コミック', [['genshade-daodan-comic-comic', {}]]],
    ['line', 'Ink Outline', 'インク線画', [['differenceOfGaussians', {}]]],
    ['line', 'Pencil', '鉛筆画', [
        ['edgeDetection', {THRESHOLD: 0.06, COLOR: '#303030', BACKGROUND: '#f4f1ea', ALPHA: 100}],
        ['filmGrain', {INTENSITY: 0.1, RESPONSE: 0}]
    ]],
    ['line', 'Sketch', 'スケッチ', [['genshade-sketch-sketch', {}]]],
    ['line', 'Blueprint', '青写真', [
        ['edgeDetection', {THRESHOLD: 0.06, COLOR: '#e6f2ff', BACKGROUND: '#18467e', ALPHA: 100}]
    ]],
    ['print', 'Poster', 'ポスター', [['genshade-daodan-colorfulposter-colorfulposter', {iUILumaLevels: 5, fUITint: 0.3}]]],
    ['print', 'Pop Art', 'ポップアート', [['genshade-daodan-multitoneposter-multitoneposter', {}]]],
    ['print', 'Halftone', 'ハーフトーン', [['halftone', {SIZE: 4}]]],
    ['print', 'Large Halftone', '大きな網点', [['halftone', {SIZE: 8}]]],
    ['print', 'ASCII', 'アスキーアート', [['ascii', {}]]],
    ['print', 'Green Terminal', 'グリーン端末', [['ascii', {FG: '#40ff70', BG: '#001a08'}]]]
];

const retroPresets = [
    ['tv', 'VHS', 'VHS', [['vhs', {}]]],
    ['tv', 'Worn VHS', '劣化VHS', [['vhs', {TRACKING: 12, CHROMA: 6, NOISE: 25, SCANLINES: 40}]]],
    ['tv', 'CRT', 'ブラウン管', [['crt', {}]]],
    ['tv', 'Scanline Monitor', 'スキャンラインモニター', [['genshade-crt-advancedcrt', {}]]],
    ['glitch', 'Digital Glitch', 'デジタルグリッチ', [['glitch', {}]]],
    ['glitch', 'Heavy Glitch', '強いグリッチ', [['glitch', {SLICES: 40, SHIFT: 60, RGB: 12, DENSITY: 60}]]],
    ['glitch', 'RGB Split', 'RGBずれ', [['rgbShift', {VALUE: 6}]]],
    ['pixel', 'Pixel Art', 'ドット絵', [['pixelate', {X: 6, Y: 6}]]],
    ['pixel', 'Chunky Pixels', '大きなドット', [['pixelate', {X: 16, Y: 16}]]],
    ['pixel', '8-bit', '8ビット', [
        ['pixelate', {X: 4, Y: 4}],
        ['dither', {R: 3, G: 3, B: 3, SPREAD: 0.4, SCALE: 4}]
    ]],
    ['pixel', 'Handheld', '携帯ゲーム機', [
        ['pixelate', {X: 4, Y: 4}],
        ['paletteSwap', {C1: '#0f380f', C2: '#306230', C3: '#8bac0f', C4: '#9bbc0f'}]
    ]],
    ['pixel', 'Dither', 'ディザ', [['dither', {}]]],
    ['pixel', 'Home Computer', 'ホームコンピュータ', [['genshade-nostalgia-nostalgia', {Nostalgia_palette: 1, Nostalgia_scanlines: 0}]]],
    ['pixel', 'EGA', 'EGA', [['genshade-nostalgia-nostalgia', {Nostalgia_palette: 2, Nostalgia_scanlines: 0}]]],
    ['pixel', '3D Accelerator', '3Dアクセラレータ', [['genshade-3dfx-leifx-tech', {}]]]
];

const distortPresets = [
    ['wave', 'Wavy', 'ゆらゆら', [['wavy', {}]]],
    ['wave', 'Water Ripple', '水面', [['wavy', {VALUE: 5, SIZE: 24, COMPLEXITY: 2}]]],
    ['wave', 'Heat Haze', '陽炎', [['wavy', {TYPE: 'y', VALUE: 3, SIZE: 12, COMPLEXITY: 4}]]],
    ['wave', 'Sine Wave', 'サイン波', [['genshade-wave-wave', {amplitude: 0.04, period: 4}]]],
    // The warp shaders' default coordinates (0.25, 0.25) are the center of the stage.
    ['wave', 'Ripple', '波紋', [['genshade-zigzag-zigzag', {radius: 0.7, amplitude: 2}]]],
    ['warp', 'Swirl', 'うず巻き', [['genshade-swirl-swirl', {radius: 0.6, angle: 240}]]],
    ['warp', 'Bulge', 'ふくらみ', [['genshade-bulgepinch-bulgepinch', {radius: 0.6, magnitude: 0.6}]]],
    ['warp', 'Pinch', 'すぼみ', [['genshade-bulgepinch-bulgepinch', {radius: 0.6, magnitude: -0.6}]]],
    ['mirror', 'Flip Horizontal', '左右反転', [['mirror', {TYPE: 'x'}]]],
    ['mirror', 'Flip Vertical', '上下反転', [['mirror', {TYPE: 'y'}]]],
    ['mirror', 'Tile', 'タイル', [['duplicate', {SIZE: 50}]]],
    ['sort', 'Pixel Sort', 'ピクセルソート', [['pixelSort', {}]]],
    ['sort', 'Vertical Sort', '縦ピクセルソート', [['pixelSort', {TYPE: 'y'}]]],
    ['sort', 'Pixel Stretch', 'ピクセルストレッチ', [['pixelStretch', {}]]]
];

const detailPresets = [
    ['sharp', 'Sharpen', 'シャープ', [['sharpen', {VALUE: 1}]]],
    ['sharp', 'Strong Sharpen', '強いシャープ', [['sharpen', {VALUE: 2.5}]]],
    ['sharp', 'Adaptive Sharpen', 'アダプティブシャープ', [['genshade-cas-contrastadaptivesharpen', {Sharpening: 1}]]],
    ['sharp', 'Luma Sharpen', 'ルマシャープ', [['genshade-lumasharpen-lumasharpen', {sharp_strength: 1.2}]]],
    ['sharp', 'Clarity', 'クラリティ', [['genshade-astrayfx-clarity-clarity', {ClarityStrength: 0.6}]]],
    ['clean', 'Smooth Edges', 'アンチエイリアス', [['fxaa', {}]]],
    ['clean', 'Deband', 'バンディング除去', [['genshade-deband-deband', {}]]],
    ['clean', 'Dehaze', 'かすみ除去', [['genshade-dehaze-dehaze', {}]]]
];

const EASY_BLOCKS = [
    {
        opcode: 'easyGlow',
        menu: 'easyGlowPresets',
        text: ['glow [PRESET] mix: [MIX] %', 'グロー [PRESET] 混合: [MIX] %'],
        categories: [['soft', 'Soft', 'ソフト'], ['neon', 'Neon', 'ネオン'], ['lens', 'Bloom & Flare', 'ブルーム・フレア']],
        presets: glowPresets
    },
    {
        opcode: 'easyBlur',
        menu: 'easyBlurPresets',
        text: ['blur [PRESET] mix: [MIX] %', 'ぼかし [PRESET] 混合: [MIX] %'],
        categories: [['soft', 'Soft', 'ソフト'], ['motion', 'Motion', 'モーション'], ['lens', 'Lens', 'レンズ']],
        presets: blurPresets
    },
    {
        opcode: 'easyLens',
        menu: 'easyLensPresets',
        text: ['lens & film [PRESET] mix: [MIX] %', 'レンズ・フィルム [PRESET] 混合: [MIX] %'],
        categories: [['frame', 'Frame', 'フレーム'], ['optics', 'Optics', '光学'], ['film', 'Film & Camera', 'フィルム・カメラ']],
        presets: lensPresets
    },
    {
        opcode: 'easyStylize',
        menu: 'easyStylizePresets',
        text: ['art style [PRESET] mix: [MIX] %', 'アート [PRESET] 混合: [MIX] %'],
        categories: [['paint', 'Paint', '絵画'], ['line', 'Line Art', '線画'], ['print', 'Print & Text', '印刷・文字']],
        presets: stylizePresets
    },
    {
        opcode: 'easyRetro',
        menu: 'easyRetroPresets',
        text: ['retro [PRESET] mix: [MIX] %', 'レトロ [PRESET] 混合: [MIX] %'],
        categories: [['tv', 'TV & Tape', 'テレビ・テープ'], ['glitch', 'Glitch', 'グリッチ'], ['pixel', 'Pixel & Games', 'ドット・ゲーム']],
        presets: retroPresets
    },
    {
        opcode: 'easyDistort',
        menu: 'easyDistortPresets',
        text: ['distort [PRESET] mix: [MIX] %', 'ゆがみ [PRESET] 混合: [MIX] %'],
        categories: [['wave', 'Waves', '波'], ['warp', 'Warp', 'ワープ'], ['mirror', 'Flip & Tile', '反転・タイル'],
            ['sort', 'Pixel Sort', 'ピクセルソート']],
        presets: distortPresets
    },
    {
        opcode: 'easyDetail',
        menu: 'easyDetailPresets',
        text: ['sharpen & clean up [PRESET] mix: [MIX] %', 'シャープ・補正 [PRESET] 混合: [MIX] %'],
        categories: [['sharp', 'Sharpen', 'シャープ'], ['clean', 'Clean Up', '補正']],
        presets: detailPresets
    }
];

const presetId = name => String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const BUILTIN_DEFAULTS = new Map(defaultShaderManifest.blocks.map(block => {
    const defaults = {};
    for (const input of block.inputs || []) {
        if (input.defaultValue !== undefined && input.defaultValue !== null) defaults[input.id] = input.defaultValue;
    }
    return [block.opcode || block.implementation.opcode, defaults];
}));
const GENSHADE_IDS = new Set(genshadeCatalog.map(descriptor => descriptor.id));

const compileStep = ([block, settings, options = {}]) => {
    const blend = options.blend || null;
    if (blend && !BLEND_MODES.includes(blend)) throw new Error(`Unknown Easy blend mode: ${blend}`);
    if (GENSHADE_IDS.has(block)) {
        // The Genshade blocks still accept their legacy JSON settings argument, so the preset keeps ReShade
        // uniform names instead of depending on the generated argument order.
        return {method: genshadeOpcode({id: block}), args: {SETTINGS: JSON.stringify(settings)}, strength: 'MIX', blend};
    }
    const defaults = BUILTIN_DEFAULTS.get(block);
    if (!defaults) throw new Error(`Unknown Easy step: ${block}`);
    const strength = STRENGTH_ARGUMENTS[block] || 'MIX';
    const args = Object.assign({}, defaults, settings);
    if (strength === 'MIX' && args.MIX === undefined) args.MIX = 100;
    return {method: block, args, strength, blend};
};

const easyBlocks = EASY_BLOCKS.map(definition => {
    const categories = definition.categories.map(([id, name, ja]) => ({id, name, ja}));
    const presets = definition.presets.map(([category, name, ja, steps]) => Object.freeze({
        id: presetId(name),
        name,
        ja,
        category,
        steps: Object.freeze(steps.map(compileStep))
    }));
    const byId = new Map(presets.map(preset => [preset.id, preset]));
    const byName = new Map();
    for (const preset of presets) {
        byName.set(preset.name.toLowerCase(), preset);
        byName.set(preset.ja, preset);
    }
    return Object.freeze(Object.assign({}, definition, {categories, presets, byId, byName}));
});
const EASY_BLOCKS_BY_OPCODE = new Map(easyBlocks.map(block => [block.opcode, block]));

// Block arguments may come from reporters, so accept the stored id or either displayed name.
const findEasyPreset = (opcode, value) => {
    const block = EASY_BLOCKS_BY_OPCODE.get(opcode);
    if (!block) return null;
    const key = String(typeof value === 'undefined' || value === null ? '' : value).trim();
    return block.byId.get(key) || block.byName.get(key.toLowerCase()) || block.byName.get(key) ||
        block.byId.get(presetId(key)) || null;
};

const presetName = (preset, locale) => localize(locale, preset.name, preset.ja);

const easyToolboxBlocks = (locale, ArgumentType, BlockType) => easyBlocks.map(block => ({
    opcode: block.opcode,
    func: block.opcode,
    blockType: BlockType.COMMAND,
    text: localize(locale, block.text[0], block.text[1]),
    arguments: {
        PRESET: {type: ArgumentType.STRING, menu: block.menu, defaultValue: block.presets[0].id},
        MIX: {type: ArgumentType.NUMBER, defaultValue: 100}
    }
}));

const easyMenus = locale => {
    const menus = {};
    for (const block of easyBlocks) {
        menus[block.menu] = {
            acceptReporters: true,
            items: block.presets.map(preset => ({text: presetName(preset, locale), value: preset.id}))
        };
    }
    return menus;
};

// Every step goes through the block's public method, so it gets the same program overrides, group scope and frame
// transaction as the standalone block. The steps only queue their effects; nothing here waits.
const runEasySteps = (penFX, preset, mix, util) => {
    for (const step of preset.steps) {
        const method = penFX[step.method];
        if (typeof method !== 'function') continue;
        const args = Object.assign({}, step.args);
        const base = Number(args[step.strength]);
        args[step.strength] = (Number.isFinite(base) ? base : 100) * mix;
        if (!step.blend) {
            method.call(penFX, args, util);
            continue;
        }
        // Effects record the blend mode when they are queued, so the override only has to span the call.
        const previousBlendMode = penFX.blendMode;
        penFX.blendMode = step.blend;
        try {
            method.call(penFX, args, util);
        } finally {
            penFX.blendMode = previousBlendMode;
        }
    }
};

const currentBlockId = util => {
    const thread = util && util.thread;
    return thread && typeof thread.peekStack === 'function' ? thread.peekStack() || null : null;
};

const installEasy = PenFX => {
    for (const block of easyBlocks) {
        PenFX.prototype[block.opcode] = function (args, util) {
            const preset = findEasyPreset(block.opcode, args.PRESET);
            if (!preset) return;
            const blockId = currentBlockId(util);
            if (typeof this._hasEasyPreviewListener === 'function' && this._hasEasyPreviewListener(blockId)) {
                this._safe(engine => this._captureEasyPreview(engine, blockId), {target: util && util.target});
            }
            const mix = mixAmount(args.MIX);
            if (mix <= 0) return;
            runEasySteps(this, preset, mix, util);
        };
    }

    // Queues a preset's effects without the preview capture, for the Easy picker's thumbnail renderer.
    PenFX.prototype.runEasyPreset = function (opcode, presetValue, mix = 1, util = null) {
        const preset = findEasyPreset(opcode, presetValue);
        if (preset && mix > 0) runEasySteps(this, preset, mix, util);
    };
};

export {
    EASY_BLOCKS_BY_OPCODE,
    easyBlocks,
    easyMenus,
    easyToolboxBlocks,
    findEasyPreset,
    installEasy,
    presetName
};
