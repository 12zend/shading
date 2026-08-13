import VM from 'scratch-vm';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import Sprite from 'scratch-vm/src/sprites/sprite';

import installObjectBlocks, {createObjectBlocksClass} from '../../../src/lib/object-blocks';
import {getFieldSourceBlock} from '../../../src/lib/object-blocks-ui';

const makeUtil = () => ({
    stackFrame: {},
    startBranch: jest.fn(),
    target: {id: 'sprite'},
    thread: {}
});

const makeGroupingHarness = onStep => {
    const blocks = {
        getBranch: jest.fn((blockId, branch) => {
            if (blockId !== 'grouping') return null;
            return branch === 1 ? 'objects-branch' : 'effects-branch';
        })
    };
    const target = {id: 'sprite', blocks};
    const parentThread = {
        blockContainer: blocks,
        peekStack: jest.fn(() => 'grouping'),
        target
    };
    const originalActiveThread = {id: 'original'};
    const sequencer = {
        activeThread: originalActiveThread,
        stepThread: jest.fn(thread => {
            if (onStep) onStep(thread);
        })
    };
    return {
        originalActiveThread,
        runtime: {sequencer},
        sequencer,
        util: {
            stackFrame: {},
            startBranch: jest.fn(),
            target,
            thread: parentThread
        }
    };
};

describe('Objects blocks', () => {
    test('supports the legacy ScratchBlocks field source API', () => {
        const sourceBlock = {};

        expect(getFieldSourceBlock({sourceBlock_: sourceBlock})).toBe(sourceBlock);
        expect(getFieldSourceBlock({getSourceBlock: () => sourceBlock})).toBe(sourceBlock);
    });

    test('exposes one draw command instead of separate transform commands', () => {
        const vm = {runtime: {}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const info = blocks.getInfo();

        expect(info.blocks.map(blockInfo => blockInfo.opcode)).toEqual(['draw', 'grouping']);
        expect(Object.keys(info.blocks[0].arguments)).toEqual([
            'SOURCE', 'ASSET', 'TEXT',
            'PX', 'PY', 'PZ',
            'RX', 'RY', 'RZ',
            'SX', 'SY', 'SZ',
            'SIZE', 'WIDTH', 'HEIGHT',
            'T1', 'T2'
        ]);
    });

    test('draws one complete object and never returns a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({
            SOURCE: 'text',
            ASSET: 'Movie Sans',
            TEXT: 'Title',
            PX: 10,
            PY: 20,
            PZ: 30,
            RX: 1,
            RY: 2,
            RZ: 3,
            SX: 2,
            SY: 3,
            SZ: 4,
            SIZE: 75,
            WIDTH: 125,
            HEIGHT: 80,
            T1: 1.5,
            T2: 4.5
        }, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, {
            asset: 'Movie Sans',
            height: 80,
            position: {x: 10, y: 20, z: 30},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            size: 75,
            source: 'text',
            text: 'Title',
            time: {start: 1.5, end: 4.5},
            width: 125
        });
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('runs both grouping branches atomically and scopes Pen FX without returning a promise', () => {
        const penFX = {beginGroup: jest.fn(), endGroup: jest.fn()};
        const harness = makeGroupingHarness();
        harness.runtime.penFX = penFX;
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(harness.sequencer.stepThread.mock.calls.map(call => call[0].topBlock)).toEqual([
            'objects-branch',
            'effects-branch'
        ]);
        expect(harness.sequencer.stepThread.mock.calls.every(call => call[0].peekStackFrame().warpMode)).toBe(true);
        expect(harness.sequencer.activeThread).toBe(harness.originalActiveThread);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('finishes grouping and the following block in one compiled VM step', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const groupBoundaries = [];
        runtime.penFX = {
            beginGroup: jest.fn(() => groupBoundaries.push(['begin', runtime.ext_scratch3_control.getCounter()])),
            endGroup: jest.fn(() => groupBoundaries.push(['end', runtime.ext_scratch3_control.getCounter()]))
        };

        target.blocks.createBlock({
            id: 'grouping',
            opcode: 'objects_grouping',
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'objects-branch', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: 'effects-branch', shadow: null}
            },
            fields: {},
            next: 'after-grouping',
            parent: null,
            shadow: false,
            topLevel: true
        });
        for (const [id, parent] of [
            ['objects-branch', 'grouping'],
            ['effects-branch', 'grouping'],
            ['after-grouping', 'grouping']
        ]) {
            target.blocks.createBlock({
                id,
                opcode: 'control_incr_counter',
                inputs: {},
                fields: {},
                next: null,
                parent,
                shadow: false,
                topLevel: false
            });
        }

        runtime.ext_scratch3_control.clearCounter();
        const thread = runtime._pushThread('grouping', target);
        expect(thread.isCompiled).toBe(true);
        runtime.sequencer.stepThread(thread);

        expect(runtime.ext_scratch3_control.getCounter()).toBe(3);
        expect(groupBoundaries).toEqual([['begin', 0], ['end', 2]]);
        expect(runtime.penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(runtime.penFX.endGroup).toHaveBeenCalledTimes(1);
    });

    test('finishes an asynchronous grouped draw before applying captured effects', async () => {
        let resolveDraw;
        const pendingDraw = new Promise(resolve => {
            resolveDraw = resolve;
        });
        const effects = [{}];
        const penFX = {
            applyCapturedEffects: jest.fn(),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(),
            endEffectCapture: jest.fn(() => effects),
            endGroup: jest.fn()
        };
        const manager = {runWithoutWaiting: jest.fn()};
        const harness = makeGroupingHarness(thread => {
            if (thread.topBlock === 'objects-branch') thread.objectPendingDraws = [pendingDraw];
        });
        Object.assign(harness.runtime, {movieAssetManager: manager, penFX});
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.beginEffectCapture).toHaveBeenCalledTimes(1);
        expect(penFX.applyCapturedEffects).not.toHaveBeenCalled();
        const finishGroup = manager.runWithoutWaiting.mock.calls[0][0];
        resolveDraw();
        await finishGroup;
        expect(penFX.applyCapturedEffects).toHaveBeenCalledWith(effects);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(expect.any(Promise));
    });
});
