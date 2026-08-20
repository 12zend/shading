const canAdminister = member => Boolean(member && member.role === 'admin');

const canManageEntry = (member, entry) => Boolean(
    member && entry && (canAdminister(member) || entry.authorId === member.id)
);

const canRevertOperation = (member, operation) => Boolean(
    member && operation && (canAdminister(member) || operation.authorId === member.id)
);

const canPromoteAdmin = (member, target) => Boolean(
    canAdminister(member) && target && !target.pendingFreshSnapshot &&
    target.id !== member.id && target.role === 'member'
);

// Keep the old export while deployed clients are upgraded. The operation now
// promotes an additional administrator instead of transferring the role.
const canTransferAdmin = canPromoteAdmin;

const getInviteRecord = (invites, tokenHash, now = Date.now()) => {
    if (!invites || !tokenHash) return null;
    const invite = invites[tokenHash];
    if (!invite) return null;
    if (!invite.expiresAt || Date.parse(invite.expiresAt) <= now) {
        delete invites[tokenHash];
        return null;
    }
    return invite;
};

// Backward-compatible name for existing imports. Invitations are reusable and
// are therefore only removed after they expire.
const consumeInviteRecord = getInviteRecord;

const requiresFreshSnapshot = member => Boolean(member && member.pendingFreshSnapshot);

const canCompleteFreshSnapshot = (member, session, sequence) => Boolean(
    requiresFreshSnapshot(member) && session && session.snapshotDelivered &&
    Number.isInteger(sequence) && sequence === session.snapshotDeliveredSequence
);

export {
    canAdminister,
    canCompleteFreshSnapshot,
    canManageEntry,
    canPromoteAdmin,
    canRevertOperation,
    canTransferAdmin,
    consumeInviteRecord,
    getInviteRecord,
    requiresFreshSnapshot
};
