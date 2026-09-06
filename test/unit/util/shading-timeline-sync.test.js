/* eslint-env jest */

import VM from 'scratch-vm';
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
});
