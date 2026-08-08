'use strict';

const postcss = require('postcss');

// PenguinMod Paint hard-codes its cyan brand color in CSS. Reconnect those
// declarations to the same live theme variables used by the rest of Movie.
// SVGs use Movie's default red accent as a stable filter source;
// paint-editor-theme.css rotates it only when another accent is selected.
const rebrandPenguinModPaint = (source, resourcePath = '') => {
    if (resourcePath.endsWith('.svg')) {
        return source.replace(/#00c3ff/gi, '#FF4C4C');
    }

    if (/\.jsx?$/.test(resourcePath)) {
        return source.replace(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g, (dataUri, encodedSvg) => {
            const svg = Buffer.from(encodedSvg, 'base64').toString('utf8');
            const themedSvg = svg.replace(/#00c3ff/gi, '#FF4C4C');
            return `data:image/svg+xml;base64,${Buffer.from(themedSvg).toString('base64')}`;
        });
    }

    return source
    .replace(
        '$motion-primary: hsla(194, 100%, 50%);',
        '$motion-primary: var(--paint-looks-secondary, #855CD6);')
    .replace(
        '$motion-tertiary: #007da3;',
        '$motion-tertiary: var(--paint-looks-secondary, #774DCB);')
    .replace(
        '$motion-transparent: hsla(194, 100%, 50%, 0.35);',
        '$motion-transparent: var(--paint-looks-transparent, hsla(260, 60%, 60%, 0.35));')
        .replace(/#007da3/gi, 'var(--looks-secondary-dark, #774DCB)')
        .replace(/#00c3ff/gi, 'var(--paint-looks-secondary, #855CD6)')
        .replace(/hsla\(194, 100%, 50%, 1\)/g, 'var(--paint-looks-secondary, #855CD6)')
        .replace(/hsla\(194, 100%, 50%, 0\.5\)/g,
            'color-mix(in srgb, var(--paint-looks-secondary, #855CD6) 50%, transparent)')
        .replace(/hsla\(194, 100%, 50%, 0\.35\)/g,
            'var(--paint-looks-transparent, hsla(260, 60%, 60%, 0.35))')
        .replace(/hsla\(194, 100%, 50%, 0\.2\)/g,
            'color-mix(in srgb, var(--paint-looks-secondary, #855CD6) 20%, transparent)')
        .replace(/hsla\(194, 100%, 50%\)/g, 'var(--paint-looks-secondary, #855CD6)');
};

module.exports = function penguinModPaintThemeLoader (source) {
    return rebrandPenguinModPaint(source, this.resourcePath);
};

module.exports.rebrandPenguinModPaint = rebrandPenguinModPaint;

module.exports.postcssPlugin = postcss.plugin('penguinmod-paint-theme', () => root => {
    root.walkDecls(declaration => {
        const sourcePath = declaration.source && declaration.source.input.file;
        if (sourcePath && /node_modules[\\/]scratch-paint[\\/]/.test(sourcePath)) {
            declaration.value = rebrandPenguinModPaint(declaration.value, sourcePath);
        }
    });
});
