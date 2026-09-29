import zlib from 'zlib';
import JSZip from '@turbowarp/jszip';
import {createBrotliAdapter} from '../../../src/lib/share-link/share-link-brotli-adapter';
import {
    MAX_PATH_PAYLOAD_LENGTH,
    buildSharePath,
    extractSharePayload,
    getRootPath,
    isSharePath,
    parseSharePayload
} from '../../../src/lib/share-link/share-link-url';
import {resolveSharePath} from '../../../cloudflare/share-route';
import {buildTestFont} from '../../helpers/truetype-font';

// Browsers load brotli-wasm; Node's zlib speaks the same format.
jest.mock('../../../src/lib/share-link/share-link-brotli', () => () => Promise.resolve({
    compress: (bytes, quality) => new Uint8Array(require('zlib').brotliCompressSync(bytes, {
        params: {[require('zlib').constants.BROTLI_PARAM_QUALITY]: quality}
    })),
    decompress: bytes => new Uint8Array(require('zlib').brotliDecompressSync(bytes))
}));

const text = value => new TextEncoder().encode(value);

describe('share link URLs', () => {
    test('reads the payload from the path and from the fragment', () => {
        expect(parseSharePayload('/p/abc_DEF-123', '', '')).toBe('abc_DEF-123');
        expect(parseSharePayload('/p/abc/', '', '')).toBe('abc');
        expect(parseSharePayload('/p/', '#abc-_9', '')).toBe('abc-_9');
        expect(parseSharePayload('/p', '#abc', '')).toBe('abc');
        expect(parseSharePayload('/shading/p/xyz', '', '/shading/')).toBe('xyz');
    });

    test('ignores other paths and invalid payloads', () => {
        expect(parseSharePayload('/', '#abc', '')).toBeNull();
        expect(parseSharePayload('/abcdefgh', '', '')).toBeNull();
        expect(parseSharePayload('/p/', '', '')).toBeNull();
        expect(parseSharePayload('/p/a.b', '', '')).toBeNull();
        expect(isSharePath('/p/abc', '')).toBe(true);
        expect(isSharePath('/p/', '')).toBe(true);
        expect(isSharePath('/team-room', '')).toBe(false);
    });

    test('puts short payloads in the path and long ones after #', () => {
        expect(buildSharePath('abc', '')).toBe('/p/abc');
        const long = 'a'.repeat(MAX_PATH_PAYLOAD_LENGTH + 1);
        expect(buildSharePath(long, '')).toBe(`/p/#${long}`);
        expect(buildSharePath('abc', '/shading/')).toBe('/shading/p/abc');
        expect(getRootPath('')).toBe('/');
    });

    test('extracts payloads from pasted links and bare text', () => {
        expect(extractSharePayload('https://shading.app/p/abc_-1')).toBe('abc_-1');
        expect(extractSharePayload('  https://shading.app/p/#abc\nDEF  ')).toBe('abcDEF');
        expect(extractSharePayload('https://shading.app/p/abc?utm=1')).toBe('abc');
        expect(extractSharePayload('abcDEF')).toBe('abcDEF');
        expect(extractSharePayload('https://example.com/other')).toBeNull();
        expect(extractSharePayload('')).toBeNull();
    });
});

describe('Cloudflare share route', () => {
    test('serves the editor for share pages and root assets for relative URLs', () => {
        expect(resolveSharePath('/p/abc_DEF-1')).toBe('/');
        expect(resolveSharePath('/p/')).toBe('/');
        expect(resolveSharePath('/p')).toBe('/');
        expect(resolveSharePath('/p/js/editor.js')).toBe('/js/editor.js');
        expect(resolveSharePath('/p/splash.js')).toBe('/splash.js');
        expect(resolveSharePath('/p/static/assets/brotli_wasm_bg.wasm')).toBe('/static/assets/brotli_wasm_bg.wasm');
        expect(resolveSharePath('/js/editor.js')).toBeNull();
        expect(resolveSharePath('/team-room')).toBeNull();
    });
});

describe('Brotli adapter', () => {
    test('streams brotli-wasm compression with progress and matches one-shot output', () => {
        const brotliWasm = require('brotli-wasm');
        const adapter = createBrotliAdapter(brotliWasm);
        const input = text('shading share link '.repeat(80000));
        const progress = [];
        const streamed = adapter.compress(input, 9, consumed => progress.push(consumed));
        expect(Buffer.compare(zlib.brotliDecompressSync(streamed), Buffer.from(input))).toBe(0);
        expect(Array.from(streamed)).toEqual(Array.from(brotliWasm.compress(input, {quality: 9})));
        expect(progress[progress.length - 1]).toBe(input.length);
        expect(Array.from(adapter.decompress(streamed).subarray(0, 5))).toEqual(Array.from(input.subarray(0, 5)));
    });
});

