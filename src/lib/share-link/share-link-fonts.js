/**
 * Font optimization for share links: custom TrueType fonts keep only the glyphs that the text saved in the
 * project can reach. Large fonts (CJK fonts are several megabytes) otherwise dominate the link length.
 *
 * Glyph IDs never change, so GSUB, GPOS, GDEF, kern and every other table stay valid as they are:
 *   - glyf/loca: glyphs outside the kept set become empty.
 *   - cmap: only characters whose glyph is kept stay mapped, so any other character falls back to the next
 *     font in the family list instead of rendering as blank space.
 *   - hmtx/vmtx: metrics of removed glyphs are zeroed; post drops glyph names (format 3); DSIG is dropped.
 * Kept glyphs: .notdef, the glyphs of every character in project.json (except shader sources, comments and
 * settings) and SVG costumes, plus printable ASCII and case variants; everything the GSUB features that
 * browsers apply on their own can substitute them with (context conditions are ignored, which only keeps
 * more); and the components of composite glyphs.
 *
 * Fonts this cannot handle safely (CFF outlines, variable fonts, color and bitmap fonts, AAT fonts, symbol
 * fonts, malformed fonts) are shared unchanged.
 */
import md5 from 'js-md5';

const PROJECT_JSON = 'project.json';
const FONT_EXTENSIONS = new Set(['ttf', 'otf']);
// Glyphs these tables reference are not followed, so fonts that have them are left untouched.
const UNSUPPORTED_TABLES = [
    'CFF ', 'CFF2', 'fvar', 'gvar', 'COLR', 'SVG ', 'sbix', 'CBDT', 'CBLC', 'EBDT', 'EBLC', 'MATH', 'morx',
    'mort', 'JSTF'
];
const REQUIRED_TABLES = ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp'];
// An edited font would fail its signature check.
const DROPPED_TABLES = new Set(['DSIG']);
const MAX_CODE_POINT = 0x10FFFF;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const getExtension = name => {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
};

// ---- Characters the project can show --------------------------------------------------------------------------

const isVariationSelector = codePoint => (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
    (codePoint >= 0xE0100 && codePoint <= 0xE01EF);

const addText = (codePoints, text) => {
    for (const character of text) {
        codePoints.add(character.codePointAt(0));
        // Text blocks can change case at run time.
        for (const variant of [character.toUpperCase(), character.toLowerCase()]) {
            for (const part of variant) codePoints.add(part.codePointAt(0));
        }
    }
};

const addJSONStrings = (codePoints, value) => {
    if (typeof value === 'string') {
        addText(codePoints, value);
    } else if (Array.isArray(value)) {
        for (const item of value) addJSONStrings(codePoints, item);
    } else if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            addText(codePoints, key);
            addJSONStrings(codePoints, value[key]);
        }
    }
};

const addSVGText = (codePoints, bytes) => {
    const text = textDecoder.decode(bytes);
    addText(codePoints, text);
    const references = /&#(x[0-9a-f]+|[0-9]+);/gi;
    let match;
    while ((match = references.exec(text))) {
        const codePoint = match[1][0].toLowerCase() === 'x' ?
            parseInt(match[1].slice(1), 16) :
            parseInt(match[1], 10);
        if (codePoint <= MAX_CODE_POINT) addText(codePoints, String.fromCodePoint(codePoint));
    }
};

// project.json data that is never drawn on the stage: shader sources, editor comments and settings.
const NON_DISPLAY_PROJECT_KEYS = new Set(['customFonts', 'extensions', 'extensionURLs', 'mb3', 'meta', 'movieCamera',
    'penFXShaders']);
const NON_DISPLAY_TARGET_KEYS = new Set(['comments']);

/**
 * Every character the saved project can display: strings in project.json and text in SVG costumes, plus
 * printable ASCII so numbers and other generated text always render.
 * @param {Array<{name: string, data: Uint8Array}>} files Project files.
 * @param {object} project Parsed project.json.
 * @returns {Set<number>} Code points.
 */
