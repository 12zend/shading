// The paint editor's art board holds two pixels per stage unit, the resolution of a standard Scratch 3 bitmap.
// Bitmap costumes with a higher resolution (large uploaded images) get a proportionally larger art board, so
// editing them keeps their pixels instead of cropping them to the stage-sized board.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} imageFormat The costume's data format.
 * @param {number} bitmapResolution The costume's bitmap resolution.
 * @returns {number} How many times larger than the standard art board the costume's art board is.
 */
const getArtBoardScale = (imageFormat, bitmapResolution) => {
    const resolution = Number(bitmapResolution);
    return imageFormat !== 'svg' && Number.isFinite(resolution) && resolution > 2 ? resolution / 2 : 1;
};

/**
 * Scale an SVG exported by the paint editor, including its stroke widths.
 * @param {string} svgString SVG markup.
 * @param {number} factor Scale factor.
 * @returns {string} The scaled SVG markup.
 */
const scaleSvg = (svgString, factor) => {
    const svg = new DOMParser().parseFromString(svgString, 'image/svg+xml').documentElement;
    const group = svg.ownerDocument.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `scale(${factor})`);
    while (svg.firstChild) group.appendChild(svg.firstChild);
    svg.appendChild(group);
    for (const name of ['width', 'height']) {
        const value = parseFloat(svg.getAttribute(name));
        if (Number.isFinite(value)) svg.setAttribute(name, String(value * factor));
    }
    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean)
        .map(Number);
    if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
        svg.setAttribute('viewBox', viewBox.map(value => value * factor).join(' '));
    }
    return new XMLSerializer().serializeToString(svg);
};

export {
    getArtBoardScale,
    scaleSvg
};
