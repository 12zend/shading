import React from 'react';
import {shallow} from 'enzyme';
import VM from 'scratch-vm';

import {Timeline} from '../../../src/components/timeline/timeline';

describe('Timeline keyboard controls', () => {
    let component;
    let instance;
    let manager;
    const body = {};

    const makeEvent = overrides => Object.assign({
        altKey: false,
        code: '',
        ctrlKey: false,
        key: '',
        keyCode: 0,
        metaKey: false,
        preventDefault: jest.fn(),
        repeat: false,
        shiftKey: false,
        target: body
    }, overrides);

    beforeAll(() => {
        global.document = {body};
    });

    afterAll(() => {
        delete global.document;
    });

    beforeEach(() => {
        component = shallow(
            <Timeline
                customStageSize={{height: 360, width: 480}}
                framerate={30}
                vm={Object.create(VM.prototype)}
            />,
            {disableLifecycleMethods: true}
        );
        instance = component.instance();
        manager = {
            pauseTimeline: jest.fn(),
            playTimeline: jest.fn(),
            seekTimeline: jest.fn()
        };
        instance.manager = manager;
    });

    test('space toggles playback while the timeline scrubber is focused', () => {
        const scrubber = {tagName: 'INPUT', type: 'range'};
        instance.timelineElement = {contains: target => target === scrubber};
        instance.scrubberElement = scrubber;
        const event = makeEvent({key: ' ', code: 'Space', target: scrubber});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.playTimeline).toHaveBeenCalled();
    });

    test('provides a timeline header space for add-on controls', () => {
        expect(component.find('[data-movie-timeline-addons]')).toHaveLength(1);
    });

    test('space does not toggle playback while editing text', () => {
        const event = makeEvent({
            key: ' ',
            code: 'Space',
            target: {tagName: 'INPUT', type: 'text'}
        });

        instance.handleKeyDown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(manager.playTimeline).not.toHaveBeenCalled();
    });

    test('right arrow advances one frame when no control is focused', () => {
        const event = makeEvent({key: 'ArrowRight', keyCode: 39});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.seekTimeline).toHaveBeenCalledWith(1 / 30);
    });

    test('left arrow moves back one frame when the timeline is focused', () => {
        const timelineControl = {tagName: 'INPUT', type: 'range'};
        instance.timelineElement = {contains: target => target === timelineControl};
        instance.scrubberElement = timelineControl;
        component.setState({
            timeline: Object.assign({}, instance.state.timeline, {currentTime: 1})
        });
        const event = makeEvent({key: 'ArrowLeft', keyCode: 37, target: timelineControl});

        instance.handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(manager.seekTimeline).toHaveBeenCalledWith(29 / 30);
    });

    test('arrow keys do not move the timeline while editing text or focusing another control', () => {
        const textEvent = makeEvent({
            key: 'ArrowRight',
            keyCode: 39,
            target: {tagName: 'TEXTAREA'}
        });
        const otherButtonEvent = makeEvent({
            key: 'ArrowLeft',
            keyCode: 37,
            target: {tagName: 'BUTTON'}
        });

        instance.handleKeyDown(textEvent);
        instance.handleKeyDown(otherButtonEvent);

        expect(manager.seekTimeline).not.toHaveBeenCalled();
    });

    test('volume slider keeps its native keyboard controls inside the timeline', () => {
        const volumeSlider = {tagName: 'INPUT', type: 'range'};
        instance.timelineElement = {contains: target => target === volumeSlider};
        instance.scrubberElement = {tagName: 'INPUT', type: 'range'};
        const event = makeEvent({key: 'ArrowRight', keyCode: 39, target: volumeSlider});

        instance.handleKeyDown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(manager.seekTimeline).not.toHaveBeenCalled();
    });
});
