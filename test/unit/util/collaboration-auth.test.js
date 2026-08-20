import {
    canAdminister,
    canCompleteFreshSnapshot,
    canManageEntry,
    canPromoteAdmin,
    canRevertOperation,
    canTransferAdmin,
    consumeInviteRecord,
    requiresFreshSnapshot
} from '../../../cloudflare/collaboration-auth';

describe('collaboration authorization', () => {
    const admin = {id: 'admin', role: 'admin'};
    const member = {id: 'member', role: 'member'};
    const otherMember = {id: 'other', role: 'member'};
    const viewer = {id: 'viewer', role: 'viewer'};

    test('only administrators can administer roles', () => {
        expect(canAdminister(admin)).toBe(true);
        expect(canAdminister(member)).toBe(false);
        expect(canAdminister(viewer)).toBe(false);
    });

    test('authors and administrators can manage entries and reversions', () => {
        const entry = {authorId: member.id};
        const operation = {authorId: member.id};
        expect(canManageEntry(member, entry)).toBe(true);
        expect(canManageEntry(otherMember, entry)).toBe(false);
        expect(canManageEntry(admin, entry)).toBe(true);
        expect(canRevertOperation(member, operation)).toBe(true);
        expect(canRevertOperation(otherMember, operation)).toBe(false);
        expect(canRevertOperation(admin, operation)).toBe(true);
    });

    test('administrator promotion only targets another member and keeps the compatibility API', () => {
        expect(canPromoteAdmin(admin, member)).toBe(true);
        expect(canTransferAdmin(admin, member)).toBe(true);
        expect(canTransferAdmin(admin, viewer)).toBe(false);
        expect(canTransferAdmin(member, otherMember)).toBe(false);
        expect(canTransferAdmin(admin, admin)).toBe(false);
        expect(canPromoteAdmin(admin, {...member, pendingFreshSnapshot: true})).toBe(false);
    });

    test('member and viewer invites keep their server-side role and remain reusable until expiry', () => {
        const future = new Date(2000).toISOString();
        const invites = {
            memberToken: {expiresAt: future, role: 'member'},
            viewerToken: {expiresAt: future, role: 'viewer'}
        };
        expect(consumeInviteRecord(invites, 'memberToken', 1000)).toEqual({expiresAt: future, role: 'member'});
        expect(consumeInviteRecord(invites, 'viewerToken', 1000)).toEqual({expiresAt: future, role: 'viewer'});
        expect(consumeInviteRecord(invites, 'memberToken', 1000)).toEqual({expiresAt: future, role: 'member'});
        expect(consumeInviteRecord(invites, 'memberToken2', 1000)).toBeNull();
    });

    test('expired invites are rejected', () => {
        const expired = {old: {expiresAt: new Date(500).toISOString(), role: 'viewer'}};
        expect(consumeInviteRecord(expired, 'old', 1000)).toBeNull();
        expect(expired).toEqual({});
    });

    test('newly invited participants require a fresh administrator snapshot', () => {
        expect(requiresFreshSnapshot({pendingFreshSnapshot: true})).toBe(true);
        expect(requiresFreshSnapshot({pendingFreshSnapshot: false})).toBe(false);
        expect(requiresFreshSnapshot({})).toBe(false);
    });

    test('keeps an invited participant read-only until the loaded snapshot is acknowledged', () => {
        const pendingMember = {pendingFreshSnapshot: true};
        const deliveredSession = {snapshotDelivered: true, snapshotDeliveredSequence: 12};
        expect(canCompleteFreshSnapshot(pendingMember, deliveredSession, 12)).toBe(true);
        expect(canCompleteFreshSnapshot(pendingMember, deliveredSession, 11)).toBe(false);
        expect(canCompleteFreshSnapshot(pendingMember, {snapshotDelivered: false}, 12)).toBe(false);
        expect(canCompleteFreshSnapshot({pendingFreshSnapshot: false}, deliveredSession, 12)).toBe(false);
    });
});