const collectCodePoints = (files, project) => {
    const codePoints = new Set([0xA0]);
    for (let codePoint = 0x20; codePoint <= 0x7E; codePoint++) codePoints.add(codePoint);
    for (const key of Object.keys(project || {})) {
        if (NON_DISPLAY_PROJECT_KEYS.has(key)) continue;
        if (key !== 'targets' || !Array.isArray(project.targets)) {
            addJSONStrings(codePoints, project[key]);
            continue;
        }
        for (const target of project.targets) {
            if (!target || typeof target !== 'object') continue;
            for (const targetKey of Object.keys(target)) {
                if (!NON_DISPLAY_TARGET_KEYS.has(targetKey)) addJSONStrings(codePoints, target[targetKey]);
            }
        }
    }
    for (const file of files) {
        if (getExtension(file.name) === 'svg') addSVGText(codePoints, file.data);
    }
    return codePoints;
};

// ---- sfnt reading ---------------------------------------------------------------------------------------------

const tagAt = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2],
    bytes[offset + 3]);

class FontFormatError extends Error {}

const check = condition => {
    if (!condition) throw new FontFormatError('Unsupported font data.');
};

const readTables = bytes => {
    check(bytes.length >= 12);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(0);
    check(version === 0x00010000 || version === 0x74727565);
    const count = view.getUint16(4);
    check(12 + (count * 16) <= bytes.length);
    const tables = [];
    for (let i = 0; i < count; i++) {
        const record = 12 + (i * 16);
        const offset = view.getUint32(record + 8);
        const length = view.getUint32(record + 12);
        check(offset + length <= bytes.length);
        tables.push({tag: tagAt(bytes, record), offset, data: bytes.subarray(offset, offset + length)});
    }
    return tables;
};

class TableReader {
    constructor (data) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    u16 (offset) {
        check(offset >= 0 && offset + 2 <= this.data.length);
        return this.view.getUint16(offset);
    }
    i16 (offset) {
        check(offset >= 0 && offset + 2 <= this.data.length);
        return this.view.getInt16(offset);
    }
    u24 (offset) {
        return (this.u16(offset) * 256) + this.data[offset + 2];
    }
    u32 (offset) {
        check(offset >= 0 && offset + 4 <= this.data.length);
        return this.view.getUint32(offset);
    }
}

// ---- cmap -----------------------------------------------------------------------------------------------------

const readCmapSubtable = (cmap, offset, mapping) => {
    const format = cmap.u16(offset);
    const set = (codePoint, glyph) => {
        if (glyph !== 0 && codePoint <= MAX_CODE_POINT && !mapping.has(codePoint)) mapping.set(codePoint, glyph);
    };
    if (format === 0) {
        for (let code = 0; code < 256; code++) set(code, cmap.data[offset + 6 + code]);
        check(offset + 6 + 256 <= cmap.data.length);
    } else if (format === 4) {
        const segCount = cmap.u16(offset + 6) / 2;
        const ends = offset + 14;
        const starts = ends + (segCount * 2) + 2;
        const deltas = starts + (segCount * 2);
        const rangeOffsets = deltas + (segCount * 2);
        for (let i = 0; i < segCount; i++) {
            const end = cmap.u16(ends + (i * 2));
            const start = cmap.u16(starts + (i * 2));
            const delta = cmap.u16(deltas + (i * 2));
            const rangeOffsetPosition = rangeOffsets + (i * 2);
            const rangeOffset = cmap.u16(rangeOffsetPosition);
            for (let code = start; code <= end && code !== 0xFFFF; code++) {
                if (rangeOffset === 0) {
                    set(code, (code + delta) & 0xFFFF);
                } else {
                    const glyph = cmap.u16(rangeOffsetPosition + rangeOffset + ((code - start) * 2));
                    if (glyph !== 0) set(code, (glyph + delta) & 0xFFFF);
                }
            }
        }
    } else if (format === 6) {
        const first = cmap.u16(offset + 6);
        const count = cmap.u16(offset + 8);
        for (let i = 0; i < count; i++) set(first + i, cmap.u16(offset + 10 + (i * 2)));
    } else if (format === 12 || format === 13) {
        const groups = cmap.u32(offset + 12);
        for (let i = 0; i < groups; i++) {
            const group = offset + 16 + (i * 12);
            const start = cmap.u32(group);
            const end = Math.min(cmap.u32(group + 4), MAX_CODE_POINT);
            const glyph = cmap.u32(group + 8);
            check(start <= end + 1 && end - start < 0x20000);
            for (let code = start; code <= end; code++) set(code, format === 12 ? glyph + code - start : glyph);
        }
    } else {
        return false;
    }
    return true;
};

// Preferred first: full Unicode subtables, then BMP ones.
const UNICODE_SUBTABLES = ['3/10', '0/6', '0/4', '3/1', '0/3', '0/2', '0/1', '0/0'];

