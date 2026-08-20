import {CollaborationManager} from '../../../src/lib/collaboration-manager';

describe('collaboration manager snapshot flow', () => {
    test('queues remote edits during capture and sends the matching base sequence', async () => {
        let resolveSnapshot;
        const manager = Object.create(CollaborationManager.prototype);
        manager.state = {
            history: [],
            me: {id: 'admin', role: 'admin'}
        };
        manager.pendingOperationIds = new Set();
        manager.applyEventPayload = jest.fn();
        manager.send = jest.fn(() => true);
        manager.vm = {
            saveProjectSb3: jest.fn(() => new Promise(resolve => {
                resolveSnapshot = resolve;
            }))
        };

        manager.sendSnapshot(7);
        const capturePromise = manager.snapshotPromise;
        manager.receiveOperation({
            authorId: 'member',
            clientOperationId: 'remote-8',
            forward: {type: 'create'},
            id: 'operation-8',
            sequence: 8,
            targetId: 'sprite',
            target: {index: 1, isStage: false, name: 'Sprite'}
        });
        expect(manager.applyEventPayload).not.toHaveBeenCalled();

        resolveSnapshot('base64-project');
        await capturePromise;
        expect(manager.send).toHaveBeenCalledWith({
            type: 'snapshot',
            baseSequence: 7,
            data: 'base64-project'
        });
        expect(manager.applyEventPayload).toHaveBeenCalledWith(
            {type: 'create'},
            'sprite',
            {index: 1, isStage: false, name: 'Sprite'}
        );
        expect(manager.snapshotInProgress).toBe(false);
    });

    test('applies block changes to the matching local target when ids differ between participants', () => {
        const localTarget = {
            blocks: {blocklyListen: jest.fn()},
            getName: () => 'Actor',
            id: 'local-target',
            isOriginal: true,
            isStage: false
        };
        const restoredEvent = {run: jest.fn()};
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.workspace = {};
        manager.ScratchBlocks = {
            Events: {
                disable: jest.fn(),
                enable: jest.fn(),
                fromJson: jest.fn(() => restoredEvent)
            }
        };
        manager.vm = {
            editingTarget: localTarget,
            runtime: {
                getTargetById: jest.fn(() => null),
                targets: [localTarget]
            }
        };

        expect(manager.applyEventPayload({type: 'create'}, 'remote-target', {
            id: 'remote-target',
            index: 0,
            isStage: false,
            name: 'Actor'
        })).toBe(true);
        expect(restoredEvent.run).toHaveBeenCalledWith(true);
        expect(localTarget.blocks.blocklyListen).toHaveBeenCalledWith(restoredEvent);
    });

    test.each(['create', 'delete'])('addresses a shared block %s with a stable target descriptor', type => {
        const target = {
            getName: () => 'Actor',
            id: 'participant-local-id',
            isOriginal: true,
            isStage: false
        };
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.pendingOperationIds = new Set();
        manager.send = jest.fn(() => true);
        manager.ScratchBlocks = {Xml: {domToText: jest.fn(() => '<block id="block" />')}};
        manager.state = {me: {role: 'member'}, synchronizing: false};
        manager.vm = {
            editingTarget: target,
            runtime: {targets: [target]}
        };
        const event = {
            blockId: 'block',
            oldXml: type === 'delete' ? {} : undefined,
            recordUndo: true,
            toJson: () => ({
                blockId: 'block',
                ids: ['block'],
                type,
                xml: type === 'create' ? '<block id="block" />' : undefined
            }),
            type
        };

        manager.handleWorkspaceEvent(event);

        expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({
            type: 'operation',
            targetId: 'participant-local-id',
            target: {
                id: 'participant-local-id',
                index: 0,
                isStage: false,
                name: 'Actor'
            },
            forward: expect.objectContaining({type})
        }));
    });

    test('sends a media project snapshot requested at a server sequence', async () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.state = {me: {role: 'member'}};
        manager.snapshotInProgress = false;
        manager.applyOperation = jest.fn();
        manager.getMediaFingerprint = jest.fn(() => 'media-state');
        manager.send = jest.fn(() => true);
        manager.vm = {saveProjectSb3: jest.fn(() => Promise.resolve('base64-project'))};

        manager.sendProjectSnapshot('sync-1', 12);
        await manager.snapshotPromise;

        expect(manager.send).toHaveBeenCalledWith({
            type: 'project_sync',
            requestId: 'sync-1',
            baseSequence: 12,
            data: 'base64-project'
        });
        expect(manager.snapshotInProgress).toBe(false);
        expect(manager.mediaFingerprint).toBe('media-state');
    });

    test('loads a broadcast media snapshot without acknowledging it as an initial join snapshot', async () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyOperation = jest.fn();
        manager.emit = jest.fn();
        manager.getMediaFingerprint = jest.fn(() => 'received-media');
        manager.send = jest.fn();
        manager.state = {synchronizing: false};
        manager.updateState = jest.fn(changes => {
            manager.state = Object.assign({}, manager.state, changes);
        });
        manager.vm = {loadProject: jest.fn(() => Promise.resolve())};

        manager.prepareSnapshot({
            chunkCount: 1,
            operations: [],
            sequence: 20,
            syncId: 'media-sync'
        }, true);
        manager.receiveSnapshotChunk({
            data: btoa('project'),
            index: 0,
            syncId: 'media-sync'
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.vm.loadProject).toHaveBeenCalledWith(expect.any(ArrayBuffer));
        expect(manager.send).not.toHaveBeenCalledWith(expect.objectContaining({type: 'snapshot_applied'}));
        expect(manager.mediaFingerprint).toBe('received-media');
        expect(manager.state.synchronizing).toBe(false);
    });

    test('requests media synchronization when the asset fingerprint changes', () => {
        jest.useFakeTimers();
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyingRemote = false;
        manager.destroyed = false;
        manager.mediaFingerprint = 'before';
        manager.projectLoadInProgress = false;
        manager.snapshotInProgress = false;
        manager.state = {me: {role: 'member'}, synchronizing: false};
        manager.getMediaFingerprint = jest.fn(() => 'after');
        manager.send = jest.fn(() => true);

        manager.handleProjectChanged();
        jest.runAllTimers();

        expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({
            type: 'project_sync_request'
        }));
        jest.useRealTimers();
    });
});
