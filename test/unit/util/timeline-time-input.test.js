import EventEmitter from 'events';

import {
    beginTimelineTimeInput,
    formatTimeInputValue,
    isEditingTimelineTimeInput
} from '../../../src/lib/timeline-time-input';

const makeManager = (state = {}) => {
    const manager = new EventEmitter();
    manager.timeline = Object.assign({currentTime: 2, duration: 10, framerate: 30, playing: false, recording: false},
        state);
    manager.getTimelineState = () => Object.assign({}, manager.timeline);
    manager.seekTimeline = jest.fn(seconds => {
        const frame = Math.round(Math.max(0, Math.min(manager.timeline.duration, seconds)) * 30);
        manager.timeline.currentTime = frame / 30;
        manager.emit('timelineChanged', manager.getTimelineState());
    });
    manager.pauseTimeline = jest.fn(() => {
        manager.timeline.playing = false;
        manager.emit('timelineChanged', manager.getTimelineState());
    });
    manager.playTimeline = jest.fn(() => {
        manager.timeline.playing = true;
    });
    // A drag on the timeline ruler.
    manager.scrubTo = seconds => manager.seekTimeline(seconds);
    return manager;
};

const makeEditor = text => {
    const editor = {
        text,
        read: () => editor.text,
        write: jest.fn(value => {
            editor.text = value;
        })
    };
    return editor;
};

describe('timeline time input preview', () => {
    test('moves the playhead to the value and back when the edit ends', () => {
        const manager = makeManager();
        const session = beginTimelineTimeInput(manager, makeEditor('5'));

        expect(manager.seekTimeline).toHaveBeenLastCalledWith(5);
        expect(manager.timeline.currentTime).toBe(5);
        expect(isEditingTimelineTimeInput()).toBe(true);

        session.end();

        expect(manager.seekTimeline).toHaveBeenLastCalledWith(2);
        expect(isEditingTimelineTimeInput()).toBe(false);
        expect(manager.listenerCount('timelineChanged')).toBe(0);
    });

    test('follows typed values without rewriting them, and ignores text that is not a number', () => {
        const manager = makeManager();
        const editor = makeEditor('1');
        const session = beginTimelineTimeInput(manager, editor);

        editor.text = '1.';
        session.preview(editor.text);
        editor.text = '-';
        session.preview(editor.text);
        editor.text = '25';
        session.preview(editor.text);

        expect(manager.seekTimeline.mock.calls.map(call => call[0])).toEqual([1, 1, 10]);
        expect(editor.write).not.toHaveBeenCalled();
        expect(editor.text).toBe('25');
        session.end();
    });

    test('writes the playhead time into the value while the timeline is dragged', () => {
        const manager = makeManager();
        const editor = makeEditor('Infinity');
        const session = beginTimelineTimeInput(manager, editor);

        expect(manager.seekTimeline).not.toHaveBeenCalled();
        manager.scrubTo(3.21);
        expect(editor.text).toBe('3.2');
        manager.scrubTo(1 / 30);
        expect(editor.text).toBe('0.034');
        // A preview refresh at the same time leaves the value alone.
        editor.text = '0.0333';
        manager.seekTimeline(manager.timeline.currentTime);
        expect(editor.text).toBe('0.0333');

        session.end();
        expect(manager.timeline.currentTime).toBe(2);
        manager.scrubTo(4);
        expect(editor.text).toBe('0.0333');
    });

    test('a dragged value lands on the same frame when it is typed or reopened', () => {
        for (const framerate of [24, 25, 30, 60, 120]) {
            for (let frame = 0; frame <= framerate * 3; frame++) {
                const value = Number(formatTimeInputValue(frame / framerate));
                expect(Math.floor((value * framerate) + 1e-9)).toBe(frame);
            }
        }
    });

    test('pauses playback for the edit and resumes it afterwards', () => {
        const manager = makeManager({playing: true});
        const editor = makeEditor('');
        const session = beginTimelineTimeInput(manager, editor);

        expect(manager.pauseTimeline).toHaveBeenCalled();
        expect(editor.write).not.toHaveBeenCalled();
        session.end();
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(2);
        expect(manager.playTimeline).toHaveBeenCalled();
    });

    test('does not write playback times into the value', () => {
        const manager = makeManager();
        const editor = makeEditor('1');
        const session = beginTimelineTimeInput(manager, editor);

        manager.timeline.playing = true;
        manager.timeline.currentTime = 4;
        manager.emit('timelineChanged', manager.getTimelineState());

        expect(editor.write).not.toHaveBeenCalled();
        session.end();
    });

    test('starting another edit finishes the previous one', () => {
        const manager = makeManager();
        const first = beginTimelineTimeInput(manager, makeEditor('5'));
        const second = beginTimelineTimeInput(manager, makeEditor('7'));

        expect(manager.seekTimeline.mock.calls.map(call => call[0])).toEqual([5, 2, 7]);
        first.end();
        expect(isEditingTimelineTimeInput()).toBe(true);
        second.end();
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(2);
        expect(isEditingTimelineTimeInput()).toBe(false);
    });

    test('does nothing while the timeline is rendering', () => {
        const manager = makeManager({recording: true});

        expect(beginTimelineTimeInput(manager, makeEditor('5'))).toBeNull();
        expect(manager.seekTimeline).not.toHaveBeenCalled();
        expect(isEditingTimelineTimeInput()).toBe(false);
    });

    test('formats frame times in whole milliseconds', () => {
        expect(formatTimeInputValue(2 / 3)).toBe('0.667');
        expect(formatTimeInputValue(4)).toBe('4');
        expect(formatTimeInputValue(4.2)).toBe('4.2');
        expect(formatTimeInputValue(127 / 30)).toBe('4.234');
        expect(formatTimeInputValue(-0.0001)).toBe('0');
    });
});
