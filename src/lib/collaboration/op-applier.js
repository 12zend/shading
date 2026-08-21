import {OP} from './op-protocol';

/**
 * Base class for applying sequenced operations to a document (the real VM
 * in production, a plain-JS doc in tests).
 *
 * Owns the remote-apply suppression scope: while `apply` runs, any change
 * events fired synchronously by the underlying document must not be
 * captured as new local ops. The capture layer consults `isApplyingRemote`.
 */
class OpApplier {
    constructor () {
        this._remoteApplyDepth = 0;
    }

    get isApplyingRemote () {
        return this._remoteApplyDepth > 0;
    }

    /**
     * Run a function within the remote-apply suppression scope. Re-entrant.
     * @param {Function} fn The mutation to run.
     * @returns {*} The function's return value.
     */
    withRemoteApply (fn) {
        this._remoteApplyDepth++;
        try {
            return fn();
        } finally {
            this._remoteApplyDepth--;
        }
    }

    /**
     * Apply one sequenced operation.
     * @param {string} type Op type (protocol OP.*).
     * @param {object} payload Op payload.
     * @param {object} [meta] {clientId, seq} of the sequenced op.
     * @returns {*} Whatever the subclass's _apply returns.
     * @throws When the op is semantically invalid; the host turns this into
     * an op reject, clients into a resync.
     */
    apply (type, payload, meta = {}) {
        return this.withRemoteApply(() => this._apply(type, payload, meta));
    }

    _apply (/* type, payload, meta */) {
        throw new Error('OpApplier subclass must implement _apply');
    }
}

/**
 * Compute the entity keys an op touches. Two ops conflict when they share
 * a key: after applying a remote op, a client re-asserts any of its own
 * unconfirmed (pending) ops that share a key with it, so every peer
 * converges on host order.
 *
 * @param {string} type Op type.
 * @param {object} payload Op payload.
 * @returns {Array.<string>} Entity keys.
 */
const entityKeysForOp = (type, payload) => {
    switch (type) {
    case OP.BLOCK_EVENT: {
        const event = payload.event || {};
        const targetId = payload.targetId || '';
        const blockId = event.blockId || '';
        switch (event.type) {
        case 'change':
            return [`block:${targetId}:${blockId}:${event.element || ''}:${event.name || ''}`];
        case 'move':
            return [`block:${targetId}:${blockId}:pos`];
        default:
            // create / delete / anything unknown: key on the whole block
            return [`block:${targetId}:${blockId}`];
        }
    }
    case OP.TARGET_UPDATE:
        return Object.keys(payload.props || {}).map(prop => `target:${payload.targetId}:${prop}`);
    case OP.SPRITE_ADD:
    case OP.SPRITE_DELETE:
    case OP.SPRITE_RENAME:
    case OP.SPRITE_REORDER:
        return [`sprite:${payload.targetId}`];
    case OP.COSTUME_SELECT:
        return [`costume:${payload.targetId}`];
    default:
        return [];
    }
};

export {
    OpApplier,
    entityKeysForOp
};
