/**
 * Wire protocol for the op-based collaboration engine.
 *
 * Modeled after the MistWarp collaboration engine: every message is a
 * JSON-serializable envelope. The room host is the authority for edit
 * operations. Local edits travel as `propose` envelopes to the host (via
 * the collaboration worker relay); the host validates them, assigns a
 * per-epoch sequence number and re-broadcasts them as `op` envelopes which
 * every peer applies in strict `seq` order.
 *
 * `validateEnvelope` MUST be called on every inbound envelope before it is
 * dispatched; anything that fails validation is dropped. Never trust a
 * `clientId` on inbound proposals - the relay-level member id is
 * authoritative for who sent a message.
 */

const OP_PROTOCOL_VERSION = 1;

// Sequenced operations. Used by both `op` and `propose` envelopes.
const OP = {
    BLOCK_EVENT: 'block-event',
    TARGET_UPDATE: 'target-update',
    SPRITE_ADD: 'sprite-add',
    SPRITE_DELETE: 'sprite-delete',
    SPRITE_RENAME: 'sprite-rename',
    SPRITE_REORDER: 'sprite-reorder',
    COSTUME_SELECT: 'costume-select'
};

// Control-plane messages routed through the collaboration worker.
const OP_CTRL = {
    PROPOSE_BATCH: 'op_propose',
    OP_BROADCAST: 'op_broadcast',
    OP_REJECT: 'op_reject',
    OPS_REQUEST: 'op_request',
    OP_REPLAY: 'op_send',
    HOST_CHANGED: 'op_host_changed'
};

// Size caps. Generous but bounded - the goal is to stop a broken or
// malicious peer from wedging the room, not to be precise. Asset payloads
// travel inline as data URLs so ops stay self-contained; larger edits fall
// back to the legacy whole-project snapshot sync.
const LIMITS = {
    MAX_STRING: 1024,
    MAX_ID: 128,
    MAX_XML: 1024 * 1024,
    MAX_DATA_URL: 8 * 1024 * 1024,
    MAX_JSON: 4 * 1024 * 1024,
    MAX_ASSET_COUNT: 512,
    MAX_PROPS: 16,
    MAX_BATCH_OPS: 64,
    MAX_OPS_IN_FLIGHT: 256
};

const isPlainObject = value =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(value);

const isNonEmptyString = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;

const isOptionalString = (value, max) =>
    typeof value === 'undefined' || value === null ||
    (typeof value === 'string' && value.length <= max);

const isNonNegativeInt = value =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isFiniteNumber = value =>
    typeof value === 'number' && isFinite(value);

const isDataUrl = value =>
    typeof value === 'string' && value.length > 0 && value.length <= LIMITS.MAX_DATA_URL;

// Target descriptors mirror describeCollaborationTarget(): peers load
// snapshots independently so raw target ids differ between them. Ops name
// targets by {id, index, isStage, name} and receivers resolve with
// resolveCollaborationTarget().
const isTargetDescriptor = value =>
    typeof value === 'undefined' || value === null || (
        isPlainObject(value) &&
        isOptionalString(value.id, LIMITS.MAX_ID) &&
        (typeof value.index === 'undefined' || isNonNegativeInt(value.index)) &&
        (typeof value.isStage === 'undefined' || typeof value.isStage === 'boolean') &&
        isOptionalString(value.name, LIMITS.MAX_STRING)
    );

const TARGET_UPDATE_PROPS = ['x', 'y', 'direction', 'size', 'visible', 'rotationStyle', 'draggable'];

