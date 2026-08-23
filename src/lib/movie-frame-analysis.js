const STATEFUL_RENDER_BLOCKS = {
    control_wait: 'waits for an earlier VM tick',
    control_wait_until: 'waits for state that may have been produced earlier',
    data_addtolist: 'changes a list from its previous value',
    data_changevariableby: 'changes a variable from its previous value',
    data_deletealloflist: 'changes a list from its previous value',
    data_deleteoflist: 'changes a list from its previous value',
    data_insertatlist: 'changes a list from its previous value',
    data_replaceitemoflist: 'changes a list from its previous value',
    looks_changeeffectby: 'changes an effect from its previous value',
    looks_changesizeby: 'changes size from its previous value',
    looks_nextbackdrop: 'depends on the previously selected backdrop',
    looks_nextcostume: 'depends on the previously selected costume',
    motion_changecamerarotationby: 'changes the camera from its previous value',
    motion_changecameraxby: 'changes the camera from its previous value',
    motion_changecamerayby: 'changes the camera from its previous value',
    motion_changecamerazby: 'changes the camera from its previous value',
    motion_changedirectionby: 'changes direction from its previous value',
    motion_changerotationby: 'changes rotation from its previous value',
    motion_changexby: 'changes position from its previous value',
    motion_changeyby: 'changes position from its previous value',
    motion_changezby: 'changes position from its previous value',
    operator_random: 'produces a different value without a stable seed'
};

const ONE_SHOT_RENDER_BLOCKS = {
    event_broadcast: 'broadcasts an event every time the frame is evaluated',
    event_broadcastandwait: 'broadcasts an event every time the frame is evaluated',
    sound_play: 'starts audio every time the frame is evaluated',
    sound_playuntildone: 'starts and waits for audio every time the frame is evaluated'
};

const RANGE_BLOCKS = new Set([
    'objects_draw',
    'objects_shape',
    'objects_arc',
    'objects_circularSegment',
    'objects_line'
]);

const getBlock = (blocks, id) => {
    if (!blocks || !id) return null;
    if (typeof blocks.getBlock === 'function') return blocks.getBlock(id);
    return blocks._blocks && blocks._blocks[id];
};

const getFieldValue = (block, name) => {
    const field = block && block.fields && block.fields[name];
    if (Array.isArray(field)) return field[0];
    if (field && typeof field === 'object') {
        if (Object.prototype.hasOwnProperty.call(field, 'value')) return field.value;
        if (Object.prototype.hasOwnProperty.call(field, 'name')) return field.name;
    }
    return field;
};

const getInputBlockId = input => {
    if (!input) return null;
    if (typeof input === 'string') return input;
    if (Array.isArray(input)) return input[1] || input[2] || null;
    return input.block || input.shadow || null;
};

const readConstantInput = (blocks, block, name, fallback) => {
    const input = block && block.inputs && block.inputs[name];
    const inputBlock = getBlock(blocks, getInputBlockId(input));
    if (!inputBlock) {
        const direct = getFieldValue(block, name);
        return typeof direct === 'undefined' ? fallback : direct;
    }
    const names = ['NUM', 'TEXT', 'COLOUR', 'COLOR', 'VALUE'];
    for (const fieldName of names) {
        const value = getFieldValue(inputBlock, fieldName);
        if (typeof value !== 'undefined') return value;
    }
    return fallback;
};

const finiteNumber = (value, fallback) => {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
};

const clampRange = (range, duration) => {
    const start = Math.max(0, Math.min(duration, finiteNumber(range.start, 0)));
    const end = Math.max(start, Math.min(duration, finiteNumber(range.end, duration)));
    return {...range, start, end};
};

const intersectRange = (first, second) => ({
    start: Math.max(first.start, second.start),
    end: Math.min(first.end, second.end)
});

const localToGlobal = (time, context) => {
    if (!context.affine || Math.abs(context.scale) < Number.EPSILON) return null;
    return (finiteNumber(time, 0) - context.offset) / context.scale;
};

const localRangeToGlobal = (start, end, context) => {
    const first = localToGlobal(start, context);
    const second = localToGlobal(end, context);
    if (first === null || second === null) return context.activeRange;
    return intersectRange({start: Math.min(first, second), end: Math.max(first, second)}, context.activeRange);
};

const getTargetName = target => {
    if (target && typeof target.getName === 'function') return target.getName();
    return target && target.sprite && target.sprite.name ? target.sprite.name : 'Object';
};

