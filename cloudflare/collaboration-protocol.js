const runSerializedRoomMutation = (ctx, callback) => ctx.blockConcurrencyWhile(callback);

const normalizeSnapshotBaseSequence = (value, currentSequence) => {
    const sequence = Number(value);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > currentSequence) return null;
    return sequence;
};

const selectSnapshotReplayOperations = (history, baseSequence) => history
    .filter(operation => operation.sequence > baseSequence)
    .sort((a, b) => a.sequence - b.sequence);

const normalizeTimelineSettings = value => {
    if (!value || typeof value !== 'object') return null;
    const duration = Number(value.duration);
    const framerate = Number(value.framerate);
    const height = Number(value.height);
    const width = Number(value.width);
    if (!Number.isFinite(duration) || !Number.isFinite(framerate) ||
        !Number.isFinite(height) || !Number.isFinite(width)) return null;
    return {
        duration: Math.min(3600, Math.max(0.1, duration)),
        framerate: Math.min(120, Math.max(1, framerate)),
        height: Math.min(4096, Math.max(1, Math.round(height))),
        width: Math.min(4096, Math.max(1, Math.round(width)))
    };
};

const normalizeLockBlockIds = (value, maximum = 2000) => {
    if (!Array.isArray(value)) return [];
    const ids = [];
    const seen = new Set();
    for (const item of value) {
        const id = String(item || '').slice(0, 200);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= maximum) break;
    }
    return ids;
};

const getOperationBlockIds = operation => {
    if (!operation || typeof operation !== 'object') return [];
    return normalizeLockBlockIds([
        operation.blockId,
        operation.oldParentId,
        operation.newParentId
    ].concat(Array.isArray(operation.ids) ? operation.ids : []));
};

const getTargetLockKey = target => {
    if (!target || typeof target !== 'object') return '';
    const index = Number.isInteger(target.index) && target.index >= 0 ? target.index : '';
    return `${target.isStage === true ? 'stage' : 'sprite'}:${index}:${String(target.name || '').slice(0, 120)}`;
};

const findConflictingLock = (locks, memberId, target, blockIds, now = Date.now()) => {
    const targetKey = getTargetLockKey(target);
    const requestedIds = new Set(normalizeLockBlockIds(blockIds));
    if (!targetKey || !requestedIds.size) return null;
    for (const lock of locks || []) {
        if (!lock || lock.memberId === memberId || lock.expiresAt <= now ||
            getTargetLockKey(lock.target) !== targetKey) continue;
        if (normalizeLockBlockIds(lock.blockIds).some(id => requestedIds.has(id))) return lock;
    }
    return null;
};

export {
    findConflictingLock,
    getOperationBlockIds,
    getTargetLockKey,
    normalizeLockBlockIds,
    normalizeSnapshotBaseSequence,
    normalizeTimelineSettings,
    runSerializedRoomMutation,
    selectSnapshotReplayOperations
};
