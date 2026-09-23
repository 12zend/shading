// Converts an Easy color grading preset into the shader's packed uniforms. The block primitive and the
// GUI thumbnail renderer share this function so previews match what the render transaction draws.

const FILM_STOCKS = {print: 1, negative: 2, slide: 3, bleach: 4, mono: 5, cine: 6};
const DEGREES = Math.PI / 180;

const num = (value, fallback = 0) => {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
};

const percent = (value, fallback = 0) => num(value, fallback) / 100;

const rgb = (value, fallback) => {
    const hex = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
};

const triple = (values, fallback = [0, 0, 0]) => [0, 1, 2].map(index => percent(
    Array.isArray(values) ? values[index] : null,
    fallback[index]
));

const six = (values, scale) => {
    const list = [0, 1, 2, 3, 4, 5].map(index => num(Array.isArray(values) ? values[index] : 0) * scale);
    return [list.slice(0, 3), list.slice(3)];
};

const colorGradingUniforms = (preset = {}) => {
    const primary = preset.primary || {};
    const wheels = preset.wheels || {};
    const curve = Array.isArray(preset.curve) ? preset.curve : [0, 25, 50, 75, 100];
    const mojo = preset.mojo || {};
    const mixer = preset.mixer || {};
    const hueCurves = preset.hueCurves || {};
    const secondary = preset.hslSecondary || {};
    const film = preset.filmLut || {};
    const remap = preset.colorRemap || {};
    const duotone = preset.duotone || {};
    const shoulder = preset.shoulder || {};
    const posterize = preset.posterize || {};
    const grain = preset.grain || {};
    const sharpen = preset.sharpen || {};
    const spectrum = preset.rgbSpectrum || {};
    const lens = preset.lensDistortion || {};
    const breath = preset.filmBreath || {};
    const key = preset.hslKey || {};
    const vignette = preset.vignette || {};
    const diffuse = preset.diffuse || {};
    const halation = preset.halation || {};
    const [hueShiftA, hueShiftB] = six(hueCurves.hue, DEGREES);
    const [hueSatA, hueSatB] = six(hueCurves.saturation, 0.01);
    const [hueLumA, hueLumB] = six(hueCurves.luminance, 0.01);
    return {
        u_primaryA: [percent(primary.temperature), percent(primary.tint), num(primary.exposure),
            percent(primary.strength, 100)],
        u_primaryB: [percent(primary.contrast), percent(primary.highlights), percent(primary.shadows),
            percent(primary.whites)],
        u_primaryC: [percent(primary.blacks), percent(primary.saturation), percent(primary.vibrance),
            num(primary.hue) * DEGREES],
        u_primaryD: [percent(primary.highlightBoost), percent(primary.highlightRolloff),
            percent(primary.outputBlack), percent(primary.outputWhite, 100)],
        u_wheelShadows: triple(wheels.shadows),
        u_wheelMidtones: triple(wheels.midtones),
        u_wheelHighlights: triple(wheels.highlights),
        u_curveA: [percent(curve[0], 0), percent(curve[1], 25), percent(curve[2], 50)],
        u_curveB: [percent(curve[3], 75), percent(curve[4], 100)],
        u_mojo: [percent(mojo.amount), percent(mojo.protect, 70)],
        u_mixerR: triple(mixer.red, [100, 0, 0]),
        u_mixerG: triple(mixer.green, [0, 100, 0]),
        u_mixerB: triple(mixer.blue, [0, 0, 100]),
        u_hueShiftA: hueShiftA,
        u_hueShiftB: hueShiftB,
        u_hueSatA: hueSatA,
        u_hueSatB: hueSatB,
        u_hueLumA: hueLumA,
        u_hueLumB: hueLumB,
        u_secondaryRange: [
            (((num(secondary.hue) % 360) + 360) % 360) / 360,
            typeof secondary.width === 'undefined' && typeof secondary.hue === 'undefined' ? 0 :
                num(secondary.width, 40) / 360,
            num(secondary.softness, 20) / 360
        ],
        u_secondaryAdjust: [num(secondary.shift) / 360, percent(secondary.saturation), percent(secondary.lightness)],
        u_film: [FILM_STOCKS[film.stock] || 0, FILM_STOCKS[film.stock] ? percent(film.amount, 100) : 0],
        u_remapShadow: rgb(remap.shadow, '#000000'),
        u_remapMid: rgb(remap.mid, '#808080'),
        u_remapHigh: rgb(remap.highlight, '#ffffff'),
        u_remapAmount: percent(remap.amount),
        u_duoDark: rgb(duotone.dark, '#000000'),
        u_duoLight: rgb(duotone.light, '#ffffff'),
        u_duoAmount: percent(duotone.amount),
        u_shoulder: [percent(shoulder.amount), percent(shoulder.start, 70)],
        u_posterize: [Math.max(0, Math.round(num(posterize.levels))), percent(posterize.amount, 100)],
        u_grain: [percent(grain.amount), Math.max(1, num(grain.size, 1.2)), percent(grain.color)],
        u_sharpen: [percent(sharpen.amount) * 1.5, Math.max(0.5, num(sharpen.radius, 1))],
        u_spectrum: percent(spectrum.amount) * 0.012,
        u_lens: percent(lens.amount) * 0.25,
        u_breath: [percent(breath.amount), Math.max(0.01, num(breath.speed, 1))],
        u_key: [
            (((num(key.hue) % 360) + 360) % 360) / 360,
            typeof key.hue === 'undefined' && typeof key.width === 'undefined' ? 0 : num(key.width, 30) / 360,
            num(key.softness, 20) / 360,
            percent(key.outside)
        ],
        u_vignette: [Math.max(-1, Math.min(1, percent(vignette.amount))), percent(vignette.midpoint, 35),
            percent(vignette.roundness, 0), percent(vignette.feather, 65)],
        u_diffuse: [percent(diffuse.amount), Math.max(1, num(diffuse.radius, 14))],
        u_halation: [percent(halation.amount), percent(halation.threshold, 70), Math.max(1, num(halation.radius, 16))],
        u_halationColor: rgb(halation.color, '#ff5020')
    };
};

export {FILM_STOCKS, colorGradingUniforms};
