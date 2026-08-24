import {
    getSelectedEditorTab,
    isSearchableEventBlock,
    openFindBar
} from '../../../src/addons/addons/find-bar/userscript';

describe('find bar event indexing', () => {
    test('includes Movie hats', () => {
        expect(isSearchableEventBlock('event_initialize')).toBe(true);
        expect(isSearchableEventBlock('event_renderframe')).toBe(true);
        expect(isSearchableEventBlock('event_whenkeypressed')).toBe(true);
        expect(isSearchableEventBlock('motion_movesteps')).toBe(false);
    });
});

describe('find bar compatibility', () => {
    test('uses the code tab when the editor no longer has media tabs', () => {
        expect(getSelectedEditorTab({scratchGui: {}})).toBe(0);
        expect(getSelectedEditorTab({scratchGui: {editorTab: {activeTabIndex: 2}}})).toBe(2);
    });

    test('does not throw when shift-click happens before the find bar mounts', () => {
        const findBar = {findInput: null, showDropDown: jest.fn()};

        expect(openFindBar(findBar, 'definition', undefined, jest.fn())).toBe(false);
        expect(findBar.showDropDown).not.toHaveBeenCalled();
    });

    test('focuses the find bar and opens the selected definition', () => {
        const findBar = {
            findInput: {focus: jest.fn()},
            showDropDown: jest.fn()
        };

        expect(openFindBar(findBar, 'definition', undefined, jest.fn())).toBe(true);
        expect(findBar.findInput.focus).toHaveBeenCalledTimes(1);
        expect(findBar.showDropDown).toHaveBeenCalledWith('definition', undefined);
    });

    test('contains lookup failures so Scratch Blocks can finish the gesture', () => {
        const error = new Error('bad block');
        const onError = jest.fn();
        const findBar = {
            findInput: {focus: jest.fn()},
            showDropDown: jest.fn(() => {
                throw error;
            })
        };

        expect(openFindBar(findBar, 'definition', undefined, onError)).toBe(false);
        expect(onError).toHaveBeenCalledWith(error);
    });
});
