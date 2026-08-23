jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import storeProjectOptions from '../../../src/lib/project-options';

const projectJSON = {
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
    meta: {
        semver: '3.0.0',
        vm: '0.2.0',
        agent: ''
    }
};

describe('storeProjectOptions', () => {
    test('restores 480x360 when the GUI default is 640x360', async () => {
        const vm = new VM();
        await vm.loadProject(JSON.stringify(projectJSON));
        vm.setStageSize(480, 360);

        expect(storeProjectOptions(vm, {width: 640, height: 360})).toBeUndefined();
        expect(vm.runtime._defaultStoredSettings.width).toBe(480);
        expect(vm.runtime._defaultStoredSettings.height).toBe(360);
        const archive = await vm.saveProjectSb3('arraybuffer');

        const reloadedVM = new VM();
        reloadedVM.setStageSize(640, 360);
        await reloadedVM.loadProject(archive);

        expect(reloadedVM.runtime.stageWidth).toBe(480);
        expect(reloadedVM.runtime.stageHeight).toBe(360);
    });
});
