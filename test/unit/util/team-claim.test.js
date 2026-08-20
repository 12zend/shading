import {webcrypto} from 'crypto';

import {deriveTeamIdFromClaim, TEAM_ALPHABET} from '../../../cloudflare/team-claim';

describe('team creator claim', () => {
    beforeAll(() => {
        Object.defineProperty(global, 'crypto', {
            configurable: true,
            value: webcrypto
        });
    });

    test('derives a stable non-secret team id from a valid claim', async () => {
        const claim = '0123456789abcdef'.repeat(4);
        const first = await deriveTeamIdFromClaim(claim);
        const second = await deriveTeamIdFromClaim(claim);
        expect(first).toBe(second);
        expect(first).toHaveLength(20);
        expect(Array.from(first).every(character => TEAM_ALPHABET.indexOf(character) !== -1)).toBe(true);
    });

    test('rejects missing or malformed claims', async () => {
        await expect(deriveTeamIdFromClaim()).resolves.toBeNull();
        await expect(deriveTeamIdFromClaim('not-a-secret')).resolves.toBeNull();
        await expect(deriveTeamIdFromClaim('A'.repeat(64))).resolves.toBeNull();
    });
});