const readCmap = data => {
    const cmap = new TableReader(data);
    const count = cmap.u16(2);
    const records = new Map();
    let variationOffset = -1;
    for (let i = 0; i < count; i++) {
        const record = 4 + (i * 8);
        const key = `${cmap.u16(record)}/${cmap.u16(record + 2)}`;
        const offset = cmap.u32(record + 4);
        if (key === '0/5') variationOffset = offset;
        else if (!records.has(key)) records.set(key, offset);
    }
    const mapping = new Map();
    let found = false;
    for (const key of UNICODE_SUBTABLES) {
        if (records.has(key) && readCmapSubtable(cmap, records.get(key), mapping)) found = true;
    }
    // Symbol and legacy-encoded fonts cannot be remapped safely.
    check(found);
    return {cmap, mapping, variationOffset};
};

// Glyphs of variation sequences (format 14) whose base character and selector are both used.
const addVariationGlyphs = ({cmap, variationOffset}, codePoints, keep) => {
    if (variationOffset < 0) return;
    const count = cmap.u32(variationOffset + 6);
    for (let i = 0; i < count; i++) {
        const record = variationOffset + 10 + (i * 11);
        if (!codePoints.has(cmap.u24(record))) continue;
        const nonDefault = cmap.u32(record + 7);
        if (nonDefault === 0) continue;
        const table = variationOffset + nonDefault;
        const mappings = cmap.u32(table);
        for (let j = 0; j < mappings; j++) {
            const entry = table + 4 + (j * 5);
            if (codePoints.has(cmap.u24(entry))) keep.add(cmap.u16(entry + 3));
        }
    }
};

// ---- GSUB closure ---------------------------------------------------------------------------------------------

const readCoverage = (table, offset) => {
    const format = table.u16(offset);
    const glyphs = [];
    if (format === 1) {
        const count = table.u16(offset + 2);
        for (let i = 0; i < count; i++) glyphs.push(table.u16(offset + 4 + (i * 2)));
    } else if (format === 2) {
        const count = table.u16(offset + 2);
        for (let i = 0; i < count; i++) {
            const range = offset + 4 + (i * 6);
            const start = table.u16(range);
            const end = table.u16(range + 2);
            const index = table.u16(range + 4);
            for (let glyph = start; glyph <= end; glyph++) glyphs[index + glyph - start] = glyph;
        }
    } else {
        check(false);
    }
    return glyphs;
};

// Adds the glyphs one GSUB subtable can produce from the kept glyphs; returns whether anything was added.
const closeSubstitution = (gsub, type, offset, keep) => {
    check((type >= 1 && type <= 4) || type === 8);
    const before = keep.size;
    const format = gsub.u16(offset);
    const coverage = readCoverage(gsub, offset + gsub.u16(offset + 2));
    const kept = callback => coverage.forEach((glyph, index) => {
        if (keep.has(glyph)) callback(glyph, index);
    });
    const addList = listOffset => {
        const count = gsub.u16(listOffset);
        for (let i = 0; i < count; i++) keep.add(gsub.u16(listOffset + 2 + (i * 2)));
    };
    if (type === 1 && format === 1) {
        const delta = gsub.u16(offset + 4);
        kept(glyph => keep.add((glyph + delta) & 0xFFFF));
    } else if (type === 1 && format === 2) {
        kept((glyph, index) => keep.add(gsub.u16(offset + 6 + (index * 2))));
    } else if (type === 2 || type === 3) {
        // Multiple and alternate substitution share their layout: a list of glyph lists.
        kept((glyph, index) => addList(offset + gsub.u16(offset + 6 + (index * 2))));
    } else if (type === 4) {
        kept((glyph, index) => {
            const set = offset + gsub.u16(offset + 6 + (index * 2));
            const count = gsub.u16(set);
            for (let i = 0; i < count; i++) {
                const ligature = set + gsub.u16(set + 2 + (i * 2));
                const components = gsub.u16(ligature + 2);
                let complete = true;
                for (let k = 1; k < components; k++) {
                    if (!keep.has(gsub.u16(ligature + 2 + (k * 2)))) complete = false;
                }
                if (complete) keep.add(gsub.u16(ligature));
            }
        });
    } else if (type === 8) {
        // Skip the backtrack and lookahead coverage lists to reach the substitutes.
        let position = offset + 4;
        position += 2 + (gsub.u16(position) * 2);
        position += 2 + (gsub.u16(position) * 2);
        kept((glyph, index) => keep.add(gsub.u16(position + 2 + (index * 2))));
    }
    return keep.size !== before;
};

