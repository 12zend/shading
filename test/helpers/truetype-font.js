// Builds and inspects small TrueType fonts for tests.

const concat = parts => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
};

const u16s = (...values) => {
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setUint16(i * 2, value & 0xFFFF));
    return bytes;
};

const u32s = (...values) => {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setUint32(i * 4, value >>> 0));
    return bytes;
};

const checksum = data => {
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
        let word = 0;
        for (let k = 0; k < 4; k++) word = (word * 256) + (i + k < data.length ? data[i + k] : 0);
        sum = (sum + word) >>> 0;
    }
    return sum;
};

// A square outline, different for every glyph.
const simpleGlyph = size => {
    const bytes = new Uint8Array(34);
    const view = new DataView(bytes.buffer);
    view.setInt16(0, 1);
    view.setInt16(6, size);
    view.setInt16(8, size);
    view.setUint16(10, 3);
    for (let i = 0; i < 4; i++) bytes[14 + i] = 0x01;
    const xs = [0, size, 0, -size];
    const ys = [0, 0, size, 0];
    xs.forEach((x, i) => view.setInt16(18 + (i * 2), x));
    ys.forEach((y, i) => view.setInt16(26 + (i * 2), y));
    return bytes;
};

const compositeGlyph = components => {
    const parts = [u16s(0xFFFF, 0, 0, 100, 100)];
    components.forEach((glyph, i) => {
        const more = i < components.length - 1 ? 0x20 : 0;
        parts.push(u16s(0x0003 | more, glyph, 0, i * 100));
    });
    return concat(parts);
};

const coverage = glyphs => u16s(1, glyphs.length, ...glyphs);

const lookup = (type, subtable) => concat([u16s(type, 0, 1, 8), subtable]);

const offsetList = (header, items) => {
    const parts = [];
    const offsets = [];
    let offset = header.length + (items.length * 2);
    for (const item of items) {
        offsets.push(offset);
        parts.push(item);
        offset += item.length;
    }
    return concat([header, u16s(...offsets), ...parts]);
};

/**
 * GSUB with:
 *   liga (lookup 0): f + i -> fi
 *   salt (lookup 1): A -> A.alt (opt-in feature)
 *   calt (lookup 2): chained context on B that applies lookup 3
 *   lookup 3 (extension): B -> B.alt, reachable only through calt
 * @param {object} glyphs Glyph ids.
 * @returns {Uint8Array} GSUB table.
 */
const buildGSUB = glyphs => {
    const ligature = concat([u16s(1, 8, 1, 14), coverage([glyphs.f]), u16s(1, 4), u16s(glyphs.fi, 2, glyphs.i)]);
    const alternate = concat([u16s(2, 8, 1, glyphs.Aalt), coverage([glyphs.A])]);
    const chain = concat([u16s(3, 0, 1, 16, 0, 1, 0, 3), coverage([glyphs.B])]);
    const single = concat([u16s(1, 6, glyphs.Balt - glyphs.B), coverage([glyphs.B])]);
    const extension = concat([u16s(1, 1), u32s(8), single]);
    const lookupList = offsetList(u16s(4), [
        lookup(4, ligature),
        lookup(1, alternate),
        lookup(6, chain),
        lookup(7, extension)
    ]);
    const features = [['calt', 2], ['liga', 0], ['salt', 1]];
    const featureRecords = [];
    let featureOffset = 2 + (features.length * 6);
    for (const [tag] of features) {
        featureRecords.push(new Uint8Array(Array.from(tag).map(c => c.charCodeAt(0))), u16s(featureOffset));
        featureOffset += 6;
    }
    const featureList = concat([u16s(features.length), ...featureRecords,
        ...features.map(([, index]) => u16s(0, 1, index))]);
    const scriptList = u16s(0);
    return concat([u16s(1, 0, 10, 12, 12 + featureList.length), scriptList, featureList, lookupList]);
};

const buildCmap12 = mapping => {
    const entries = Object.keys(mapping).map(Number)
        .sort((a, b) => a - b);
    const groups = entries.map(code => u32s(code, code, mapping[code]));
    const subtable = concat([u16s(12, 0), u32s(16 + (groups.length * 12), 0, groups.length), ...groups]);
    return concat([u16s(0, 1, 3, 10), u32s(12), subtable]);
};

/**
 * Assembles an sfnt from tables, with valid checksums.
 * @param {object} tables Map of tag to table bytes.
 * @param {number} [version] sfnt version.
 * @returns {Uint8Array} Font.
 */
const assembleFont = (tables, version = 0x00010000) => {
    const tags = Object.keys(tables).sort();
    const header = new Uint8Array(12 + (tags.length * 16));
    const view = new DataView(header.buffer);
    view.setUint32(0, version);
    view.setUint16(4, tags.length);
    const parts = [header];
    let offset = header.length;
    tags.forEach((tag, i) => {
        const data = tables[tag];
        const record = 12 + (i * 16);
        for (let k = 0; k < 4; k++) header[record + k] = tag.charCodeAt(k);
        view.setUint32(record + 4, checksum(data));
        view.setUint32(record + 8, offset);
        view.setUint32(record + 12, data.length);
        const padded = new Uint8Array((data.length + 3) & ~3);
        padded.set(data);
        parts.push(padded);
        offset += padded.length;
    });
    const font = concat(parts);
    if (tables.head) {
        const headOffset = new DataView(font.buffer).getUint32(12 + (tags.indexOf('head') * 16) + 8);
        new DataView(font.buffer).setUint32(headOffset + 8, (0xB1B0AFBA - checksum(font)) >>> 0);
    }
    return font;
};

