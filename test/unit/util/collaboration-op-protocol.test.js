import {
    LIMITS,
    OP,
    OP_PROTOCOL_VERSION,
    makeOpEnvelope,
    makeProposeEnvelope,
    validateOpEnvelope,
    validateOpPayload
} from '../../../src/lib/collaboration/op-protocol';

const validBlockEventPayload = {
    event: {type: 'change', blockId: 'b1', element: 'field', name: 'TEXT', newValue: 'x'},
    targetId: 't1',
    target: {id: 't1', index: 1, isStage: false, name: 'Sprite1'}
};

const makeValidEnvelope = () => makeOpEnvelope(OP.BLOCK_EVENT, validBlockEventPayload, {
    seq: 1,
    epoch: 1,
    clientId: 'peer-a',
    clientOpId: 3
});

describe('collaboration op protocol', () => {
    test('accepts a well-formed sequenced op envelope', () => {
        expect(validateOpEnvelope(makeValidEnvelope())).toBeNull();
    });

    test('rejects non-object envelopes', () => {
        expect(validateOpEnvelope(null)).not.toBeNull();
        expect(validateOpEnvelope('op')).not.toBeNull();
        expect(validateOpEnvelope([])).not.toBeNull();
    });

    test('rejects unsupported protocol versions', () => {
        const envelope = makeValidEnvelope();
        envelope.v = OP_PROTOCOL_VERSION + 1;
        expect(validateOpEnvelope(envelope)).not.toBeNull();
    });

    test('rejects missing or invalid sequence metadata', () => {
        const missingSeq = makeValidEnvelope();
        delete missingSeq.seq;
        expect(validateOpEnvelope(missingSeq)).not.toBeNull();

        const badEpoch = makeValidEnvelope();
        badEpoch.epoch = -1;
        expect(validateOpEnvelope(badEpoch)).not.toBeNull();

        const badClientOpId = makeValidEnvelope();
        badClientOpId.clientOpId = 'nope';
        expect(validateOpEnvelope(badClientOpId)).not.toBeNull();
    });

    test('rejects unknown op types', () => {
        const envelope = makeValidEnvelope();
        envelope.type = 'definitely-not-an-op';
        expect(validateOpEnvelope(envelope)).not.toBeNull();
    });

    test('target-update rejects disallowed props', () => {
        const error = validateOpPayload(OP.TARGET_UPDATE, {
            targetId: 't1',
            props: {costumeName: 'nope'}
        });
        expect(error).not.toBeNull();
    });

    test('target-update accepts allowed numeric and boolean props', () => {
        expect(validateOpPayload(OP.TARGET_UPDATE, {
            targetId: 't1',
            target: {name: 'Sprite1'},
            props: {x: 10, y: -3.5, visible: true}
        })).toBeNull();
    });

    test('sprite-add enforces asset count limits', () => {
        const assets = {};
        for (let index = 0; index <= LIMITS.MAX_ASSET_COUNT; index++) {
            assets[`a${index}.svg`] = 'data:image/svg+xml;base64,AAAA';
        }
        const error = validateOpPayload(OP.SPRITE_ADD, {
            targetId: 't1',
            spriteJson: '{"objName":"Cat"}',
            assets
        });
        expect(error).not.toBeNull();
    });

    test('sprite-add rejects oversized asset payloads', () => {
        const error = validateOpPayload(OP.SPRITE_ADD, {
            targetId: 't1',
            spriteJson: '{"objName":"Cat"}',
            assets: {'big.png': `data:image/png;base64,${'A'.repeat(LIMITS.MAX_DATA_URL)}`
            }
        });
        expect(error).not.toBeNull();
    });

    test('propose envelopes carry clientOpId without sequence data', () => {
        const proposal = makeProposeEnvelope(OP.COSTUME_SELECT, {
            targetId: 't1',
            index: 2
        }, 7);
        expect(proposal.clientOpId).toBe(7);
        expect(proposal.kind).toBe('propose');
        expect(validateOpPayload(OP.COSTUME_SELECT, proposal.payload)).toBeNull();
    });

    test('block-event validates embedded event shape', () => {
        expect(validateOpPayload(OP.BLOCK_EVENT, {event: {}})).not.toBeNull();
        expect(validateOpPayload(OP.BLOCK_EVENT, {
            event: {type: 'change'},
            targetId: 't1',
            target: null
        })).toBeNull();
    });
});
