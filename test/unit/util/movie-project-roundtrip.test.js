jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../../src/lib/movie-asset-manager';

const projectJSON = {
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
            initialize: {
                opcode: 'event_initialize',
                next: 'command',
                parent: null,
                inputs: {},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 10,
                y: 20
            },
            command: {
                opcode: 'looks_settextfont',
                next: null,
                parent: 'initialize',
                inputs: {
                    FONT: [1, [10, 'Movie Sans']],
                    TEXT: [1, [10, 'hello']]
                },
                fields: {},
                shadow: false,
                topLevel: false
            }
        },
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
    meta: {
        semver: '3.0.0',
        vm: '0.2.0',
        agent: ''
    }
};

describe('Movie project save and load', () => {
    test('loads and saves legacy drawing blocks without loading the removed Pen extension', async () => {
        const vm = new VM();
        const project = JSON.parse(JSON.stringify(projectJSON));
        project.targets[0].blocks.command.opcode = 'pen_clear';
        project.targets[0].blocks.command.inputs = {};
        project.extensions = ['pen'];
        await vm.loadProject(JSON.stringify(project));
        expect(vm.runtime.ext_pen).toBeUndefined();
        expect(vm.extensionManager.isExtensionLoaded('pen')).toBe(false);
        expect(vm.runtime._primitives.pen_clear).toEqual(expect.any(Function));
        const saved = JSON.parse(vm.toJSON());
        expect(saved.extensions || []).not.toContain('pen');
        expect(Object.values(saved.targets[0].blocks).some(block => block.opcode === 'pen_clear')).toBe(true);
    });

    test('keeps custom blocks in a marked project.json inside a shade-compatible ZIP', async () => {
        const vm = new VM();
        installMovieAssetManager(vm);
        await vm.loadProject(JSON.stringify(projectJSON));

        const archive = await vm.saveProjectSb3('arraybuffer');
        const zip = await JSZip.loadAsync(archive);
        const savedJSON = JSON.parse(await zip.file('project.json').async('string'));

        expect(savedJSON.mb3).toEqual({version: 1, features: ['movie-blocks', 'timeline']});
        const savedBlock = Object.values(savedJSON.targets[0].blocks)
            .find(item => item.opcode === 'looks_settextfont');
        expect(savedBlock).toBeDefined();
        expect(Object.values(savedJSON.targets[0].blocks)
            .some(item => item.opcode === 'event_initialize')).toBe(true);

        const reloadedVM = new VM();
        installMovieAssetManager(reloadedVM);
        await reloadedVM.loadProject(archive);

        const loadedBlock = Object.values(reloadedVM.runtime.targets[0].blocks._blocks)
            .find(item => item.opcode === 'looks_settextfont');
        expect(loadedBlock.opcode).toBe('looks_settextfont');
        expect(reloadedVM.runtime.getIsHat('event_initialize')).toBe(true);
        expect(reloadedVM.runtime._primitives.looks_settextfont).toEqual(expect.any(Function));
    });
});
