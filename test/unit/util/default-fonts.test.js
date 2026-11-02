import {DEFAULT_FONTS, installDefaultFontFaces} from '../../../src/lib/default-fonts';
import {getAssetItems} from '../../../src/lib/object-blocks-ui';

const WEIGHTS = {
    'Shippori Mincho': ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'],
    'Zen Kaku Gothic New': ['Light', 'Regular', 'Medium', 'Bold', 'Black']
};

describe('Default fonts', () => {
    test('include every weight of Shippori Mincho and Zen Kaku Gothic New', () => {
        const expected = Object.keys(WEIGHTS).flatMap(family => WEIGHTS[family].map(weight => `${family} ${weight}`));
        expect(DEFAULT_FONTS.map(font => font.name)).toEqual(expected);
        for (const font of DEFAULT_FONTS) expect(font.url).toBeTruthy();
    });

    test('are offered by the draw media picker as text fonts', () => {
        const vm = {editingTarget: null, runtime: {fontManager: {getFonts: () => []}, movieAssetManager: null}};
        const values = getAssetItems(vm).filter(item => item.source === 'text').map(item => item.value);
        expect(values).toEqual(expect.arrayContaining([
            'text:Shippori Mincho Regular',
            'text:Shippori Mincho ExtraBold',
            'text:Zen Kaku Gothic New Light',
            'text:Zen Kaku Gothic New Black'
        ]));
    });

    test('register lazily loaded font faces with the document once', () => {
        const added = [];
        const originalDocument = global.document;
        const originalFontFace = global.FontFace;
        global.document = {fonts: {add: face => added.push(face)}};
        global.FontFace = function (family, source, descriptors) {
            Object.assign(this, {family, source, descriptors});
        };
        try {
            expect(installDefaultFontFaces()).toBe(true);
            expect(installDefaultFontFaces()).toBe(true);
            expect(added.map(face => face.family)).toEqual(DEFAULT_FONTS.map(font => font.name));
            expect(added[0].source).toContain('format("woff2")');
        } finally {
            global.document = originalDocument;
            global.FontFace = originalFontFace;
        }
    });
});
