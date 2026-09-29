jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import storeProjectOptions from '../../../src/lib/project-options';
import {defaultStageSize} from '../../../src/reducers/custom-stage-size';

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
    test('uses 640x360 as the GUI default', () => {
        expect(defaultStageSize).toEqual({width: 640, height: 360});
    });

    test('restores 480x360 when the GUI default is 640x360', async () => {
        const vm = new VM();
        await vm.loadProject(JSON.stringify(projectJSON));
        vm.setStageSize(480, 360);

        expect(storeProjectOptions(vm, defaultStageSize)).toBeUndefined();
        expect(vm.runtime._defaultStoredSettings.width).toBe(480);
        expect(vm.runtime._defaultStoredSettings.height).toBe(360);
        const archive = await vm.saveProjectSb3('arraybuffer');

        const reloadedVM = new VM();
        reloadedVM.setStageSize(defaultStageSize.width, defaultStageSize.height);
        await reloadedVM.loadProject(archive);

        expect(reloadedVM.runtime.stageWidth).toBe(480);
        expect(reloadedVM.runtime.stageHeight).toBe(360);
    });

    test('stores every advanced setting in the project', async () => {
        const vm = new VM();
        await vm.loadProject(JSON.stringify(projectJSON));
        vm.setFramerate(60);
        vm.setInterpolation(true);
        vm.setRuntimeOptions({
            maxClones: Infinity,
            fencing: false,
            miscLimits: false
        });
        vm.setCompilerOptions({
            enabled: false,
            warpTimer: false
        });
        vm.setStageSize(1280, 720);
        storeProjectOptions(vm, defaultStageSize);
        const archive = await vm.saveProjectSb3('arraybuffer');

        const reloadedVM = new VM();
        reloadedVM.setStageSize(defaultStageSize.width, defaultStageSize.height);
        // The editor enables the warp timer before loading projects.
        reloadedVM.setCompilerOptions({warpTimer: true});
        await reloadedVM.loadProject(archive);

        expect(reloadedVM.runtime.frameLoop.framerate).toBe(60);
        expect(reloadedVM.runtime.interpolationEnabled).toBe(true);
        expect(reloadedVM.runtime.runtimeOptions).toMatchObject({
            maxClones: Infinity,
            fencing: false,
            miscLimits: false
        });
        expect(reloadedVM.runtime.compilerOptions).toMatchObject({
            enabled: false,
            warpTimer: false
        });
        expect(reloadedVM.runtime.stageWidth).toBe(1280);
        expect(reloadedVM.runtime.stageHeight).toBe(720);
    });

    test('does not store the editor warp timer default', async () => {
        const vm = new VM();
        await vm.loadProject(JSON.stringify(projectJSON));
        vm.setCompilerOptions({warpTimer: true});
        storeProjectOptions(vm, defaultStageSize);

        expect(vm.runtime._defaultStoredSettings.compilerOptions.warpTimer).toBe(false);
        const reloadedVM = new VM();
        await reloadedVM.loadProject(vm.toJSON());
        expect(reloadedVM.runtime.compilerOptions.warpTimer).toBe(false);
    });
});