// Features browsers only apply when a style asks for them. Glyphs that only they reach are dropped; every
// other feature (including unknown ones) is kept, together with the lookups its contextual rules apply.
const OPT_IN_FEATURES = new Set([
    'aalt', 'afrc', 'c2pc', 'c2sc', 'case', 'cswh', 'dlig', 'dnom', 'expt', 'falt', 'frac', 'fwid', 'halt', 'hist',
    'hkna', 'hlig', 'hngl', 'hojo', 'hwid', 'ital', 'jalt', 'jp04', 'jp78', 'jp83', 'jp90', 'lnum', 'mgrk', 'nalt',
    'nlck', 'numr', 'onum', 'ordn', 'ornm', 'pcap', 'pkna', 'pnum', 'pwid', 'qwid', 'ruby', 'salt', 'sinf', 'smcp',
    'smpl', 'subs', 'sups', 'swsh', 'titl', 'tnum', 'trad', 'twid', 'unic', 'vkna', 'zero'
]);
const isOptInFeature = tag => OPT_IN_FEATURES.has(tag) || /^(ss(0[1-9]|1[0-9]|20)|cv\d\d)$/.test(tag);

// Lookups that the rules of a contextual (type 5) or chained contextual (type 6) subtable apply.
const nestedLookups = (gsub, type, offset) => {
    const lookups = [];
    const readRecords = (position, count) => {
        for (let i = 0; i < count; i++) lookups.push(gsub.u16(position + (i * 4) + 2));
    };
    const readRuleSets = (countPosition, readRule) => {
        const setCount = gsub.u16(countPosition);
        for (let i = 0; i < setCount; i++) {
            const setOffset = gsub.u16(countPosition + 2 + (i * 2));
            if (setOffset === 0) continue;
            const set = offset + setOffset;
            const ruleCount = gsub.u16(set);
            for (let k = 0; k < ruleCount; k++) readRule(set + gsub.u16(set + 2 + (k * 2)));
        }
    };
    const readContextRule = rule => {
        const glyphCount = gsub.u16(rule);
        readRecords(rule + 4 + (Math.max(0, glyphCount - 1) * 2), gsub.u16(rule + 2));
    };
    const readChainRule = rule => {
        let position = rule;
        position += 2 + (gsub.u16(position) * 2);
        position += 2 + (Math.max(0, gsub.u16(position) - 1) * 2);
        position += 2 + (gsub.u16(position) * 2);
        readRecords(position + 2, gsub.u16(position));
    };
    const format = gsub.u16(offset);
    if (type === 5 && format === 1) {
        readRuleSets(offset + 4, readContextRule);
    } else if (type === 5 && format === 2) {
        readRuleSets(offset + 6, readContextRule);
    } else if (type === 5 && format === 3) {
        const glyphCount = gsub.u16(offset + 2);
        readRecords(offset + 6 + (glyphCount * 2), gsub.u16(offset + 4));
    } else if (type === 6 && format === 1) {
        readRuleSets(offset + 4, readChainRule);
    } else if (type === 6 && format === 2) {
        readRuleSets(offset + 10, readChainRule);
    } else if (type === 6 && format === 3) {
        let position = offset + 2;
        for (let i = 0; i < 3; i++) position += 2 + (gsub.u16(position) * 2);
        readRecords(position + 2, gsub.u16(position));
    } else {
        check(false);
    }
    return lookups;
};

