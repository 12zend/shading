import JSZip from '@turbowarp/jszip';
import {normalizeEntryPath, normalizeManifest, readPluginArchive} from '../../../src/lib/plugins/archive';

const manifest = (overrides = {}) => JSON.stringify(Object.assign({
    format: 'shading.app/plugin',
    formatVersion: 1,
    id: 'hello',
    name: 'Hello',
    version: '1.2.3',
    main: 'main.js'
}, overrides));

const zipOf = files => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return zip.generateAsync({type: 'uint8array'});
};

describe('plugin archives', () => {
    test('reads a plugin zipped at the root', async () => {
        const archive = await readPluginArchive(await zipOf({
            'shading-plugin.json': manifest(),
            'main.js': 'exports.activate = () => {};',
            'lib/util.js': 'module.exports = 1;'
        }), 'hello.zip');
        expect(archive.manifest).toMatchObject({id: 'hello', name: 'Hello', version: '1.2.3', main: 'main.js'});
        expect(Array.from(archive.files.keys()).sort()).toEqual(['lib/util.js', 'main.js', 'shading-plugin.json']);
        expect(archive.hash).toMatch(/^(sha256|fnv1a)-[0-9a-f]+$/);
    });

    test('reads a plugin whose folder was zipped (zip -r blur.zip blur/)', async () => {
        const archive = await readPluginArchive(await zipOf({
            'hello/shading-plugin.json': manifest(),
            'hello/main.js': 'exports.activate = () => {};',
            '__MACOSX/hello/._main.js': 'junk'
        }));
        expect(Array.from(archive.files.keys()).sort()).toEqual(['main.js', 'shading-plugin.json']);
    });

    test('rejects archives without a manifest, a main file, or with unsafe paths', async () => {
        await expect(readPluginArchive(await zipOf({'main.js': ''}))).rejects.toThrow('shading-plugin.json');
        await expect(readPluginArchive(await zipOf({'shading-plugin.json': manifest()})))
            .rejects.toThrow('main.js');
        // JSZip already drops leading "../" when it builds a zip; the reader still refuses such names.
        expect(() => normalizeEntryPath('../escape.js')).toThrow('escapes the plugin folder');
        expect(() => normalizeEntryPath('lib/../../escape.js')).toThrow('escapes the plugin folder');
        expect(() => normalizeEntryPath('/etc/passwd')).toThrow('absolute path');
        expect(() => normalizeEntryPath('C:/Windows/evil.js')).toThrow('absolute path');
        expect(normalizeEntryPath('./lib\\util.js')).toBe('lib/util.js');
        await expect(readPluginArchive(new Uint8Array([1, 2, 3]), 'x.zip')).rejects.toThrow('not a valid zip');
    });

    test('validates manifest fields', () => {
        expect(() => normalizeManifest({format: 'other'})).toThrow('format');
        expect(() => normalizeManifest(JSON.parse(manifest({id: 'Bad Id'})))).toThrow('id');
        expect(() => normalizeManifest(JSON.parse(manifest({main: 'main.py'})))).toThrow('.js');
        expect(() => normalizeManifest(JSON.parse(manifest({permissions: ['root']})))).toThrow('permissions');
        expect(normalizeManifest(JSON.parse(manifest({
            permissions: ['network', 'network'],
            locales: {ja: {name: 'ハロー'}}
        })))).toMatchObject({permissions: ['network'], locales: {ja: {name: 'ハロー', description: ''}}});
    });
});