describe('share link project round trip', () => {
    let shareLink;

    beforeAll(() => {
        global.document = {baseURI: 'http://localhost/'};
        shareLink = require('../../../src/lib/share-link/share-link');
    });

    afterAll(() => {
        delete global.document;
    });

    const pluginFiles = id => new Map([
        ['shading-plugin.json', text(JSON.stringify({
            format: 'shading.app/plugin',
            formatVersion: 1,
            id,
            name: `Plugin ${id}`,
            version: '1.2.3',
            description: 'Adds things.',
            locales: {ja: {name: `プラグイン ${id}`}},
            dependencies: id === 'glow' ? ['blur'] : []
        }))],
        ['main.js', text(`exports.activate = () => {}; // ${id}`)],
        ['shaders/effect.glsl', text('void main () {}')],
        ['shading-plugin.sig', text('{"format":"shading.app/plugin-signature"}')]
    ]);

    const makeVM = pluginIds => {
        const records = new Map();
        for (const id of ['blur', 'glow', 'unused']) {
            const files = pluginFiles(id);
            records.set(id, {
                id,
                manifest: JSON.parse(new TextDecoder().decode(files.get('shading-plugin.json'))),
                files
            });
        }
        const project = {targets: [], shadingPlugins: pluginIds.map(id => ({id, name: id, version: '1.2.3'}))};
        return {
            shadingPlugins: {records},
            saveProjectSb3DontZip: () => ({
                'project.json': text(JSON.stringify(project)),
                '0123456789abcdef0123456789abcdef.svg': text('<svg xmlns="http://www.w3.org/2000/svg"/>')
            })
        };
    };

    test('embeds used plugins with their dependencies and restores them as reviewable zips', async () => {
        const vm = makeVM(['glow']);
        const created = await shareLink.createShareLink(vm, 'My movie');
        expect(created.plugins.map(plugin => plugin.id)).toEqual(['blur', 'glow']);
        expect(created.url).toMatch(/^https:\/\/shading\.app\/p\/#?[A-Za-z0-9_-]+$/);

        const decoded = await shareLink.decodeShareLink(created.payload);
        expect(decoded.title).toBe('My movie');
        const projectZip = await JSZip.loadAsync(decoded.projectData);
        expect(Object.keys(projectZip.files).sort()).toEqual([
            '0123456789abcdef0123456789abcdef.svg',
            'project.json'
        ]);

        expect(decoded.plugins.map(plugin => plugin.id)).toEqual(['blur', 'glow']);
        const glow = decoded.plugins[1];
        expect(glow.name).toBe('Plugin glow');
        expect(glow.localizedNames.ja).toBe('プラグイン glow');
        expect(glow.version).toBe('1.2.3');
        expect(glow.file.name).toBe('glow.zip');
        const pluginZip = await JSZip.loadAsync(await glow.file.arrayBuffer());
        const original = pluginFiles('glow');
        for (const [path, data] of original) {
            expect(Array.from(await pluginZip.file(`glow/${path}`).async('uint8array'))).toEqual(Array.from(data));
        }
    });

    test('can leave the plugins out', async () => {
        const created = await shareLink.createShareLink(makeVM(['blur']), '', {includePlugins: false});
        expect(created.plugins).toEqual([]);
        expect(created.availablePlugins.map(plugin => plugin.id)).toEqual(['blur']);
        const decoded = await shareLink.decodeShareLink(created.payload);
        expect(decoded.plugins).toEqual([]);
    });

    test('optimizes custom fonts unless asked not to', async () => {
        const font = buildTestFont();
        const fontName = '0123456789abcdef0123456789abcdef.ttf';
        const project = {
            targets: [],
            customFonts: [{system: false, family: 'Test', fallback: 'sans-serif', md5ext: fontName}]
        };
        const vm = {
            saveProjectSb3DontZip: () => ({
                'project.json': text(JSON.stringify(project)),
                [fontName]: font
            })
        };
        const readFiles = async payload => {
            const decoded = await shareLink.decodeShareLink(payload);
            const zip = await JSZip.loadAsync(decoded.projectData);
            const files = {};
            for (const name of Object.keys(zip.files)) files[name] = await zip.file(name).async('uint8array');
            return files;
        };

        const optimized = await shareLink.createShareLink(vm, '');
        expect(optimized.customFontCount).toBe(1);
        expect(optimized.optimizedFonts).toEqual([
            {name: fontName, originalBytes: font.length, optimizedBytes: expect.any(Number)}
        ]);
        const optimizedFiles = await readFiles(optimized.payload);
        const fontFile = Object.keys(optimizedFiles).find(name => name.endsWith('.ttf'));
        expect(fontFile).not.toBe(fontName);
        expect(optimizedFiles[fontFile].length).toBe(optimized.optimizedFonts[0].optimizedBytes);
        expect(JSON.parse(new TextDecoder().decode(optimizedFiles['project.json'])).customFonts[0].md5ext)
            .toBe(fontFile);

        const full = await shareLink.createShareLink(vm, '', {optimizeFonts: false});
        expect(full.customFontCount).toBe(1);
        expect(full.optimizedFonts).toEqual([]);
        expect(full.payload.length).toBeGreaterThan(optimized.payload.length);
        const fullFiles = await readFiles(full.payload);
        expect(Array.from(fullFiles[fontName])).toEqual(Array.from(font));
    });

    test('reports progress while encoding', async () => {
        const progress = [];
        await shareLink.createShareLink(makeVM([]), 't', {onProgress: event => progress.push(event)});
        expect(progress.length).toBeGreaterThan(0);
        const last = progress[progress.length - 1];
        expect(last.done).toBe(last.total);
    });
});