const describeRangeBlock = (block, targetName) => {
    if (block.opcode === 'objects_timeRange') return `${targetName} · time range`;
    if (block.opcode === 'sound_playattime' || block.opcode === 'sound_playatframe') {
        return `${targetName} · audio event`;
    }
    const source = getFieldValue(block, 'SOURCE');
    const asset = getFieldValue(block, 'ASSET');
    if (block.opcode === 'objects_draw' && asset) return `${targetName} · ${String(asset).replace(/^\w+:/, '')}`;
    if (block.opcode === 'objects_draw' && source) return `${targetName} · ${source}`;
    return `${targetName} · ${String(block.opcode || '').replace(/^objects_/, '')}`;
};

const analyzeRenderScript = (target, blocks, firstId, duration, framerate, result) => {
    const targetName = getTargetName(target);
    const visited = new Set();
    const initialContext = {
        activeRange: {start: 0, end: duration},
        affine: true,
        offset: 0,
        scale: 1,
        timeScopes: [],
        stateful: false
    };

    const visit = (id, context) => {
        if (!id) return;
        const visitKey = [
            id,
            context.scale,
            context.offset,
            context.activeRange.start,
            context.activeRange.end
        ].join(':');
        if (visited.has(visitKey)) return;
        visited.add(visitKey);
        const block = getBlock(blocks, id);
        if (!block) return;

        const statefulReason = STATEFUL_RENDER_BLOCKS[block.opcode];
        const eventReason = ONE_SHOT_RENDER_BLOCKS[block.opcode];
        if ((!context.stateful && statefulReason) || eventReason) {
            const category = statefulReason ? 'state' : 'event';
            result.warnings.push({
                blockId: block.id || id,
                category,
                message: statefulReason ?
                    `This block ${statefulReason}. Seeking directly to a time may produce a different frame.` :
                    `This block ${eventReason}. Put one-shot events behind an explicit time event block.`,
                opcode: block.opcode,
                severity: statefulReason ? 'warning' : 'info',
                targetId: target.id,
                targetName
            });
        }

        let branchContext = context;
        if (block.opcode === 'objects_simulation') {
            const name = readConstantInput(blocks, block, 'NAME', 'simulation');
            result.ranges.push({
                blockId: block.id || id,
                cacheStatus: 'sequential',
                end: context.activeRange.end,
                kind: 'simulation',
                label: `${targetName} · ${name}`,
                localTime: null,
                start: context.activeRange.start,
                targetId: target.id,
                timeScopes: context.timeScopes
            });
            branchContext = {...context, stateful: true};
        } else if (block.opcode === 'objects_timeOffset') {
            const offset = finiteNumber(readConstantInput(blocks, block, 'TIME', 0), 0);
            branchContext = {
                ...context,
                offset: context.offset - offset,
                timeScopes: [...context.timeScopes, {type: 'offset', offset}]
            };
        } else if (block.opcode === 'objects_timeRange') {
            const start = finiteNumber(readConstantInput(blocks, block, 'START', 0), 0);
            const end = finiteNumber(readConstantInput(blocks, block, 'END', duration), duration);
            const rangeStart = Math.min(start, end);
            const globalRange = clampRange(
                localRangeToGlobal(rangeStart, Math.max(start, end), context),
                duration
            );
            const timeScopes = [...context.timeScopes, {type: 'range', start: rangeStart}];
            result.ranges.push({
                blockId: block.id || id,
                end: globalRange.end,
                kind: 'range',
                label: describeRangeBlock(block, targetName),
                localTime: context.affine ?
                    (result.currentTime * context.scale) + context.offset - rangeStart : null,
                start: globalRange.start,
                targetId: target.id,
                timeScopes
            });
            branchContext = {
                ...context,
                activeRange: intersectRange(context.activeRange, globalRange),
                offset: context.offset - rangeStart,
                timeScopes
            };
        } else if (block.opcode === 'objects_timeScale') {
            const scale = finiteNumber(readConstantInput(blocks, block, 'SCALE', 1), 1);
            branchContext = {
                ...context,
                offset: context.offset * scale,
                scale: context.scale * scale,
                timeScopes: [...context.timeScopes, {type: 'scale', scale}]
            };
        } else if (block.opcode === 'objects_timeReverse') {
            const reverseDuration = Math.abs(finiteNumber(
                readConstantInput(blocks, block, 'DURATION', duration),
                duration
            ));
            branchContext = {
                ...context,
                offset: reverseDuration - context.offset,
                scale: -context.scale,
                timeScopes: [...context.timeScopes, {type: 'reverse', duration: reverseDuration}]
            };
        } else if (block.opcode === 'objects_timeLoop') {
            const mode = getFieldValue(block, 'MODE') === 'pingpong' ? 'pingpong' : 'loop';
            const loopDuration = Math.abs(finiteNumber(readConstantInput(blocks, block, 'DURATION', 2), 2));
            branchContext = {
                ...context,
                affine: false,
                timeScopes: [...context.timeScopes, {type: mode, duration: loopDuration}]
            };
        } else if (block.opcode === 'objects_timeFreeze') {
            const freezeTime = finiteNumber(readConstantInput(blocks, block, 'TIME', 0), 0);
            branchContext = {
                ...context,
                affine: false,
                timeScopes: [...context.timeScopes, {type: 'freeze', time: freezeTime}]
            };
        } else if (block.opcode === 'objects_timeRemap') {
            const map = readConstantInput(blocks, block, 'MAP', '0:0; 1:1');
            branchContext = {
                ...context,
                affine: false,
                timeScopes: [...context.timeScopes, {type: 'remap', map}]
            };
        }

        if (RANGE_BLOCKS.has(block.opcode)) {
            const start = finiteNumber(readConstantInput(blocks, block, 'T1', 0), 0);
            const end = finiteNumber(readConstantInput(blocks, block, 'T2', duration), duration);
            const globalRange = clampRange(localRangeToGlobal(start, end, context), duration);
            if (globalRange.end >= globalRange.start) {
                result.ranges.push({
                    blockId: block.id || id,
                    end: globalRange.end,
                    kind: 'visual',
                    label: describeRangeBlock(block, targetName),
                    localTime: context.affine ? (result.currentTime * context.scale) + context.offset : null,
                    start: globalRange.start,
                    targetId: target.id,
                    timeScopes: context.timeScopes
                });
            }
        } else if (block.opcode === 'sound_playattime' || block.opcode === 'sound_playatframe') {
            const requestedTime = block.opcode === 'sound_playatframe' ?
                finiteNumber(readConstantInput(blocks, block, 'FRAME', 0), 0) / Math.max(1, framerate) :
                finiteNumber(readConstantInput(blocks, block, 'TIME', 0), 0);
            const globalTime = localToGlobal(requestedTime, context);
            if (globalTime !== null && globalTime >= 0 && globalTime <= duration) {
                result.ranges.push({
                    blockId: block.id || id,
                    end: Math.min(duration, globalTime + (1 / Math.max(1, framerate))),
                    kind: 'event',
                    label: describeRangeBlock(block, targetName),
                    localTime: requestedTime,
                    start: globalTime,
                    targetId: target.id,
                    timeScopes: context.timeScopes
                });
            }
        }

        for (const [name, input] of Object.entries(block.inputs || {})) {
            const childId = getInputBlockId(input);
            if (!childId) continue;
            const childContext = /^SUBSTACK/.test(name) ? branchContext : context;
            visit(childId, childContext);
        }
        visit(block.next, context);
    };

    visit(firstId, initialContext);
};

const analyzeMovieFrames = (runtime, options = {}) => {
    const duration = Math.max(0.1, finiteNumber(options.duration, 10));
    const framerate = Math.max(1, finiteNumber(options.framerate, 30));
    const result = {
        currentTime: Math.max(0, finiteNumber(options.currentTime, 0)),
        ranges: [],
        warnings: []
    };
    for (const target of (runtime && runtime.targets) || []) {
        if (!target || !target.isOriginal || !target.blocks) continue;
        const scripts = typeof target.blocks.getScripts === 'function' ? target.blocks.getScripts() : [];
        for (const scriptId of scripts) {
            const hat = getBlock(target.blocks, scriptId);
            if (!hat || hat.opcode !== 'event_renderframe') continue;
            analyzeRenderScript(target, target.blocks, hat.next, duration, framerate, result);
        }
    }
    result.ranges.sort((a, b) => (a.start - b.start) || (a.end - b.end) || a.label.localeCompare(b.label));
    return result;
};

export {
    ONE_SHOT_RENDER_BLOCKS,
    RANGE_BLOCKS,
    STATEFUL_RENDER_BLOCKS,
    analyzeMovieFrames,
    getFieldValue,
    readConstantInput
};

export default analyzeMovieFrames;
