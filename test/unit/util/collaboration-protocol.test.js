import {
    findConflictingLock,
    getOperationBlockIds,
    getTargetLockKey,
    normalizeLockBlockIds,
    normalizeSnapshotBaseSequence,
    normalizeTimelineSettings,
    runSerializedRoomMutation,
    selectSnapshotReplayOperations
} from '../../../cloudflare/collaboration-protocol';

describe('collaboration protocol transactions', () => {
    test('serializes concurrent first hello attempts', async () => {
        let chain = Promise.resolve();
        let active = 0;
        let maximumActive = 0;
        const ctx = {
            blockConcurrencyWhile: callback => {
                const result = chain.then(callback);
                chain = result.catch(() => {});
                return result;
            }
        };
        const enter = () => runSerializedRoomMutation(ctx, async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await Promise.resolve();
            active -= 1;
        });

        await Promise.all([enter(), enter(), enter()]);
        expect(maximumActive).toBe(1);
    });

    test('validates snapshot sequence and replays only later operations in order', () => {
        expect(normalizeSnapshotBaseSequence(4, 5)).toBe(4);
        expect(normalizeSnapshotBaseSequence(6, 5)).toBeNull();
        expect(normalizeSnapshotBaseSequence(-1, 5)).toBeNull();
        expect(selectSnapshotReplayOperations([
            {id: 'later', sequence: 6},
            {id: 'base', sequence: 4},
            {id: 'next', sequence: 5}
        ], 4).map(operation => operation.id)).toEqual(['next', 'later']);
    });

    test('normalizes block locks and detects overlap only on the same target', () => {
        const target = {index: 0, isStage: false, name: 'Actor'};
        const lock = {
            blockIds: ['parent', 'child'],
            expiresAt: 5000,
            memberId: 'member-a',
            target
        };

        expect(normalizeLockBlockIds(['child', 'child', '', 'parent'])).toEqual(['child', 'parent']);
        expect(getTargetLockKey(target)).toBe('sprite:0:Actor');
        expect(findConflictingLock([lock], 'member-b', target, ['child'], 1000)).toBe(lock);
        expect(findConflictingLock([lock], 'member-a', target, ['child'], 1000)).toBeNull();
        expect(findConflictingLock([lock], 'member-b', {...target, name: 'Other'}, ['child'], 1000)).toBeNull();
        expect(findConflictingLock([lock], 'member-b', target, ['child'], 6000)).toBeNull();
    });

    test('extracts moved blocks and both connection parents for lock checks', () => {
        expect(getOperationBlockIds({
            blockId: 'moving',
            ids: ['moving', 'child'],
            newParentId: 'new-parent',
            oldParentId: 'old-parent'
        })).toEqual(['moving', 'old-parent', 'new-parent', 'child']);
    });

    test('normalizes the shared project duration, rendering frame rate, and resolution', () => {
        expect(normalizeTimelineSettings({
            duration: 12.5,
            framerate: 24,
            height: 1080,
            width: 1920
        })).toEqual({duration: 12.5, framerate: 24, height: 1080, width: 1920});
        expect(normalizeTimelineSettings({
            duration: 9999,
            framerate: 999,
            height: 9000,
            width: 0
        })).toEqual({duration: 3600, framerate: 120, height: 4096, width: 1});
        expect(normalizeTimelineSettings({duration: 'bad', framerate: 30, height: 360, width: 480})).toBeNull();
    });
});