const GLYPHS = {notdef: 0, A: 1, B: 2, f: 3, i: 4, fi: 5, Aalt: 6, Balt: 7, Z: 8, Aacute: 9, acute: 10, kan: 11,
    shikaru: 12};
const GLYPH_COUNT = 13;
const CHARACTERS = {
    0x41: GLYPHS.A,
    0x42: GLYPHS.B,
    0x5A: GLYPHS.Z,
    0x66: GLYPHS.f,
    0x69: GLYPHS.i,
    0xC1: GLYPHS.Aacute,
    0x6F22: GLYPHS.kan,
    0x20B9F: GLYPHS.shikaru
};

const buildTestFont = () => {
    const glyphData = [];
    for (let glyph = 0; glyph < GLYPH_COUNT; glyph++) {
        glyphData.push(glyph === GLYPHS.Aacute ?
            compositeGlyph([GLYPHS.A, GLYPHS.acute]) :
            simpleGlyph(100 + (glyph * 10)));
    }
    const locaOffsets = [0];
    for (const data of glyphData) locaOffsets.push(locaOffsets[locaOffsets.length - 1] + data.length);
    const head = new Uint8Array(54);
    const headView = new DataView(head.buffer);
    headView.setUint32(0, 0x00010000);
    headView.setUint32(12, 0x5F0F3CF5);
    headView.setUint16(18, 1000);
    const hhea = new Uint8Array(36);
    new DataView(hhea.buffer).setUint32(0, 0x00010000);
    new DataView(hhea.buffer).setUint16(34, GLYPH_COUNT);
    const maxp = new Uint8Array(32);
    new DataView(maxp.buffer).setUint32(0, 0x00010000);
    new DataView(maxp.buffer).setUint16(4, GLYPH_COUNT);
    const hmtx = u16s(...Array.from({length: GLYPH_COUNT}, (_, glyph) => [500 + glyph, glyph]).flat());
    const post = concat([u32s(0x00020000), new Uint8Array(28), u16s(GLYPH_COUNT),
        new Uint8Array(GLYPH_COUNT * 2)]);
    return assembleFont({
        'DSIG': u32s(1, 0),
        'GSUB': buildGSUB(GLYPHS),
        'cmap': buildCmap12(CHARACTERS),
        'glyf': concat(glyphData),
        'head': head,
        'hhea': hhea,
        'hmtx': hmtx,
        'loca': u16s(...locaOffsets.map(offset => offset / 2)),
        'maxp': maxp,
        'post': post
    });
};

// ---- Inspection -----------------------------------------------------------------------------------------------

const readTables = font => {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const tables = {};
    for (let i = 0; i < view.getUint16(4); i++) {
        const record = 12 + (i * 16);
        const tag = String.fromCharCode(...font.subarray(record, record + 4));
        const offset = view.getUint32(record + 8);
        const length = view.getUint32(record + 12);
        tables[tag] = {checksum: view.getUint32(record + 4), data: font.subarray(offset, offset + length)};
    }
    return tables;
};

const tableView = data => new DataView(data.buffer, data.byteOffset, data.byteLength);

const glyphLengths = font => {
    const tables = readTables(font);
    const count = tableView(tables.maxp.data).getUint16(4);
    const loca = tableView(tables.loca.data);
    const lengths = [];
    for (let i = 0; i < count; i++) lengths.push((loca.getUint16((i + 1) * 2) - loca.getUint16(i * 2)) * 2);
    return lengths;
};

const glyphBytes = (font, glyph) => {
    const tables = readTables(font);
    const loca = tableView(tables.loca.data);
    return tables.glyf.data.subarray(loca.getUint16(glyph * 2) * 2, loca.getUint16((glyph + 1) * 2) * 2);
};

// Looks a character up in the font's format 4 and format 12 cmap subtables.
const cmapLookup = (font, code) => {
    const cmap = tableView(readTables(font).cmap.data);
    for (let i = 0; i < cmap.getUint16(2); i++) {
        const offset = cmap.getUint32(4 + (i * 8) + 4);
        const format = cmap.getUint16(offset);
        if (format === 4 && code < 0x10000) {
            const segCount = cmap.getUint16(offset + 6) / 2;
            for (let s = 0; s < segCount; s++) {
                const end = cmap.getUint16(offset + 14 + (s * 2));
                const start = cmap.getUint16(offset + 16 + (segCount * 2) + (s * 2));
                if (code < start || code > end) continue;
                const delta = cmap.getUint16(offset + 16 + (segCount * 4) + (s * 2));
                const rangePosition = offset + 16 + (segCount * 6) + (s * 2);
                const rangeOffset = cmap.getUint16(rangePosition);
                if (rangeOffset === 0) return (code + delta) & 0xFFFF;
                const glyph = cmap.getUint16(rangePosition + rangeOffset + ((code - start) * 2));
                return glyph === 0 ? 0 : (glyph + delta) & 0xFFFF;
            }
        } else if (format === 12) {
            const groups = cmap.getUint32(offset + 12);
            for (let g = 0; g < groups; g++) {
                const start = cmap.getUint32(offset + 16 + (g * 12));
                const end = cmap.getUint32(offset + 20 + (g * 12));
                if (code >= start && code <= end) return cmap.getUint32(offset + 24 + (g * 12)) + code - start;
            }
        }
    }
    return 0;
};

module.exports = {
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
};
