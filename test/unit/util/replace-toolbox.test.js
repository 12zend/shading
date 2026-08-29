import replaceToolbox from '../../../src/lib/replace-toolbox';

describe('replace toolbox', () => {
    test('discards recycled blocks while a structural extension update is rendered', () => {
        const calls = [];
        const flyout = {
            setRecyclingEnabled: jest.fn(enabled => calls.push(`recycling:${enabled}`))
        };
        const workspace = {
            getFlyout: () => flyout,
            updateToolbox: jest.fn(xml => calls.push(`update:${xml}`))
        };

        replaceToolbox(workspace, '<xml/>', true);

        expect(calls).toEqual(['recycling:false', 'update:<xml/>', 'recycling:true']);
    });

    test('keeps normal toolbox updates on the recycling fast path', () => {
        const flyout = {setRecyclingEnabled: jest.fn()};
        const workspace = {
            getFlyout: () => flyout,
            updateToolbox: jest.fn()
        };

        replaceToolbox(workspace, '<xml/>');

        expect(workspace.updateToolbox).toHaveBeenCalledWith('<xml/>');
        expect(flyout.setRecyclingEnabled).not.toHaveBeenCalled();
    });
});
