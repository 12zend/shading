/**
 * @jest-environment jsdom
 */
/* global WebAudioTestAPI */
import 'web-audio-test-api';
WebAudioTestAPI.setState({
    'AudioContext#resume': 'enabled'
});

import SharedAudioContext from '../../../src/lib/audio/shared-audio-context';

describe('Shared Audio Context', () => {
    const audioContext = new AudioContext();

    test('returns empty object without user gesture', () => {
        const sharedAudioContext = new SharedAudioContext();
        expect(sharedAudioContext).toMatchObject({});
    });

    test('returns AudioContext after the first user gesture', () => {
        // Touch-capable documents (jsdom is one) start audio on touchstart, others on mousedown.
        const gesture = typeof document.ontouchstart === 'undefined' ? 'mousedown' : 'touchstart';
        document.dispatchEvent(new Event(gesture));
        const sharedAudioContext = new SharedAudioContext();
        expect(sharedAudioContext).toMatchObject(audioContext);
    });
});
