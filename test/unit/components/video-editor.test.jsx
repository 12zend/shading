import React from 'react';
import {IntlProvider} from 'react-intl';
import {shallow} from 'enzyme';

import {UnwrappedVideoEditor} from '../../../src/components/video-editor/video-editor.jsx';

const intl = new IntlProvider({locale: 'en'}, {}).getChildContext().intl;

describe('Video Editor Component', () => {
    let props;

    beforeEach(() => {
        props = {
            onChangeName: jest.fn(),
            onError: jest.fn(),
            onTrim: jest.fn(),
            video: {
                assetId: 'video-id',
                duration: 10,
                frameRate: 30,
                height: 360,
                name: 'clip',
                sourceDuration: 10,
                trimEnd: 10,
                trimStart: 0,
                url: 'blob:video',
                width: 640
            }
        };
    });

    test('saves a selected range as a non-destructive cut', () => {
        const wrapper = shallow(<UnwrappedVideoEditor {...props} intl={intl} />);
        const rangeInputs = wrapper.find('input[type="range"]');

        rangeInputs.at(1).simulate('change', {target: {value: '2'}});
        rangeInputs.at(2).simulate('change', {target: {value: '8'}});
        wrapper.find('button').filterWhere(button => button.text() === 'Keep selection').simulate('click');

        expect(props.onTrim).toHaveBeenCalledWith(2, 8);
    });

    test('shows a play control, a source scrubber, and two trim controls', () => {
        const wrapper = shallow(<UnwrappedVideoEditor {...props} intl={intl} />);

        expect(wrapper.find('video[controls]')).toHaveLength(1);
        expect(wrapper.find('input[type="range"]')).toHaveLength(3);
        expect(wrapper.find('button').filterWhere(button => button.text() === 'Set start')).toHaveLength(1);
        expect(wrapper.find('button').filterWhere(button => button.text() === 'Set end')).toHaveLength(1);
    });
});
