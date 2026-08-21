import EventEmitter from 'events';

import {
    LIMITS,
    OP_CTRL,
    makeOpEnvelope,
    makeProposeEnvelope,
    validateOpEnvelope,
    validateOpPayload
} from './op-protocol';
import {entityKeysForOp} from './op-applier';

const GAP_REQUEST_DELAY_MS = 3000;
const GAP_RESYNC_DELAY_MS = 10000;
const PENDING_OP_TIMEOUT_MS = 30000;
const PENDING_PRUNE_INTERVAL_MS = 10000;
const MAX_BUFFERED_OPS = 5000;

/**
 * The op-based collaboration engine, modeled after the MistWarp engine.
 *
 * One class covers both roles because the collaboration worker elects the
 * host (earliest joined editable member) and clients may be promoted at
 * any time:
 *
 * - Host role: sequences every operation (its own and relayed client
 *   proposals), keeps a bounded op log for catch-up replays, broadcasts
 *   sequenced ops to the room through the worker relay.
 * - Client role: submits local edits as proposals and applies the host's
 *   sequenced op stream in strict order. Local edits are applied
 *   optimistically (capture is post-hoc) and confirmed on echo; remote ops
 *   that conflict with unconfirmed local edits trigger a re-assertion so
 *   every peer converges on host order.
 *
 * Events:
 *  - 'op-applied' (envelope) - a remote op mutated the local document
 *  - 'op-rejected' ({clientOpId, reason})
 *  - 'resync-needed' (reason) - ordered apply is broken; request snapshot
 */
class OpEngine extends EventEmitter {
    /**
     * @param {object} options Options.
     * @param {Function} options.send (message) => boolean. Transport into
     * the collaboration worker; returns false when offline.
     * @param {object} options.applier An OpApplier instance.
     * @param {string} options.clientId This peer's stable member id.
     */
    constructor ({send, applier, clientId}) {
        super();
        this.send = send;
        this.applier = applier;
        this.clientId = clientId;

        this.isHost = false;
        this.epoch = 0;
        this.seq = 0;
        this.lastAppliedSeq = null;
        this.opLog = [];
        this.pendingOps = [];
        this._opBuffer = new Map();
        this._clientOpCounter = 0;

        this._gapRequestTimer = null;
        this._gapResyncTimer = null;
        this._pruneTimer = setInterval(() => this._prunePendingOps(), PENDING_PRUNE_INTERVAL_MS);
    }

    destroy () {
        this._clearGapTimers();
        if (this._pruneTimer) {
            clearInterval(this._pruneTimer);
            this._pruneTimer = null;
        }
        this.opLog = [];
        this.pendingOps = [];
        this._opBuffer.clear();
        this.removeAllListeners();
    }

    get isActive () {
        return Boolean(this.epoch > 0 || this.isHost);
    }

    /**
     * Switch roles/epoch. A new epoch invalidates all sequence state; the
     * manager calls setBaseSeq once the fresh snapshot has been loaded.
     * @param {object} options Options.
     * @param {boolean} options.isHost Whether this peer is now the host.
     * @param {number} [options.epoch] Monotonic room epoch.
     */
    setRole ({isHost, epoch}) {
        const nextEpoch = typeof epoch === 'number' ? epoch : this.epoch + 1;
        if (this.isHost === isHost && this.epoch === nextEpoch) return;
        this.isHost = isHost;
        this.epoch = nextEpoch;
        this.seq = 0;
        this.opLog = [];
        this.pendingOps = [];
        this._opBuffer.clear();
        this.lastAppliedSeq = null;
        this._clearGapTimers();
    }

    /**
     * Establish the base sequence after a snapshot load, then drain any
     * ops buffered while the snapshot streamed in.
     * @param {number} atSeq The base sequence number (usually 0).
     */
    setBaseSeq (atSeq) {
        this.lastAppliedSeq = atSeq;
        this._drainBuffer();
    }

    /**
     * Submit a local edit that has already been applied to the local
     * document. It becomes a pending op until the host echoes it back.
     * @param {string} type Op type.
     * @param {object} payload Op payload.
     * @returns {number|null} The clientOpId, or null when not active.
     */
    submitLocal (type, payload) {
        if (!this.isActive) return null;
        this._clientOpCounter++;
        const clientOpId = this._clientOpCounter;
        if (this.isHost) {
            // The host's own document has already been mutated (capture is
            // post-hoc), so sequence and broadcast without re-applying.
            const op = makeOpEnvelope(type, payload, {
                seq: ++this.seq,
                epoch: this.epoch,
                clientId: this.clientId,
                clientOpId
            });
            this._appendToLog(op);
            this.send({type: OP_CTRL.OP_BROADCAST, epoch: this.epoch, ops: [op]});
            return clientOpId;
        }
        this.pendingOps.push({
            clientOpId,
            type,
            payload,
            keys: entityKeysForOp(type, payload),
            submittedAt: Date.now()
        });
        if (this.pendingOps.length > LIMITS.MAX_OPS_IN_FLIGHT) {
            this.pendingOps.shift();
        }
        this.send({
            type: OP_CTRL.PROPOSE_BATCH,
            epoch: this.epoch,
            ops: [makeProposeEnvelope(type, payload, clientOpId)]
        });
        return clientOpId;
    }

