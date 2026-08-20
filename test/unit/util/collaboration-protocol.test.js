import {
    normalizeSnapshotBaseSequence,
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
});
