const canAdminister = member => Boolean(member && member.role === 'admin');

const canManageEntry = (member, entry) => Boolean(
    member && entry && (canAdminister(member) || entry.authorId === member.id)
);

const canRevertOperation = (member, operation) => Boolean(
    member && operation && (canAdminister(member) || operation.authorId === member.id)
);

const canTransferAdmin = (member, target) => Boolean(
    canAdminister(member) && target && target.id !== member.id && target.role === 'member'
);

const consumeInviteRecord = (invites, tokenHash, now = Date.now()) => {
    if (!invites || !tokenHash) return null;
    const invite = invites[tokenHash];
    if (!invite) return null;
    delete invites[tokenHash];
    if (!invite.expiresAt || Date.parse(invite.expiresAt) <= now) return null;
    return invite;
};

const requiresFreshSnapshot = member => Boolean(member && member.pendingFreshSnapshot);

export {
    canAdminister,
    canManageEntry,
    canRevertOperation,
    canTransferAdmin,
    consumeInviteRecord,
    requiresFreshSnapshot
};