const addSubstitutionGlyphs = (data, keep) => {
    const gsub = new TableReader(data);
    const featureList = gsub.u16(6);
    const lookupList = gsub.u16(8);
    if (featureList === 0 || lookupList === 0) return;
    const lookupCount = gsub.u16(lookupList);
    const readSubtables = index => {
        check(index < lookupCount);
        const lookup = lookupList + gsub.u16(lookupList + 2 + (index * 2));
        const type = gsub.u16(lookup);
        const subtables = [];
        for (let k = 0; k < gsub.u16(lookup + 4); k++) {
            const offset = lookup + gsub.u16(lookup + 6 + (k * 2));
            if (type === 7) {
                check(gsub.u16(offset) === 1);
                subtables.push({type: gsub.u16(offset + 2), offset: offset + gsub.u32(offset + 4)});
            } else {
                subtables.push({type, offset});
            }
        }
        return subtables;
    };

    const pending = [];
    // Feature variations swap in lookups this does not read, so every lookup is followed then.
    const hasFeatureVariations = gsub.u16(2) >= 1 && data.length >= 14 && gsub.u32(10) !== 0;
    if (hasFeatureVariations) {
        for (let i = 0; i < lookupCount; i++) pending.push(i);
    } else {
        const featureCount = gsub.u16(featureList);
        for (let i = 0; i < featureCount; i++) {
            const record = featureList + 2 + (i * 6);
            if (isOptInFeature(tagAt(gsub.data, record))) continue;
            const feature = featureList + gsub.u16(record + 4);
            const count = gsub.u16(feature + 2);
            for (let k = 0; k < count; k++) pending.push(gsub.u16(feature + 4 + (k * 2)));
        }
    }
    const used = new Set();
    const subtables = [];
    while (pending.length) {
        const index = pending.pop();
        if (used.has(index)) continue;
        used.add(index);
        for (const subtable of readSubtables(index)) {
            if (subtable.type === 5 || subtable.type === 6) {
                pending.push(...nestedLookups(gsub, subtable.type, subtable.offset));
            } else {
                subtables.push(subtable);
            }
        }
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const {type, offset} of subtables) {
            if (closeSubstitution(gsub, type, offset, keep)) changed = true;
        }
    }
};

// ---- glyf -----------------------------------------------------------------------------------------------------

const readLoca = (tables, glyphCount, glyfLength) => {
    const loca = new TableReader(tables.get('loca').data);
    const long = new TableReader(tables.get('head').data).i16(50) === 1;
    const offsets = new Array(glyphCount + 1);
    for (let i = 0; i <= glyphCount; i++) offsets[i] = long ? loca.u32(i * 4) : loca.u16(i * 2) * 2;
    for (let i = 0; i < glyphCount; i++) check(offsets[i] <= offsets[i + 1]);
    check(offsets[glyphCount] <= glyfLength);
    return {offsets, long};
};

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

const addComponentGlyphs = (glyf, offsets, keep) => {
    const pending = Array.from(keep);
    while (pending.length) {
        const glyph = pending.pop();
        if (glyph + 1 >= offsets.length) continue;
        const start = offsets[glyph];
        if (offsets[glyph + 1] - start < 10 || glyf.i16(start) >= 0) continue;
        let position = start + 10;
        let flags;
        do {
            flags = glyf.u16(position);
            const component = glyf.u16(position + 2);
            if (!keep.has(component)) {
                keep.add(component);
                pending.push(component);
            }
            position += 4 + ((flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2);
            if (flags & WE_HAVE_A_SCALE) position += 2;
            else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) position += 4;
            else if (flags & WE_HAVE_A_TWO_BY_TWO) position += 8;
        } while (flags & MORE_COMPONENTS);
    }
};

// ---- Writing --------------------------------------------------------------------------------------------------

class TableWriter {
    constructor (length) {
        this.data = new Uint8Array(length);
        this.view = new DataView(this.data.buffer);
    }
}

const buildGlyf = (glyfData, offsets, long, keep) => {
    const glyphCount = offsets.length - 1;
    let total = 0;
    for (let i = 0; i < glyphCount; i++) {
        if (keep.has(i)) total += offsets[i + 1] - offsets[i];
    }
    const glyf = new Uint8Array(total);
    const loca = new TableWriter((glyphCount + 1) * (long ? 4 : 2));
    let position = 0;
    for (let i = 0; i <= glyphCount; i++) {
        if (long) loca.view.setUint32(i * 4, position);
        else loca.view.setUint16(i * 2, position / 2);
        if (i < glyphCount && keep.has(i)) {
            glyf.set(glyfData.subarray(offsets[i], offsets[i + 1]), position);
            position += offsets[i + 1] - offsets[i];
        }
    }
    return {glyf, loca: loca.data};
};

