import {CollaborationManager} from '../../../src/lib/collaboration-manager';

const textBytes = value => new TextEncoder().encode(value);

describe('collaboration manager project flow', () => {
    test('shares a whole project update instead of a Blockly operation', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.projectLoadInProgress = false;
        manager.scheduleProjectSync = jest.fn();
        manager.send = jest.fn();
        manager.ScratchBlocks = {Xml: {domToText: jest.fn(() => '<block />')}};
        manager.state = {me: {role: 'member'}, status: 'connected', synchronizing: false};
        manager.vm = {
            editingTarget: {id: 'sprite', isOriginal: true, isStage: false},
            runtime: {targets: []}
        };

        manager.handleWorkspaceEvent({
            blockId: 'block',
            recordUndo: true,
            toJson: () => ({blockId: 'block', ids: ['block'], type: 'create', xml: '<block />'}),
            type: 'create'
        });

        expect(manager.scheduleProjectSync).toHaveBeenCalledTimes(1);
        expect(manager.send).not.toHaveBeenCalled();
    });

    test('sends project.json and only assets absent from the accepted revision', async () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.destroyed = false;
        manager.pendingProjectUpdate = null;
        manager.projectAssetNames = new Set(['old.png']);
        manager.projectLoadInProgress = false;
        manager.projectRevision = 4;
        manager.projectSyncRequestPending = false;
        manager.projectUpdateQueued = true;
        manager.send = jest.fn(() => true);
        manager.state = {me: {role: 'member'}, status: 'connected', synchronizing: false};
        manager.vm = {saveProjectSb3DontZip: () => ({
            'new.wav': new Uint8Array([4, 5, 6]),
            'old.png': new Uint8Array([1, 2, 3]),
            'project.json': textBytes('{"projectVersion":3,"targets":[]}')
        })};

        manager.sendProjectUpdate();
        await manager.snapshotPromise;

        expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({
            assets: {'new.wav': 'BAUG'},
            assetNames: ['new.wav', 'old.png'],
            baseRevision: 4,
            project: expect.objectContaining({data: expect.any(String)}),
            type: 'project_update'
        }));
    });

    test('accepts a revision and retains its asset manifest for the next delta', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.pendingProjectUpdate = {assetNames: ['a.svg', 'b.wav'], requestId: 'request'};
        manager.projectSyncRequestPending = true;
        manager.projectUpdateQueued = false;

        manager.acceptProjectUpdate({requestId: 'request', revision: 9});

        expect(manager.projectRevision).toBe(9);
        expect(Array.from(manager.projectAssetNames)).toEqual(['a.svg', 'b.wav']);
        expect(manager.projectSyncRequestPending).toBe(false);
    });

    test('coalesces project changes before capturing files', () => {
        jest.useFakeTimers();
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.destroyed = false;
        manager.projectLoadInProgress = false;
        manager.projectSyncRequestPending = false;
        manager.projectUpdateQueued = false;
        manager.sendProjectUpdate = jest.fn();
        manager.state = {me: {role: 'member'}, synchronizing: false};

        manager.handleProjectChanged();
        manager.handleProjectChanged();
        jest.runAllTimers();

        expect(manager.sendProjectUpdate).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
});
