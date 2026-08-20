import {runSerializedRoomMutation} from '../../../cloudflare/collaboration-protocol';

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
});