// Unmapped characters fall back to the next font, so the new cmap maps only characters with kept glyphs.
const buildCmap = (mapping, keep, variationSubtable) => {
    const entries = Array.from(mapping.entries())
        .filter(([, glyph]) => keep.has(glyph))
        .sort((a, b) => a[0] - b[0]);

    // Format 4: one segment per run of consecutive characters, with a fixed delta when the glyphs are also
    // consecutive and a glyph array otherwise.
    const bmp = entries.filter(([code]) => code < 0xFFFF);
    const segments = [];
    for (let i = 0; i < bmp.length;) {
        let end = i;
        while (end + 1 < bmp.length && bmp[end + 1][0] === bmp[end][0] + 1) end++;
        const run = bmp.slice(i, end + 1);
        const delta = run[0][1] - run[0][0];
        segments.push({run, sequential: run.every(([code, glyph]) => glyph - code === delta)});
        i = end + 1;
    }
    segments.push({run: [[0xFFFF, 0]], sequential: true, terminal: true});
    const segCount = segments.length;
    const arrayGlyphs = segments.reduce((sum, segment) => sum + (segment.sequential ? 0 : segment.run.length), 0);
    const format4Length = 16 + (segCount * 8) + (arrayGlyphs * 2);
    check(format4Length <= 0xFFFF);
    const format4 = new TableWriter(format4Length);
    const f4 = format4.view;
    f4.setUint16(0, 4);
    f4.setUint16(2, format4Length);
    f4.setUint16(6, segCount * 2);
    let power = 1;
    let log = 0;
    while (power * 2 <= segCount) {
        power *= 2;
        log++;
    }
    f4.setUint16(8, power * 2);
    f4.setUint16(10, log);
    f4.setUint16(12, (segCount * 2) - (power * 2));
    const ends = 14;
    const starts = ends + (segCount * 2) + 2;
    const deltas = starts + (segCount * 2);
    const rangeOffsets = deltas + (segCount * 2);
    let glyphArray = rangeOffsets + (segCount * 2);
    segments.forEach((segment, i) => {
        const first = segment.run[0][0];
        f4.setUint16(ends + (i * 2), segment.run[segment.run.length - 1][0]);
        f4.setUint16(starts + (i * 2), first);
        if (segment.terminal) {
            f4.setUint16(deltas + (i * 2), 1);
        } else if (segment.sequential) {
            f4.setUint16(deltas + (i * 2), (segment.run[0][1] - first) & 0xFFFF);
        } else {
            f4.setUint16(rangeOffsets + (i * 2), glyphArray - (rangeOffsets + (i * 2)));
            for (const [, glyph] of segment.run) {
                f4.setUint16(glyphArray, glyph);
                glyphArray += 2;
            }
        }
    });

    // Format 12 is only needed for characters outside the BMP.
    let format12 = null;
    if (entries.some(([code]) => code > 0xFFFF)) {
        const groups = [];
        for (const [code, glyph] of entries) {
            const last = groups[groups.length - 1];
            if (last && code === last.end + 1 && glyph === last.glyph + code - last.start) last.end = code;
            else groups.push({start: code, end: code, glyph});
        }
        format12 = new TableWriter(16 + (groups.length * 12));
        const f12 = format12.view;
        f12.setUint16(0, 12);
        f12.setUint32(4, format12.data.length);
        f12.setUint32(12, groups.length);
        groups.forEach((group, i) => {
            f12.setUint32(16 + (i * 12), group.start);
            f12.setUint32(20 + (i * 12), group.end);
            f12.setUint32(24 + (i * 12), group.glyph);
        });
    }

    const subtables = [format4.data];
    const records = [[0, 3, 0]];
    if (format12) {
        subtables.push(format12.data);
        records.push([0, 4, 1]);
    }
    if (variationSubtable) {
        subtables.push(variationSubtable);
        records.push([0, 5, subtables.length - 1]);
    }
    records.push([3, 1, 0]);
    if (format12) records.push([3, 10, 1]);
    const headerLength = 4 + (records.length * 8);
    const subtableOffsets = [];
    let length = headerLength;
    for (const subtable of subtables) {
        subtableOffsets.push(length);
        length += subtable.length;
    }
    const cmap = new TableWriter(length);
    cmap.view.setUint16(2, records.length);
    records.forEach(([platform, encoding, subtable], i) => {
        cmap.view.setUint16(4 + (i * 8), platform);
        cmap.view.setUint16(6 + (i * 8), encoding);
        cmap.view.setUint32(8 + (i * 8), subtableOffsets[subtable]);
    });
    subtables.forEach((subtable, i) => cmap.data.set(subtable, subtableOffsets[i]));
    return cmap.data;
};

