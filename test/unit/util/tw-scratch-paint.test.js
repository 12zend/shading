import {ScratchPaintReducer, initializeScratchPaint} from '../../../src/lib/tw-scratch-paint';

jest.mock('scratch-paint', () => ({
    ScratchPaintReducer: (state = {clipboard: {items: []}}) => state
}), {virtual: true});

describe('Lazy scratch-paint reducer', () => {
    test('initializes for the inline costume editor without visiting the Costumes tab', () => {
        const state = ScratchPaintReducer(undefined, initializeScratchPaint());

        expect(state.clipboard.items).toEqual([]);
    });
});