    /**
     * Ask the host to replay ops from fromSeq (gap recovery).
     * @param {number} fromSeq First wanted sequence number.
     */
    requestOpsFrom (fromSeq) {
        this.send({type: OP_CTRL.OPS_REQUEST, epoch: this.epoch, fromSeq});
    }

    /**
     * Handle one message routed by the collaboration worker.
     * @param {object} message The decoded relay message.
     */
    handleMessage (message) {
        if (!message || !this.isActive) return;
        switch (message.type) {
        case OP_CTRL.PROPOSE_BATCH:
            if (this.isHost) this._onProposals(message);
            break;
        case OP_CTRL.OP_BROADCAST:
            if (!this.isHost && Array.isArray(message.ops)) {
                message.ops.forEach(op => this._onSequencedOp(op));
            }
            break;
        case OP_CTRL.OP_REJECT:
            this._onReject(message);
            break;
        case OP_CTRL.OPS_REQUEST:
            if (this.isHost) this._onOpsRequest(message);
            break;
        case OP_CTRL.OP_REPLAY:
            if (!this.isHost && Array.isArray(message.ops)) {
                message.ops.forEach(op => this._onSequencedOp(op));
            }
            break;
        case OP_CTRL.HOST_CHANGED:
            break;
        default:
            break;
        }
    }

    _onProposals (message) {
        const proposals = Array.isArray(message.ops) ?
            message.ops.slice(0, LIMITS.MAX_BATCH_OPS) : [];
        const sequenced = [];
        for (const proposal of proposals) {
            if (!proposal || proposal.kind !== 'propose') continue;
            if (typeof proposal.epoch === 'number' && proposal.epoch !== this.epoch) continue;
            try {
                const error = validateOpPayload(proposal.type, proposal.payload);
                if (error) throw new Error(error);
                if (typeof this.applier.validate === 'function') {
                    this.applier.validate(proposal.type, proposal.payload);
                }
            } catch (error) {
                this.send({
                    type: OP_CTRL.OP_REJECT,
                    to: message.from,
                    clientOpId: proposal.clientOpId,
                    reason: error && error.message ? String(error.message).slice(0, 200) : 'rejected'
                });
                continue;
            }
            // Validate first: host order is definitional, and a failing op
            // must not consume a sequence number.
            this.applier.apply(proposal.type, proposal.payload, {clientId: message.from});
            const op = makeOpEnvelope(proposal.type, proposal.payload, {
                seq: ++this.seq,
                epoch: this.epoch,
                clientId: message.from,
                clientOpId: proposal.clientOpId
            });
            this._appendToLog(op);
            sequenced.push(op);
        }
        if (sequenced.length > 0) {
            this.send({type: OP_CTRL.OP_BROADCAST, epoch: this.epoch, ops: sequenced});
        }
    }

    _onOpsRequest (message) {
        const ops = this.opsSince(message.fromSeq);
        if (ops === null) {
            this.emit('resync-needed', 'host op log no longer covers the requested position');
            return;
        }
        if (ops.length > 0) {
            this.send({type: OP_CTRL.OP_REPLAY, to: message.from, epoch: this.epoch, ops});
        }
    }

    /**
     * Ops from the log starting at fromSeq, or null when the log has
     * already aged past it (the requester must fully resync).
     * @param {number} fromSeq First wanted sequence number.
     * @returns {Array.<object>|null} Op envelopes, or null.
     */
    opsSince (fromSeq) {
        if (!Number.isInteger(fromSeq)) return null;
        if (fromSeq > this.seq) return [];
        const oldest = this.opLog.length > 0 ? this.opLog[0].seq : this.seq + 1;
        if (fromSeq < oldest) return null;
        return this.opLog.filter(op => op.seq >= fromSeq);
    }

    _appendToLog (op) {
        this.opLog.push(op);
        if (this.opLog.length > LIMITS.MAX_OPS_IN_FLIGHT) {
            this.opLog.shift();
        }
    }

