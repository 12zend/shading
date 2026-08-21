import React from 'react';
import {shallow} from 'enzyme';
import VM from 'scratch-vm';

import CollaborationPanel from '../../../src/components/collaboration-panel/collaboration-panel';

describe('CollaborationPanel', () => {
    beforeAll(() => {
        global.window = {innerHeight: 800, innerWidth: 1280};
    });

    afterAll(() => {
        delete global.window;
    });

    test('opens and closes from the launcher button', () => {
        const component = shallow(
            <CollaborationPanel vm={Object.create(VM.prototype)} />,
            {disableLifecycleMethods: true}
        );

        component.find('button[aria-label="チーム共同編集を開く"]').simulate('click');
        expect(component.state('open')).toBe(true);

        component.find('button[aria-label="チーム共同編集を開く"]').simulate('click');
        expect(component.state('open')).toBe(false);
    });
});
