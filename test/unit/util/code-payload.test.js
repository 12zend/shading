jest.mock('../../../src/lib/backpack/block-to-image', () => () => Promise.resolve('block-image'));
jest.mock('../../../src/lib/backpack/thumbnail', () => () => Promise.resolve('thumbnail'));

import codePayload, {findTopBlock} from '../../../src/lib/backpack/code-payload';
import {Base64} from 'js-base64';

describe('codePayload', () => {
    test('base64 encodes the blocks as json', () => {
        const blocks = '☁︎❤️🐻';
        const payload = codePayload({
            blockObjects: blocks
        });
        return payload.then(p => {
            expect(
                JSON.parse(Base64.decode(p.body))
            ).toEqual(blocks);
        });
    });

    test('marks Movie blocks while preserving the standalone-blocks format', async () => {
        const blocks = [{id: 'render', opcode: 'event_renderframe', topLevel: true}];
        const payload = await codePayload({blockObjects: blocks});
        const stored = JSON.parse(Base64.decode(payload.body));

        expect(stored).toEqual({
            blocks,
            extensionURLs: {},
            mb3: {version: 1}
        });
        expect(findTopBlock(stored)).toEqual(blocks[0]);
    });
});
