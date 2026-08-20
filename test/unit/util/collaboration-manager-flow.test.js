import {CollaborationManager} from '../../../src/lib/collaboration-manager';

describe('collaboration manager snapshot flow', () => {
    test('rolls back a locally optimistic edit rejected because another member holds the lock', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.pendingOperationIds = new Set(['local-change']);
        manager.pendingOperationRollbacks = new Map([['local-change', {
            inverse: {blockId: 'block', newValue: 'before', type: 'change'},
            target: {index: 0, isStage: false, name: 'Actor'},
            targetId: 'sprite'
        }]]);
        manager.applyEventPayload = jest.fn();
        manager.state = {error: null};
        manager.updateState = jest.fn(changes => {
            manager.state = Object.assign({}, manager.state, changes);
        });

        manager.rejectOperation({
            clientOperationId: 'local-change',
            message: '別のメンバーが操作中です。'
        });

        expect(manager.applyEventPayload).toHaveBeenCalledWith(
            {blockId: 'block', newValue: 'before', type: 'change'},
            'sprite',
            {index: 0, isStage: false, name: 'Actor'}
        );
        expect(manager.pendingOperationIds.size).toBe(0);
        expect(manager.state.error).toBe('別のメンバーが操作中です。');
    });

    test('makes remotely locked blocks read-only and restores their original state', () => {
        const block = {
            id: 'block',
            isDeletable: () => true,
            isEditable: () => true,
            isMovable: () => true,
            setDeletable: jest.fn(),
            setEditable: jest.fn(),
            setMovable: jest.fn(),
            workspace: {}
        };
        const target = {
            getName: () => 'Actor',
            id: 'local-target',
            isOriginal: true,
            isStage: false
        };
        const manager = Object.create(CollaborationManager.prototype);
        manager.lockedBlockStates = new Map();
        manager.state = {locks: [], me: {id: 'me'}};
        manager.vm = {
            editingTarget: target,
            runtime: {getTargetById: () => target, targets: [target]}
        };
        manager.workspace = {getBlockById: () => block};

        manager.applyRemoteLocks([{
            blockIds: ['block'],
            expiresAt: Date.now() + 10000,
            memberId: 'other',
            target: {id: 'local-target', index: 0, isStage: false, name: 'Actor'}
        }]);
        expect(block.setMovable).toHaveBeenLastCalledWith(false);
        expect(block.setEditable).toHaveBeenLastCalledWith(false);
        expect(block.setDeletable).toHaveBeenLastCalledWith(false);

        manager.applyRemoteLocks([]);
        expect(block.setMovable).toHaveBeenLastCalledWith(true);
        expect(block.setEditable).toHaveBeenLastCalledWith(true);
        expect(block.setDeletable).toHaveBeenLastCalledWith(true);
    });

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
        manager.movieAssetManager = {getTimelineSettings: jest.fn(() => ({
            duration: 10,
            framerate: 30,
            height: 360,
            width: 480
        }))};
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

    test('keeps live block changes queued until the invited project is loaded', () => {
        const manager = Object.create(CollaborationManager.prototype);
        manager.applyOperation = jest.fn();
        manager.pendingOperationIds = new Set();
        manager.projectLoadInProgress = false;
        manager.projectLoadOperations = [];
        manager.state = {history: [], synchronizing: true};
        manager.updateState = jest.fn();
        const operation = {
            clientOperationId: 'remote-change',
            forward: {type: 'create'},
            id: 'operation-1',
            sequence: 1
        };

        manager.receiveOperation(operation);

        expect(manager.applyOperation).not.toHaveBeenCalled();
        expect(manager.projectLoadOperations).toEqual([operation]);
    });

    test('retries an operation after the loaded project workspace becomes available', () => {
        const manager = Object.create(CollaborationManager.prototype);
        const operation = {id: 'operation-1', sequence: 1};
        manager.deferredOperations = new Map([['operation-1', operation]]);
        manager.projectLoadInProgress = false;
        manager.state = {synchronizing: false};
        manager.applyOperation = jest.fn(() => true);

        manager.flushDeferredOperations();

        expect(manager.applyOperation).toHaveBeenCalledWith(operation);
        expect(manager.deferredOperations.size).toBe(0);
    });

    test('acknowledges an invited snapshot only after every queued block change applies', () => {
        const manager = Object.create(CollaborationManager.prototype);
        const operation = {id: 'operation-1', sequence: 13};
        manager.deferredOperations = new Map([['operation-1', operation]]);
        manager.projectLoadInProgress = false;
        manager.snapshotAckPending = 12;
        manager.state = {synchronizing: false};
        manager.send = jest.fn(() => true);
        manager.applyOperation = jest.fn(() => false);

        manager.flushDeferredOperations();
        expect(manager.send).not.toHaveBeenCalled();

        manager.applyOperation.mockReturnValue(true);
        manager.flushDeferredOperations();
        expect(manager.send).toHaveBeenCalledWith({type: 'snapshot_applied', sequence: 12});
        expect(manager.snapshotAckPending).toBeNull();
    });

    test('applies versioned rendering settings from the room to every participant', () => {
        const manager = Object.create(CollaborationManager.prototype);
        const remoteSettings = {duration: 20, framerate: 60, height: 1080, width: 1920};
        manager.hasSharedTimelineSettings = false;
        manager.lastSequence = 0;
        manager.pendingTimelineSettings = new Map();
        manager.projectLoadInProgress = false;
        manager.sharedTimelineSettings = {duration: 10, framerate: 30, height: 360, width: 480};
        manager.timelineSettingsVersion = 0;
        manager.movieAssetManager = {
            getTimelineSettings: jest.fn(() => ({duration: 10, framerate: 30, height: 360, width: 480})),
            updateTimelineSettings: jest.fn()
        };
        manager.state = {synchronizing: false};
        manager.updateState = jest.fn();

        manager.receiveTimelineSettings({sequence: 8, settings: remoteSettings, version: 1});

        expect(manager.timelineSettingsVersion).toBe(1);
        expect(manager.lastSequence).toBe(8);
        expect(manager.movieAssetManager.updateTimelineSettings).toHaveBeenCalledWith(
            remoteSettings,
            {remote: true}
        );
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
