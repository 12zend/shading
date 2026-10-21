jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../../src/lib/movie-asset-manager';
import {SHADING_PROJECT_VERSION} from '../../../src/lib/project-format';
import {
    SETTINGS_RESTORED_EVENT,
    getProjectTitleFromFileName,
    installProjectFileHooks,
    isProjectFileName,
    readProjectFileVersion,
    saveProjectFile
} from '../../../src/lib/project-file';

const stageProject = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

class MemoryStorage {
    constructor (values = {}) {
        this.values = new Map(Object.entries(values));
    }
    get length () {
        return this.values.size;
    }
    key (index) {
        const keys = Array.from(this.values.keys());
        return index < keys.length ? keys[index] : null;
    }
    getItem (key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }
    setItem (key, value) {
        this.values.set(key, String(value));
    }
    removeItem (key) {
        this.values.delete(key);
    }
}

const pluginBytes = new Uint8Array([80, 75, 5, 6, 1, 2, 3]);

const createVM = () => {
    const vm = new VM();
    installMovieAssetManager(vm);
    vm.shadingPlugins = {
        records: new Map([
            ['glow', {
                id: 'glow',
                manifest: {
                    name: 'Glow',
                    version: '1.2.0',
                    description: 'Adds glow',
                    locales: {ja: {name: 'グロー'}}
                },
                stored: {id: 'glow', data: pluginBytes.buffer.slice(0), hash: 'abc', fileName: 'glow.zip'}
            }],
            // Loaded for the session only: nothing stored to save.
            ['session', {id: 'session', manifest: {name: 'Session'}, stored: {enabled: true}}]
        ]),
        offerSharedPlugins: jest.fn()
    };
    installProjectFileHooks(vm);
    return vm;
};

describe('.shade project files', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
    });

    test('recognizes only .shade file names', () => {
        expect(isProjectFileName('movie.shade')).toBe(true);
        expect(isProjectFileName('MOVIE.SHADE')).toBe(true);
        for (const name of ['project.sb3', 'project.sb2', 'project.sb', 'movie.mb3', 'movie', null]) {
            expect(isProjectFileName(name)).toBe(false);
            expect(getProjectTitleFromFileName(name)).toBe('');
        }
        expect(getProjectTitleFromFileName('my movie is great.shade')).toBe('my movie is great');
    });

    test('reads the version of a file without loading it', async () => {
        const zip = version => new JSZip().file('project.json', JSON.stringify(Object.assign(stageProject(), version)))
            .generateAsync({type: 'arraybuffer'});

        await expect(readProjectFileVersion(await zip({shading: {version: '1.0.0'}}))).resolves.toBe('1.0.0');
        await expect(readProjectFileVersion(await zip({mb3: {version: 1}}))).resolves.toBe('1.0.0');
        await expect(readProjectFileVersion(await zip({}))).resolves.toBeNull();
        await expect(readProjectFileVersion(new Uint8Array([1, 2, 3]))).resolves.toBeNull();
    });

    test('saves the version, browser settings and installed plugins into the file', async () => {
        global.localStorage = new MemoryStorage({
            'tw:addons': '{"_":5,"onion-skinning":{"enabled":true}}',
            'tw:theme': '{"gui":"light"}',
            'tw:username': 'someone',
            'tw:persisted_unsandboxed': 'true'
        });
        const vm = createVM();
        await vm.loadProject(Object.assign(stageProject(), {shading: {version: '1.0.0'}}));

        const archive = await saveProjectFile(vm, 'arraybuffer');
        const zip = await JSZip.loadAsync(archive);
        const saved = JSON.parse(await zip.file('project.json').async('string'));

        expect(saved.shading.version).toBe(SHADING_PROJECT_VERSION);
        expect(saved.shading.settings.localStorage).toEqual({
            'tw:addons': '{"_":5,"onion-skinning":{"enabled":true}}',
            'tw:theme': '{"gui":"light"}'
        });
        expect(saved.shading.settings.plugins).toEqual([{
            id: 'glow',
            name: 'Glow',
            localizedNames: {ja: 'グロー'},
            version: '1.2.0',
            description: 'Adds glow',
            fileName: 'glow.zip',
            hash: 'abc',
            enabled: true
        }]);
        expect(Array.from(await zip.file('plugins/glow.zip').async('uint8array'))).toEqual(Array.from(pluginBytes));
        expect(zip.file('plugins/session.zip')).toBeNull();
    });

    test('restores browser settings and offers missing plugins when a file loads', async () => {
        global.localStorage = new MemoryStorage({
            'tw:addons': '{"_":5,"onion-skinning":{"enabled":true}}',
            'tw:language': 'ja'
        });
        const source = createVM();
        await source.loadProject(Object.assign(stageProject(), {shading: {version: '1.0.0'}}));
        const archive = await saveProjectFile(source, 'arraybuffer');

        global.localStorage = new MemoryStorage({
            'tw:language': 'ja',
            'tw:username': 'me'
        });
        const vm = createVM();
        const restored = jest.fn();
        vm.on(SETTINGS_RESTORED_EVENT, restored);
        await vm.loadProject(archive);

        expect(global.localStorage.getItem('tw:addons')).toBe('{"_":5,"onion-skinning":{"enabled":true}}');
        expect(global.localStorage.getItem('tw:username')).toBe('me');
        expect(restored).toHaveBeenCalledWith(['tw:addons']);
        expect(vm.shadingPlugins.offerSharedPlugins).toHaveBeenCalledTimes(1);
        const [offered] = vm.shadingPlugins.offerSharedPlugins.mock.calls[0];
        expect(offered).toEqual([expect.objectContaining({id: 'glow', name: 'Glow', version: '1.2.0'})]);
        expect(new Uint8Array(await offered[0].file.arrayBuffer())).toEqual(pluginBytes);
    });

    test('never restores private keys from a file', async () => {
        global.localStorage = new MemoryStorage();
        const vm = createVM();
        const project = Object.assign(stageProject(), {
            shading: {
                version: '1.0.0',
                settings: {localStorage: {'tw:persisted_unsandboxed': 'true', 'tw:username': 'x', 'tw:theme': '{}'}}
            }
        });
        await vm.loadProject(project);

        expect(global.localStorage.getItem('tw:persisted_unsandboxed')).toBeNull();
        expect(global.localStorage.getItem('tw:username')).toBeNull();
        expect(global.localStorage.getItem('tw:theme')).toBe('{}');
    });

    test('opens .shade files saved before the version was written', async () => {
        global.localStorage = new MemoryStorage();
        const vm = createVM();
        await vm.loadProject(Object.assign(stageProject(), {mb3: {version: 1, features: ['timeline']}}));

        expect(vm.runtime.targets).toHaveLength(1);
    });

    test('refuses Scratch projects and keeps the open project', async () => {
        global.localStorage = new MemoryStorage();
        const vm = createVM();
        await vm.loadProject(Object.assign(stageProject(), {shading: {version: '1.0.0'}}));
        const openStage = vm.runtime.targets[0];

        await expect(vm.loadProject(stageProject())).rejects.toMatchObject({
            name: 'UnsupportedProjectFormatError',
            reason: 'legacy-format'
        });
        await expect(vm.loadProject(Object.assign(stageProject(), {shading: {version: '2.0.0'}})))
            .rejects.toMatchObject({reason: 'newer-version'});
        expect(vm.runtime.targets[0]).toBe(openStage);
    });
});