// Zeroes the metrics of removed glyphs. The last long metric also sets the advance of every later glyph,
// so its advance always stays.
const clearMetrics = (data, longMetrics, glyphCount, keep) => {
    const metrics = data.slice();
    const view = new DataView(metrics.buffer);
    check(longMetrics >= 1 && longMetrics <= glyphCount &&
        metrics.length >= (longMetrics * 4) + ((glyphCount - longMetrics) * 2));
    for (let glyph = 0; glyph < glyphCount; glyph++) {
        if (keep.has(glyph)) continue;
        if (glyph < longMetrics) {
            if (glyph !== longMetrics - 1) view.setUint16(glyph * 4, 0);
            view.setInt16((glyph * 4) + 2, 0);
        } else {
            view.setInt16((longMetrics * 4) + ((glyph - longMetrics) * 2), 0);
        }
    }
    return metrics;
};

const checksum = data => {
    let sum = 0;
    const full = data.length & ~3;
    for (let i = 0; i < full; i += 4) {
        sum = (sum + ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3])) >>> 0;
    }
    if (full < data.length) {
        let last = 0;
        for (let i = full; i < full + 4; i++) last = (last << 8) | (i < data.length ? data[i] : 0);
        sum = (sum + (last >>> 0)) >>> 0;
    }
    return sum;
};

const writeFont = (original, tables) => {
    const count = tables.length;
    let length = 12 + (count * 16);
    // Keep the original physical table order; the directory stays sorted by tag.
    const physical = tables.slice().sort((a, b) => a.offset - b.offset);
    const offsets = new Map();
    for (const table of physical) {
        offsets.set(table.tag, length);
        length += (table.data.length + 3) & ~3;
    }
    const font = new TableWriter(length);
    const view = font.view;
    view.setUint32(0, new DataView(original.buffer, original.byteOffset, 4).getUint32(0));
    view.setUint16(4, count);
    let power = 1;
    let log = 0;
    while (power * 2 <= count) {
        power *= 2;
        log++;
    }
    view.setUint16(6, power * 16);
    view.setUint16(8, log);
    view.setUint16(10, (count * 16) - (power * 16));
    const directory = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : (a.tag > b.tag ? 1 : 0)));
    directory.forEach((table, i) => {
        const record = 12 + (i * 16);
        for (let k = 0; k < 4; k++) font.data[record + k] = table.tag.charCodeAt(k);
        view.setUint32(record + 4, checksum(table.data));
        view.setUint32(record + 8, offsets.get(table.tag));
        view.setUint32(record + 12, table.data.length);
        font.data.set(table.data, offsets.get(table.tag));
    });
    const head = offsets.get('head');
    view.setUint32(head + 8, (0xB1B0AFBA - checksum(font.data)) >>> 0);
    return font.data;
};

/**
 * @param {Uint8Array} bytes TrueType font.
 * @param {Set<number>} codePoints Characters to keep.
 * @returns {?Uint8Array} The optimized font, or null when it is unsupported or would not get smaller.
 */
const subsetFont = (bytes, codePoints) => {
    let tableList;
    try {
        tableList = readTables(bytes);
    } catch (error) {
        return null;
    }
    const tables = new Map(tableList.map(table => [table.tag, table]));
    if (REQUIRED_TABLES.some(tag => !tables.has(tag)) || UNSUPPORTED_TABLES.some(tag => tables.has(tag))) {
        return null;
    }
    try {
        const glyphCount = new TableReader(tables.get('maxp').data).u16(4);
        const glyfData = tables.get('glyf').data;
        const {offsets, long} = readLoca(tables, glyphCount, glyfData.length);
        const cmapInfo = readCmap(tables.get('cmap').data);

        const keep = new Set([0]);
        for (const codePoint of codePoints) {
            const glyph = cmapInfo.mapping.get(codePoint);
            if (typeof glyph === 'number' && glyph < glyphCount) keep.add(glyph);
        }
        const usesVariationSelectors = Array.from(codePoints).some(isVariationSelector);
        if (usesVariationSelectors) addVariationGlyphs(cmapInfo, codePoints, keep);
        if (tables.has('GSUB')) addSubstitutionGlyphs(tables.get('GSUB').data, keep);
        addComponentGlyphs(new TableReader(glyfData), offsets, keep);
        for (const glyph of keep) {
            if (glyph >= glyphCount) keep.delete(glyph);
        }

        const {glyf, loca} = buildGlyf(glyfData, offsets, long, keep);
        const variationSubtable = usesVariationSelectors && cmapInfo.variationOffset >= 0 ?
            cmapInfo.cmap.data.subarray(cmapInfo.variationOffset,
                cmapInfo.variationOffset + cmapInfo.cmap.u32(cmapInfo.variationOffset + 2)) :
            null;
        const replaced = new Map([
            ['glyf', glyf],
            ['loca', loca],
            ['cmap', buildCmap(cmapInfo.mapping, keep, variationSubtable)],
            ['hmtx', clearMetrics(tables.get('hmtx').data,
                new TableReader(tables.get('hhea').data).u16(34), glyphCount, keep)]
        ]);
        if (tables.has('vhea') && tables.has('vmtx')) {
            replaced.set('vmtx', clearMetrics(tables.get('vmtx').data,
                new TableReader(tables.get('vhea').data).u16(34), glyphCount, keep));
        }
        const post = tables.get('post');
        if (post && post.data.length >= 32) {
            const header = post.data.slice(0, 32);
            new DataView(header.buffer).setUint32(0, 0x00030000);
            replaced.set('post', header);
        }
        const head = tables.get('head').data.slice();
        check(head.length >= 54);
        new DataView(head.buffer).setUint32(8, 0);
        replaced.set('head', head);

        const output = writeFont(bytes, tableList
            .filter(table => !DROPPED_TABLES.has(table.tag))
            .map(table => ({tag: table.tag, offset: table.offset, data: replaced.get(table.tag) || table.data})));
        return output.length < bytes.length ? output : null;
    } catch (error) {
        if (error instanceof FontFormatError) return null;
        throw error;
    }
};

