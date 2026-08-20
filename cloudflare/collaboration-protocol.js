const runSerializedRoomMutation = (ctx, callback) => ctx.blockConcurrencyWhile(callback);

export {runSerializedRoomMutation};
