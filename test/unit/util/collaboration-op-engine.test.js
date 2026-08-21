import OpEngine from '../../../src/lib/collaboration/op-engine';
import {OpApplier, entityKeysForOp} from '../../../src/lib/collaboration/op-applier';
import {OP} from '../../../src/lib/collaboration/op-protocol';

class RecordingApplier extends OpApplier {
    constructor () {
        super();
        this.applied = [];
    }

    validate (type, payload) {
        if (type === OP.SPRITE_DELETE && payload.targetId === 'missing') {
            throw new Error('no such target: missing');
        }
    }

    _apply (type, payload, meta) {
        this.applied.push({type, payload, meta});
    }
}

const TARGET_UPDATE = OP.TARGET_UPDATE;
const targetUpdatePayload = (x, targetId = 't1') => ({
    targetId,
    props: {x}
});

/**
 * Wire two engines together the way the worker relay does: proposals go
 * to the host engine, sequenced ops fan back out to clients.
 */
const buildRoom = () => {
    const hostSend = message => {
        host.outbox.push(message);
    };
    const clientSend = message => {
        client.outbox.push(message);
    };

    const hostApplier = new RecordingApplier();
    const clientApplier = new RecordingApplier();
    const host = new OpEngine({send: hostSend, applier: hostApplier, clientId: 'host'});
    const client = new OpEngine({send: clientSend, applier: clientApplier, clientId: 'client-1'});
    host.outbox = [];
    client.outbox = [];

    // Route each side's outbox through a simulated relay.
    const flush = () => {
        let guard = 0;
        while ((host.outbox.length > 0 || client.outbox.length > 0) && guard < 100) {
            guard++;
            const hostMessages = host.outbox.splice(0);
            const clientMessages = client.outbox.splice(0);
            for (const message of clientMessages) {
                if (message.type === 'op_propose') {
                    host.handleMessage(Object.assign({from: 'client-1'}, message));
                }
            }
            for (const message of hostMessages) {
                if (message.type === 'op_broadcast' || message.type === 'op_send') {
                    client.handleMessage(message);
                } else if (message.type === 'op_reject') {
                    client.handleMessage(message);
                }
            }
        }
    };

    host.setRole({isHost: true, epoch: 1});
    client.setRole({isHost: false, epoch: 1});
    host.setBaseSeq(0);
    client.setBaseSeq(0);
    return {host, client, hostApplier, clientApplier, flush};
};

describe('collaboration op engine', () => {
    test('host sequences its own edits and broadcasts them', () => {
        const room = buildRoom();
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(5));
        expect(room.host.seq).toBe(1);
        expect(room.host.opLog).toHaveLength(1);
        expect(room.host.opLog[0].seq).toBe(1);
        expect(room.host.opLog[0].clientId).toBe('host');
    });

    test('client proposals are sequenced by the host and echoed back', () => {
        const room = buildRoom();
        const clientOpId = room.client.submitLocal(TARGET_UPDATE, targetUpdatePayload(9));
        expect(clientOpId).toBe(1);

        room.flush();
        // The echo confirms the pending op without re-applying it locally.
        expect(room.client.pendingOps).toHaveLength(0);
        expect(room.client.lastAppliedSeq).toBe(1);
        expect(room.clientApplier.applied).toHaveLength(0);
        // The host applied the proposal in host order.
        expect(room.hostApplier.applied).toHaveLength(1);
        expect(room.host.seq).toBe(1);
    });

    test('remote ops apply in strict sequence order', () => {
        const room = buildRoom();
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(1));
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(2));
        room.flush();
        expect(room.client.lastAppliedSeq).toBe(2);
        expect(room.clientApplier.applied.map(entry => entry.payload.props.x))
            .toEqual([1, 2]);
    });

    test('buffered ops drain once a gap is filled', () => {
        const room = buildRoom();
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(1));
        room.flush();
        expect(room.client.lastAppliedSeq).toBe(1);

        // seq 3 arrives before seq 2: it must buffer, not apply.
        const op3 = Object.assign({}, room.host.opLog[0]);
        op3.seq = 3;
        op3.payload = targetUpdatePayload(30);
        room.client._onSequencedOp(op3);
        expect(room.clientApplier.applied).toHaveLength(1);
        expect(room.client._opBuffer.size).toBe(1);

        const op2 = Object.assign({}, room.host.opLog[0]);
        op2.seq = 2;
        op2.payload = targetUpdatePayload(20);
        room.client._onSequencedOp(op2);
        expect(room.clientApplier.applied.map(entry => entry.payload.props.x))
            .toEqual([1, 20, 30]);
        expect(room.client.lastAppliedSeq).toBe(3);
    });

    test('duplicate or stale ops are ignored', () => {
        const room = buildRoom();
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(1));
        room.flush();
        const appliedCount = room.clientApplier.applied.length;
        room.client.handleMessage({
            type: 'op_broadcast',
            epoch: 1,
            ops: [room.host.opLog[0]]
        });
        expect(room.clientApplier.applied.length).toBe(appliedCount);
    });

    test('ops from another epoch are dropped', () => {
        const room = buildRoom();
        const stale = Object.assign({}, room.host.opLog[0], {epoch: 99});
        room.client._onSequencedOp(stale);
        expect(room.clientApplier.applied).toHaveLength(0);
    });

    test('host rejects semantically invalid proposals', () => {
        const room = buildRoom();
        room.client.submitLocal(OP.SPRITE_DELETE, {targetId: 'missing'});
        room.flush();
        expect(room.client.pendingOps).toHaveLength(0);
        expect(room.host.seq).toBe(0);
        expect(room.hostApplier.applied).toHaveLength(0);
    });

    test('conflicting remote ops re-assert unconfirmed local ops', () => {
        const room = buildRoom();
        // The client submits an edit that has already mutated its local doc.
        room.client.submitLocal(TARGET_UPDATE, targetUpdatePayload(42));

        // Before the echo arrives, a remote op touches the same entity.
        const remoteOp = {
            v: 1,
            kind: 'op',
            type: TARGET_UPDATE,
            ts: Date.now(),
            seq: 1,
            epoch: 1,
            clientId: 'other-peer',
            clientOpId: 1,
            payload: targetUpdatePayload(7)
        };
        room.client._onSequencedOp(remoteOp);
        // Remote op applied, then our pending edit re-asserted on top.
        expect(room.clientApplier.applied.map(entry => entry.payload.props.x))
            .toEqual([7, 42]);
        // The pending op stays queued until the host echo confirms it.
        expect(room.client.pendingOps).toHaveLength(1);
    });

    test('setRole invalidates sequence state across epochs', () => {
        const room = buildRoom();
        room.host.submitLocal(TARGET_UPDATE, targetUpdatePayload(1));
        room.client.setRole({isHost: false, epoch: 2});
        expect(room.client.lastAppliedSeq).toBeNull();
        expect(room.client.pendingOps).toHaveLength(0);
        expect(room.client._opBuffer.size).toBe(0);
    });

    test('entity keys conflict only on shared entities', () => {
        const keysA = entityKeysForOp(TARGET_UPDATE, targetUpdatePayload(1, 'a'));
        const keysB = entityKeysForOp(TARGET_UPDATE, targetUpdatePayload(2, 'b'));
        expect(keysA[0]).not.toBe(keysB[0]);
        const blockCreate = entityKeysForOp(OP.BLOCK_EVENT, {
            targetId: 'a',
            event: {type: 'create', blockId: 'x'}
        });
        expect(blockCreate).toEqual(['block:a:x']);
    });
});