const PAYLOAD_VALIDATORS = {
    [OP.BLOCK_EVENT]: payload => {
        if (!isPlainObject(payload.event)) return 'block-event requires an event object';
        if (!isNonEmptyString(payload.event.type, LIMITS.MAX_STRING)) return 'block event missing type';
        if (!isOptionalString(payload.event.xml, LIMITS.MAX_XML)) return 'block event xml too large';
        if (!isOptionalString(payload.event.oldXml, LIMITS.MAX_XML)) return 'block event oldXml too large';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        if (!isOptionalString(payload.targetId, LIMITS.MAX_ID)) return 'invalid targetId';
        return null;
    },
    [OP.TARGET_UPDATE]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'target-update requires targetId';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        if (!isPlainObject(payload.props)) return 'target-update requires props object';
        const keys = Object.keys(payload.props);
        if (keys.length > LIMITS.MAX_PROPS) return 'too many props';
        for (const key of keys) {
            if (TARGET_UPDATE_PROPS.indexOf(key) === -1) {
                return `target-update prop not allowed: ${key}`;
            }
            const value = payload.props[key];
            const ok = key === 'visible' || key === 'draggable' ?
                typeof value === 'boolean' :
                key === 'rotationStyle' ?
                    isNonEmptyString(value, LIMITS.MAX_STRING) :
                    isFiniteNumber(value);
            if (!ok) return `target-update prop invalid: ${key}`;
        }
        return null;
    },
    [OP.SPRITE_ADD]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'sprite-add requires targetId';
        if (!isNonEmptyString(payload.spriteJson, LIMITS.MAX_JSON)) return 'sprite-add requires spriteJson';
        if (!isPlainObject(payload.assets)) return 'sprite-add requires assets map';
        const names = Object.keys(payload.assets);
        if (names.length > LIMITS.MAX_ASSET_COUNT) return 'too many assets';
        for (const name of names) {
            if (!isDataUrl(payload.assets[name])) return `invalid asset data: ${name}`;
        }
        return null;
    },
    [OP.SPRITE_DELETE]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'sprite-delete requires targetId';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        return null;
    },
    [OP.SPRITE_RENAME]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'sprite-rename requires targetId';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        if (!isNonEmptyString(payload.name, LIMITS.MAX_STRING)) return 'sprite-rename requires name';
        return null;
    },
    [OP.SPRITE_REORDER]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'sprite-reorder requires targetId';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        if (!isNonNegativeInt(payload.newIndex)) return 'sprite-reorder requires newIndex';
        return null;
    },
    [OP.COSTUME_SELECT]: payload => {
        if (!isNonEmptyString(payload.targetId, LIMITS.MAX_ID)) return 'costume-select requires targetId';
        if (!isTargetDescriptor(payload.target)) return 'invalid target descriptor';
        if (!isNonNegativeInt(payload.index)) return 'costume-select requires index';
        return null;
    }
};

/**
 * Validate an inbound op envelope.
 * @param {object} envelope The decoded message.
 * @returns {string|null} An error string when invalid, null when valid.
 */
const validateOpEnvelope = envelope => {
    if (!isPlainObject(envelope)) return 'envelope is not an object';
    if (envelope.v !== OP_PROTOCOL_VERSION) return `unsupported protocol version: ${envelope.v}`;
    if (!isNonNegativeInt(envelope.seq)) return 'op requires seq';
    if (!isNonNegativeInt(envelope.epoch)) return 'op requires epoch';
    if (!isOptionalString(envelope.clientId, LIMITS.MAX_ID)) return 'op requires clientId';
    if (!isNonNegativeInt(envelope.clientOpId)) return 'op requires clientOpId';
    if (!isNonEmptyString(envelope.type, LIMITS.MAX_STRING)) return 'op missing type';
    if (!PAYLOAD_VALIDATORS[envelope.type]) return `unknown op type: ${envelope.type}`;
    if (!isPlainObject(envelope.payload)) return 'payload is not an object';
    const error = PAYLOAD_VALIDATORS[envelope.type](envelope.payload);
    if (error) return error;
    return null;
};

/**
 * Validate one proposed (unsequenced) operation payload by type.
 * @param {string} type Op type.
 * @param {object} payload Op payload.
 * @returns {string|null} An error string when invalid, null when valid.
 */
const validateOpPayload = (type, payload) => {
    const validator = PAYLOAD_VALIDATORS[type];
    if (!validator) return `unknown op type: ${type}`;
    if (!isPlainObject(payload)) return 'payload is not an object';
    return validator(payload);
};

const makeOpEnvelope = (type, payload, {seq, epoch, clientId, clientOpId}) => ({
    v: OP_PROTOCOL_VERSION,
    kind: 'op',
    type,
    ts: Date.now(),
    seq,
    epoch,
    clientId,
    clientOpId,
    payload: payload || {}
});

const makeProposeEnvelope = (type, payload, clientOpId) => ({
    v: OP_PROTOCOL_VERSION,
    kind: 'propose',
    type,
    ts: Date.now(),
    clientOpId,
    payload: payload || {}
});

export {
    LIMITS,
    OP,
    OP_CTRL,
    OP_PROTOCOL_VERSION,
    TARGET_UPDATE_PROPS,
    makeOpEnvelope,
    makeProposeEnvelope,
    validateOpEnvelope,
    validateOpPayload
};
