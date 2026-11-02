/* eslint-disable import/no-commonjs */

// Fonts that every project can use without importing them. Each weight is its own family because Movie text is
// drawn with a family name only. The files are fetched when a draw first uses a family, not at start-up.

const DEFAULT_FONTS = [
    {name: 'Shippori Mincho Regular', url: require('./ShipporiMincho-Regular.woff2')},
    {name: 'Shippori Mincho Medium', url: require('./ShipporiMincho-Medium.woff2')},
    {name: 'Shippori Mincho SemiBold', url: require('./ShipporiMincho-SemiBold.woff2')},
    {name: 'Shippori Mincho Bold', url: require('./ShipporiMincho-Bold.woff2')},
    {name: 'Shippori Mincho ExtraBold', url: require('./ShipporiMincho-ExtraBold.woff2')},
    {name: 'Zen Kaku Gothic New Light', url: require('./ZenKakuGothicNew-Light.woff2')},
    {name: 'Zen Kaku Gothic New Regular', url: require('./ZenKakuGothicNew-Regular.woff2')},
    {name: 'Zen Kaku Gothic New Medium', url: require('./ZenKakuGothicNew-Medium.woff2')},
    {name: 'Zen Kaku Gothic New Bold', url: require('./ZenKakuGothicNew-Bold.woff2')},
    {name: 'Zen Kaku Gothic New Black', url: require('./ZenKakuGothicNew-Black.woff2')}
];

let installed = false;

/**
 * Register the default fonts with the document. The faces stay unloaded until `document.fonts.load` asks for them.
 * @returns {boolean} Whether the faces are registered.
 */
const installDefaultFontFaces = () => {
    if (installed) return true;
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return false;
    for (const font of DEFAULT_FONTS) {
        const url = typeof font.url === 'string' ? font.url : font.url && font.url.default;
        if (!url) continue;
        document.fonts.add(new FontFace(font.name, `url("${url}") format("woff2")`, {display: 'swap'}));
    }
    installed = true;
    return true;
};

module.exports = {
    DEFAULT_FONTS,
    installDefaultFontFaces
};