// ---- Projects -------------------------------------------------------------------------------------------------

const replaceBytes = (bytes, search, replacement) => {
    const result = bytes.slice();
    for (let i = 0; i + search.length <= result.length; i++) {
        let match = true;
        for (let k = 0; k < search.length; k++) {
            if (result[i + k] !== search[k]) {
                match = false;
                break;
            }
        }
        if (match) {
            result.set(replacement, i);
            i += search.length - 1;
        }
    }
    return result;
};

const readProject = files => {
    const projectFile = files.find(file => file.name === PROJECT_JSON);
    if (!projectFile) return null;
    try {
        return JSON.parse(textDecoder.decode(projectFile.data));
    } catch (error) {
        return null;
    }
};

/**
 * Names of the custom font files a project uses.
 * @param {Array<{name: string, data: Uint8Array}>} files Project files.
 * @returns {Array<string>} Font file names.
 */
const getCustomFontFiles = files => {
    const project = readProject(files);
    if (!project || !Array.isArray(project.customFonts)) return [];
    const names = new Set(files.map(file => file.name));
    const fonts = new Set();
    for (const font of project.customFonts) {
        if (!font || font.system || typeof font.md5ext !== 'string') continue;
        if (FONT_EXTENSIONS.has(getExtension(font.md5ext)) && names.has(font.md5ext)) fonts.add(font.md5ext);
    }
    return Array.from(fonts);
};

/**
 * Replaces the project's custom fonts with optimized copies. Optimized fonts get new md5 names, and
 * project.json is updated to match, so they never collide with the full font in asset caches.
 * @param {Array<{name: string, data: Uint8Array}>} files Project files.
 * @returns {{files: Array<{name: string, data: Uint8Array}>,
 *   fonts: Array<{name: string, originalBytes: number, optimizedBytes: number}>}} Files and what changed.
 */
const optimizeProjectFonts = files => {
    const fontNames = getCustomFontFiles(files);
    if (!fontNames.length) return {files, fonts: []};
    const codePoints = collectCodePoints(files, readProject(files));
    const renames = new Map();
    const fonts = [];
    let result = files.map(file => {
        if (!fontNames.includes(file.name)) return file;
        const optimized = subsetFont(file.data, codePoints);
        if (!optimized) return file;
        const name = `${md5(optimized)}.${getExtension(file.name)}`;
        renames.set(file.name, name);
        fonts.push({name: file.name, originalBytes: file.data.length, optimizedBytes: optimized.length});
        return {name, data: optimized};
    });
    if (renames.size) {
        result = result.map(file => {
            if (file.name !== PROJECT_JSON) return file;
            let data = file.data;
            for (const [from, to] of renames) {
                data = replaceBytes(data, textEncoder.encode(`"${from}"`), textEncoder.encode(`"${to}"`));
            }
            return {name: file.name, data};
        });
    }
    return {files: result, fonts};
};

export {
    collectCodePoints,
    getCustomFontFiles,
    optimizeProjectFonts,
    subsetFont
};
