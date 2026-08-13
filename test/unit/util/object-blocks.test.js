import {createObjectBlocksClass} from '../../../src/lib/object-blocks';
import {getFieldSourceBlock} from '../../../src/lib/object-blocks-ui';

const makeUtil = () => ({
    stackFrame: {},
    startBranch: jest.fn(),
    target: {id: 'sprite'},
    thread: {}
});

describe('Objects blocks', () => {
    test('supports the legacy ScratchBlocks field source API', () => {
        const sourceBlock = {};

        expect(getFieldSourceBlock({sourceBlock_: sourceBlock})).toBe(sourceBlock);
        expect(getFieldSourceBlock({getSourceBlock: () => sourceBlock})).toBe(sourceBlock);
    });

    test('collects one object stack and never returns a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({SOURCE: 'text', ASSET: 'Movie Sans', TEXT: 'Title'}, util)).toBeUndefined();
        expect(blocks.position({X: 10, Y: 20, Z: 30}, util)).toBeUndefined();
        expect(blocks.rotation({X: 1, Y: 2, Z: 3}, util)).toBeUndefined();
        expect(blocks.scale({X: 2, Y: 3, Z: 4}, util)).toBeUndefined();
        expect(blocks.size({SIZE: 75}, util)).toBeUndefined();
        expect(blocks.dimensions({WIDTH: 125, HEIGHT: 80}, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, {
            asset: 'Movie Sans',
            height: 80,
            position: {x: 10, y: 20, z: 30},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            size: 75,
            source: 'text',
            text: 'Title',
            width: 125
        });
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('runs both grouping branches and scopes Pen FX without returning a promise', () => {
        const penFX = {beginGroup: jest.fn(), endGroup: jest.fn()};
        const vm = {runtime: {penFX}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(util.startBranch).toHaveBeenLastCalledWith(1, true);
        expect(penFX.beginGroup).toHaveBeenCalledTimes(1);

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(util.startBranch).toHaveBeenLastCalledWith(2, true);
        expect(penFX.endGroup).not.toHaveBeenCalled();

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
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
        const vm = {runtime: {movieAssetManager: manager, penFX}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        blocks.grouping({}, util);
        util.thread.objectPendingDraws = [pendingDraw];
        blocks.grouping({}, util);
        expect(penFX.beginEffectCapture).toHaveBeenCalledTimes(1);
        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.applyCapturedEffects).not.toHaveBeenCalled();
        const finishGroup = manager.runWithoutWaiting.mock.calls[0][0];
        resolveDraw();
        await finishGroup;
        expect(penFX.applyCapturedEffects).toHaveBeenCalledWith(effects);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(expect.any(Promise));
    });
});
