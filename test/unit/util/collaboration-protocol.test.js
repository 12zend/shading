import {findProjectResyncDonor, runSerializedRoomMutation} from '../../../cloudflare/collaboration-protocol';

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

    test('selects a different synchronized editor to repair a failed project', () => {
        const requester = {};
        const viewer = {};
        const donor = {};
        const staleEditor = {};
        const sessions = new Map([
            [requester, {memberId: 'requester'}],
            [viewer, {memberId: 'viewer'}],
            [staleEditor, {memberId: 'stale'}],
            [donor, {memberId: 'donor'}]
        ]);
        const members = {
            donor: {id: 'donor', pendingFreshSnapshot: false, role: 'member'},
            requester: {id: 'requester', pendingFreshSnapshot: false, role: 'admin'},
            stale: {id: 'stale', pendingFreshSnapshot: true, role: 'admin'},
            viewer: {id: 'viewer', pendingFreshSnapshot: false, role: 'viewer'}
        };

        expect(findProjectResyncDonor(sessions, members, requester, 'requester')).toBe(donor);
    });
});
