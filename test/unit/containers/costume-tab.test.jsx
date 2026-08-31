jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});
jest.mock('../../../src/components/asset-panel/asset-panel.jsx', () => () => null);
jest.mock('../../../src/containers/paint-editor-wrapper.jsx', () => () => null);
jest.mock('../../../src/lib/file-uploader.js', () => ({
    costumeUpload: jest.fn(),
    handleFileUpload: jest.fn()
}));

import {CostumeTab} from '../../../src/containers/costume-tab.jsx';

const makeTarget = currentCostume => ({
    costumeCount: 2,
    costumes: [{name: 'costume1'}, {name: 'costume2'}],
    currentCostume
});

const makeProps = target => ({
    editingTarget: 'sprite',
    sprites: {sprite: target},
    stage: {costumes: []}
});

describe('CostumeTab', () => {
    test('does not follow timeline costume changes while the target stays the same', () => {
        const tab = new CostumeTab(makeProps(makeTarget(0)));
        const setState = jest.spyOn(tab, 'setState');

        tab.componentWillReceiveProps(makeProps(makeTarget(1)));

        expect(setState).not.toHaveBeenCalled();
        expect(tab.state.selectedCostumeIndex).toBe(0);
    });
});
