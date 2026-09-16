/* eslint-env jest */

import VM from 'scratch-vm';
import JSZip from '@turbowarp/jszip';
import {installShadingTimeline} from '../../../src/lib/shading/runtime/timeline';

const makeProject = () => ({
    targets: [{
        blocks: {
            hat: {
                fields: {},
                inputs: {},
                next: 'set',
                opcode: 'event_renderframe',
                parent: null,
                shadow: false,
                topLevel: true,
                x: 0,
                y: 0
            },
            set: {
                fields: {
                    VARIABLE: ['time', 'time-id']
                },
                inputs: {
                    VALUE: [2, 'timer']
                },
                next: null,
                opcode: 'data_setvariableto',
                parent: 'hat',
                shadow: false,
                topLevel: false
            },
            timer: {
                fields: {},
                inputs: {},
                next: null,
                opcode: 'sensing_timer',
                parent: 'set',
                shadow: false,
                topLevel: false
            }
        },
        broadcasts: {},
        costumes: [{
            assetId: '00000000000000000000000000000000',
            bitmapResolution: 1,
            dataFormat: 'svg',
            md5ext: '00000000000000000000000000000000.svg',
            name: 'backdrop1',
            rotationCenterX: 240,
            rotationCenterY: 180
        }],
        currentCostume: 0,
        isStage: true,
        layerOrder: 0,
        lists: {},
        name: 'Stage',
        sounds: [],
        tempo: 60,
        variables: {
            'time-id': ['time', 0]
        },
        videoState: 'on',
        videoTransparency: 50,
        volume: 100
    }],
    monitors: [],
    meta: {
        agent: 'shading-simple test',
        semver: '3.0.0',
        vm: '0.2.0'
    }
});

describe('ShadingTimeline render-frame synchronization', () => {
    test('runs timer-dependent render-frame scripts after a paused seek', async () => {
        const vm = new VM();
        const timeline = installShadingTimeline(vm, {duration: 10});

        await vm.loadProject(makeProject());
        timeline.seek(2.5);

        const variable = vm.runtime.getTargetForStage().variables['time-id'];
        expect(Number(variable.value)).toBeCloseTo(2.5, 3);

        vm.runtime.dispose();
    });

    test('saves and restores timeline settings in a shade project', async () => {
        const vm = new VM();
        const timeline = installShadingTimeline(vm);

        await vm.loadProject(makeProject());
        timeline.setDuration(42.5);
        timeline.setRenderSettings({
            width: 1280,
            height: 720,
            framerate: 60
        });

        const archive = await vm.saveProjectSb3('arraybuffer');
        const zip = await JSZip.loadAsync(archive);
        const savedJSON = JSON.parse(await zip.file('project.json').async('string'));
        expect(savedJSON.shade).toEqual({
            assets: [],
            version: 1,
            timeline: {
                renderComposition: '',
                duration: 42.5,
                renderWidth: 1280,
                renderHeight: 720,
                renderFramerate: 60
            }
        });

        const reloadedVM = new VM();
        const reloadedTimeline = installShadingTimeline(reloadedVM);
        await reloadedVM.loadProject(archive);
        expect(reloadedTimeline.toJSON()).toEqual(timeline.toJSON());

        vm.runtime.dispose();
        reloadedVM.runtime.dispose();
    });
});
