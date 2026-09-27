import md5 from 'js-md5';
import {
    collectCodePoints,
    getCustomFontFiles,
    optimizeProjectFonts,
    subsetFont
} from '../../../src/lib/share-link/share-link-fonts';
import {
    GLYPHS,
    GLYPH_COUNT,
    assembleFont,
    buildTestFont,
    checksum,
    cmapLookup,
    glyphBytes,
    glyphLengths,
    readTables,
    tableView
} from '../../helpers/truetype-font';

const text = value => new TextEncoder().encode(value);
const keptGlyphs = font => glyphLengths(font).map((length, glyph) => (length ? glyph : -1))
    .filter(glyph => glyph >= 0);

describe('share link font optimization', () => {
    const font = buildTestFont();

    test('keeps the glyphs of used characters, their default substitutions and components', () => {
        const subset = subsetFont(font, new Set([0x41, 0x42, 0x66, 0x69, 0xC1]));
        expect(subset).not.toBeNull();
        expect(subset.length).toBeLessThan(font.length);
        // salt (A.alt) is opt-in; B.alt is only reachable through calt's nested lookup.
        expect(keptGlyphs(subset)).toEqual([
            GLYPHS.notdef, GLYPHS.A, GLYPHS.B, GLYPHS.f, GLYPHS.i, GLYPHS.fi, GLYPHS.Balt, GLYPHS.Aacute,
            GLYPHS.acute
        ]);
        for (const glyph of keptGlyphs(subset)) {
            expect(Array.from(glyphBytes(subset, glyph))).toEqual(Array.from(glyphBytes(font, glyph)));
        }
    });

    test('maps only characters whose glyphs are kept, so others fall back to the next font', () => {
        const subset = subsetFont(font, new Set([0x41, 0x42, 0x66, 0x69, 0xC1]));
        expect(cmapLookup(subset, 0x41)).toBe(GLYPHS.A);
        expect(cmapLookup(subset, 0x42)).toBe(GLYPHS.B);
        expect(cmapLookup(subset, 0x66)).toBe(GLYPHS.f);
        expect(cmapLookup(subset, 0x69)).toBe(GLYPHS.i);
        expect(cmapLookup(subset, 0xC1)).toBe(GLYPHS.Aacute);
        expect(cmapLookup(subset, 0x5A)).toBe(0);
        expect(cmapLookup(subset, 0x6F22)).toBe(0);
        expect(cmapLookup(subset, 0x20B9F)).toBe(0);
    });

    test('writes format 12 for characters outside the BMP', () => {
        const subset = subsetFont(font, new Set([0x5A, 0x6F22, 0x20B9F]));
        expect(keptGlyphs(subset)).toEqual([GLYPHS.notdef, GLYPHS.Z, GLYPHS.kan, GLYPHS.shikaru]);
        expect(cmapLookup(subset, 0x5A)).toBe(GLYPHS.Z);
        expect(cmapLookup(subset, 0x6F22)).toBe(GLYPHS.kan);
        expect(cmapLookup(subset, 0x20B9F)).toBe(GLYPHS.shikaru);
    });

    test('writes a well-formed font: checksums, metrics, post and dropped signature', () => {
        const subset = subsetFont(font, new Set([0x41]));
        const tables = readTables(subset);
        expect(Object.keys(tables).sort()).toEqual(['GSUB', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp',
            'post']);
        for (const tag of Object.keys(tables)) {
            if (tag !== 'head') expect(tables[tag].checksum).toBe(checksum(tables[tag].data));
        }
        expect(checksum(subset)).toBe(0xB1B0AFBA);
        expect(tableView(tables.post.data).getUint32(0)).toBe(0x00030000);
        expect(tables.post.data.length).toBe(32);
        const hmtx = tableView(tables.hmtx.data);
        expect([hmtx.getUint16(GLYPHS.A * 4), hmtx.getInt16((GLYPHS.A * 4) + 2)]).toEqual([500 + GLYPHS.A, GLYPHS.A]);
        expect([hmtx.getUint16(GLYPHS.Z * 4), hmtx.getInt16((GLYPHS.Z * 4) + 2)]).toEqual([0, 0]);
        // The last long metric sets the advance of any later glyph, so it is never cleared.
        expect(hmtx.getUint16((GLYPH_COUNT - 1) * 4)).toBe(500 + GLYPH_COUNT - 1);
    });

    test('leaves fonts it cannot handle safely unchanged', () => {
        expect(subsetFont(text('not a font'), new Set([0x41]))).toBeNull();
        const tables = readTables(font);
        const tableData = tag => tables[tag].data;
        const withTables = extra => {
            const result = {};
            for (const tag of Object.keys(tables)) result[tag] = tableData(tag);
            return Object.assign(result, extra);
        };
        expect(subsetFont(assembleFont(withTables({}), 0x4F54544F), new Set([0x41]))).toBeNull();
        expect(subsetFont(assembleFont(withTables({'CFF ': new Uint8Array(8)})), new Set([0x41]))).toBeNull();
        expect(subsetFont(assembleFont(withTables({gvar: new Uint8Array(8)})), new Set([0x41]))).toBeNull();
        expect(subsetFont(assembleFont(withTables({COLR: new Uint8Array(8)})), new Set([0x41]))).toBeNull();
        // Truncated loca.
        expect(subsetFont(assembleFont(withTables({loca: tableData('loca').subarray(0, 6)})), new Set([0x41])))
            .toBeNull();
    });

    test('collects displayable text but not shader sources or comments', () => {
        const project = {
            targets: [{
                blocks: {a: {opcode: 'looks_say', inputs: {MESSAGE: [1, [10, 'Á']]}}},
                comments: {c: {text: '漢'}},
                variables: {v: ['score', 'ok']}
            }],
            penFXShaders: [{source: '// 漢'}]
        };
        const svg = text('<svg><text>&#x20B9F;</text></svg>');
        const codePoints = collectCodePoints([{name: 'a.svg', data: svg}], project);
        expect(codePoints.has(0xC1)).toBe(true);
        expect(codePoints.has(0xE1)).toBe(true);
        expect(codePoints.has(0x20B9F)).toBe(true);
        expect(codePoints.has(0x41)).toBe(true);
        expect(codePoints.has(0x6F22)).toBe(false);
    });

    test('replaces custom fonts with renamed optimized copies and updates project.json', () => {
        const fontName = `${md5(font)}.ttf`;
        const unusedFontName = `${md5(font.subarray(1))}.ttf`;
        const project = {
            targets: [{blocks: {a: {opcode: 'looks_say', inputs: {MESSAGE: [1, [10, '漢']]}}}}],
            customFonts: [
                {system: false, family: 'Test', fallback: 'sans-serif', md5ext: fontName},
                {system: true, family: 'Sans Serif', fallback: 'sans-serif'}
            ]
        };
        const files = [
            {name: 'project.json', data: text(JSON.stringify(project))},
            {name: fontName, data: font},
            {name: unusedFontName, data: font}
        ];
        expect(getCustomFontFiles(files)).toEqual([fontName]);

        const result = optimizeProjectFonts(files);
        expect(result.fonts).toEqual([{name: fontName, originalBytes: font.length,
            optimizedBytes: expect.any(Number)}]);
        const optimized = result.files.find(file => file.name.endsWith('.ttf') && file.name !== unusedFontName);
        expect(optimized.name).toBe(`${md5(optimized.data)}.ttf`);
        expect(optimized.name).not.toBe(fontName);
        expect(optimized.data.length).toBe(result.fonts[0].optimizedBytes);
        expect(cmapLookup(optimized.data, 0x6F22)).toBe(GLYPHS.kan);
        expect(cmapLookup(optimized.data, 0x20B9F)).toBe(0);
        // Fonts the project does not list as custom fonts are left alone.
        expect(result.files.find(file => file.name === unusedFontName).data).toBe(font);

        const savedProject = JSON.parse(new TextDecoder().decode(result.files[0].data));
        expect(savedProject.customFonts[0].md5ext).toBe(optimized.name);
        expect(savedProject.customFonts[1]).toEqual(project.customFonts[1]);
        expect(savedProject.targets).toEqual(project.targets);
    });

    test('returns projects without custom fonts unchanged', () => {
        const files = [{name: 'project.json', data: text(JSON.stringify({targets: []}))}];
        expect(optimizeProjectFonts(files)).toEqual({files, fonts: []});
        expect(getCustomFontFiles([{name: 'project.json', data: text('{')}])).toEqual([]);
    });
});
