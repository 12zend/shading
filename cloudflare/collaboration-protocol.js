const runSerializedRoomMutation = (ctx, callback) => ctx.blockConcurrencyWhile(callback);

const normalizeSnapshotBaseSequence = (value, currentSequence) => {
    const sequence = Number(value);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > currentSequence) return null;
    return sequence;
};

const selectSnapshotReplayOperations = (history, baseSequence) => history
    .filter(operation => operation.sequence > baseSequence)
    .sort((a, b) => a.sequence - b.sequence);

export {
    normalizeSnapshotBaseSequence,
    runSerializedRoomMutation,
    selectSnapshotReplayOperations
};
