// Measure text the way Movie draws it: TEXT_FONT_SIZE (96) canvas pixels per line at 2 pixels per stage unit.
const TEXT_FONT_SIZE = 96;
const BITMAP_RESOLUTION = 2;

let context = null;

/**
 * @param {string} family CSS font family.
 * @param {string} text Text to measure.
 * @returns {number} Width in stage units at size 100.
 */
const measureTextWidth = (family, text) => {
    if (typeof document === 'undefined') return 0;
    if (!context) context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    context.font = `${TEXT_FONT_SIZE}px ${family}`;
    return context.measureText(String(text)).width / BITMAP_RESOLUTION;
};

export {measureTextWidth};
