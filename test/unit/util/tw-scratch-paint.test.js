import {ScratchPaintReducer} from '../../../src/lib/tw-scratch-paint';

jest.mock('scratch-paint', () => ({
    ScratchPaintReducer: (state = {clipboard: {items: []}}) => state
}), {virtual: true});

describe('Lazy scratch-paint reducer', () => {
    test('initializes when the Costumes tab is activated', () => {
        const state = ScratchPaintReducer(undefined, {
            type: 'scratch-gui/navigation/ACTIVATE_TAB',
            activeTabIndex: 1
        });

        expect(state.clipboard.items).toEqual([]);
    });
});
