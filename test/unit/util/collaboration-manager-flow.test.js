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
            targetId: 'sprite'
        });
        expect(manager.applyEventPayload).not.toHaveBeenCalled();

        resolveSnapshot('base64-project');
        await capturePromise;
        expect(manager.send).toHaveBeenCalledWith({
            type: 'snapshot',
            baseSequence: 7,
            data: 'base64-project'
        });
        expect(manager.applyEventPayload).toHaveBeenCalledWith({type: 'create'}, 'sprite');
        expect(manager.snapshotInProgress).toBe(false);
    });
});
