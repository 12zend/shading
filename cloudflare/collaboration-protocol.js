const runSerializedRoomMutation = (ctx, callback) => ctx.blockConcurrencyWhile(callback);

const findProjectResyncDonor = (sessions, members, requesterSocket, requesterMemberId) => {
    for (const [socket, session] of sessions.entries()) {
        if (socket === requesterSocket || !session.memberId || session.memberId === requesterMemberId) continue;
        const member = members[session.memberId];
        if (member && (member.role === 'admin' || member.role === 'member') && !member.pendingFreshSnapshot) {
            return socket;
        }
    }
    return null;
};

export {findProjectResyncDonor, runSerializedRoomMutation};