    _onSequencedOp (envelope) {
        const error = validateOpEnvelope(envelope);
        if (error) return;
        if (envelope.epoch !== this.epoch) return;
        if (this.lastAppliedSeq === null) {
            // Snapshot not applied yet; hold on to everything.
            this._bufferOp(envelope);
            return;
        }
        if (envelope.seq <= this.lastAppliedSeq) return; // duplicate/replay
        if (envelope.seq === this.lastAppliedSeq + 1) {
            this._applyOp(envelope);
            this._drainBuffer();
            return;
        }
        this._bufferOp(envelope);
        this._scheduleGapRecovery();
    }

    _bufferOp (envelope) {
        if (this._opBuffer.size >= MAX_BUFFERED_OPS) {
            this._opBuffer.clear();
            this.emit('resync-needed', 'op buffer overflow');
            return;
        }
        this._opBuffer.set(envelope.seq, envelope);
    }

    _drainBuffer () {
        while (this.lastAppliedSeq !== null && this._opBuffer.has(this.lastAppliedSeq + 1)) {
            const next = this._opBuffer.get(this.lastAppliedSeq + 1);
            this._opBuffer.delete(next.seq);
            this._applyOp(next);
        }
        // Drop anything the snapshot already covered.
        if (this.lastAppliedSeq !== null) {
            for (const seq of Array.from(this._opBuffer.keys())) {
                if (seq <= this.lastAppliedSeq) this._opBuffer.delete(seq);
            }
        }
        if (this._opBuffer.size === 0) {
            this._clearGapTimers();
        } else {
            this._scheduleGapRecovery();
        }
    }

    _applyOp (envelope) {
        // Our own echo: the edit is already in the local doc. Confirm and skip.
        if (envelope.clientId === this.clientId) {
            const index = this.pendingOps.findIndex(p => p.clientOpId === envelope.clientOpId);
            if (index !== -1) {
                this.lastAppliedSeq = envelope.seq;
                this.pendingOps.splice(index, 1);
                return;
            }
        }

        this.lastAppliedSeq = envelope.seq;

        let applied = false;
        try {
            this.applier.apply(envelope.type, envelope.payload, {
                clientId: envelope.clientId,
                seq: envelope.seq
            });
            applied = true;
        } catch (error) {
            this.emit('resync-needed', `failed to apply op ${envelope.seq}: ${error.message}`);
        }
        if (applied) this.emit('op-applied', envelope);

        // Re-assert unconfirmed local ops the remote op just overwrote, so
        // our document matches eventual host order (the host will sequence
        // our proposal after this op).
        const keys = entityKeysForOp(envelope.type, envelope.payload);
        if (keys.length === 0) return;
        for (const pending of this.pendingOps.slice()) {
            if (!pending.keys.some(key => keys.indexOf(key) !== -1)) continue;
            try {
                this.applier.apply(pending.type, pending.payload, {clientId: this.clientId});
            } catch (error) {
                // The re-assert no longer applies (e.g. entity deleted).
                // The host will reject or no-op it identically.
            }
        }
    }

    _onReject (message) {
        const index = this.pendingOps.findIndex(p => p.clientOpId === message.clientOpId);
        if (index !== -1) {
            this.pendingOps.splice(index, 1);
        }
        this.emit('op-rejected', {clientOpId: message.clientOpId, reason: message.reason});
    }

    _scheduleGapRecovery () {
        if (this._gapRequestTimer || this._gapResyncTimer) return;
        this._gapRequestTimer = setTimeout(() => {
            this._gapRequestTimer = null;
            if (this._opBuffer.size === 0 || this.lastAppliedSeq === null) return;
            this.requestOpsFrom(this.lastAppliedSeq + 1);
            this._gapResyncTimer = setTimeout(() => {
                this._gapResyncTimer = null;
                if (this._opBuffer.size > 0) {
                    this.emit('resync-needed', 'gap replay did not arrive');
                }
            }, GAP_RESYNC_DELAY_MS);
        }, GAP_REQUEST_DELAY_MS);
    }

    _clearGapTimers () {
        if (this._gapRequestTimer) {
            clearTimeout(this._gapRequestTimer);
            this._gapRequestTimer = null;
        }
        if (this._gapResyncTimer) {
            clearTimeout(this._gapResyncTimer);
            this._gapResyncTimer = null;
        }
    }

    _prunePendingOps () {
        const now = Date.now();
        const before = this.pendingOps.length;
        this.pendingOps = this.pendingOps.filter(
            pending => now - pending.submittedAt < PENDING_OP_TIMEOUT_MS
        );
        if (this.pendingOps.length < before) {
            this.emit('resync-needed', 'local ops were never acknowledged by the host');
        }
    }
}

export default OpEngine;
