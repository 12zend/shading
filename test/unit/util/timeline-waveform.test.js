import {
    collectSoundEvents,
    getWaveformPath,
    getWaveformPeak,
    mixEnvelope
} from '../../../src/lib/timeline-waveform';

// A fake AudioBuffer: `seconds` of constant amplitude at 1000 Hz sample rate.
const makeBuffer = (seconds, amplitude = 1) => {
    const samples = new Float32Array(seconds * 1000).fill(amplitude);
    return {
        duration: seconds,
        getChannelData: () => samples,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 1000
    };
};

const makeTarget = blocks => {
    const byId = {};
    for (const block of blocks) byId[block.id] = block;
    return {
        blocks: {
            _blocks: byId,
            getBlock: id => byId[id],
            getTopLevelScript: id => {
                let block = byId[id];
                while (block && block.parent) block = byId[block.parent];
                return block && block.id;
            }
        },
        isOriginal: true,
        sprite: {sounds: [{name: 'Beat', soundId: 'beat'}]}
    };
};

const shadow = (id, parent, fieldName, value) => ({
    id, parent, opcode: 'shadow', inputs: {}, fields: {[fieldName]: {name: fieldName, value}}, shadow: true
});

const soundScript = (start, end, {hat = 'event_renderframe', speed = '1', volume = '100'} = {}) => [
    {id: 'hat', opcode: hat, parent: null, inputs: {}, fields: {}},
    {
        id: 'play',
        opcode: 'sound_playattime',
        parent: 'hat',
        fields: {},
        inputs: {
            SOUND_MENU: {block: 'menu', shadow: 'menu'},
            T1: {block: 'start', shadow: 'start'},
            T2: {block: 'end', shadow: 'end'},
            SPEED: {block: 'speed', shadow: 'speed'},
            VOLUME: {block: 'volume', shadow: 'volume'}
        }
    },
    shadow('menu', 'play', 'SOUND_MENU', 'Beat'),
    shadow('start', 'play', 'NUM', start),
    shadow('end', 'play', 'NUM', end),
    shadow('speed', 'play', 'NUM', speed),
    shadow('volume', 'play', 'NUM', volume)
];

describe('timeline volume wave', () => {
    test('places sound blocks from render-frame scripts on the timeline', () => {
        const vm = {runtime: {targets: [makeTarget(soundScript('1.5', '4', {speed: '2', volume: '50'}))]}};
        const events = collectSoundEvents(vm, 30);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual(expect.objectContaining({start: 1.5, end: 4, speed: 2, volume: 0.5}));
    });

    test('ignores sound blocks outside render-frame scripts or driven by reporters', () => {
        expect(collectSoundEvents({runtime: {targets: [
            makeTarget(soundScript('1', '2', {hat: 'event_whenflagclicked'}))
        ]}}, 30)).toEqual([]);
        const reporterBlocks = soundScript('1', '2');
        reporterBlocks[1].inputs.T1 = {block: 'reporter', shadow: 'start'};
        expect(collectSoundEvents({runtime: {targets: [makeTarget(reporterBlocks)]}}, 30)).toEqual([]);
    });

    test('mixes sounds by start, end, speed and volume', () => {
        const waveform = mixEnvelope([
            {start: 1, end: Infinity, speed: 1, volume: 0.5, buffer: makeBuffer(2)},
            {start: 5, end: 6, speed: 2, volume: 1, buffer: makeBuffer(4, 0.25)}
        ], 10);
        expect(getWaveformPeak(waveform, 0, 0.9)).toBe(0);
        expect(getWaveformPeak(waveform, 1.1, 2.9)).toBeCloseTo(0.5);
        // The 2 s sound ends at 3 s.
        expect(getWaveformPeak(waveform, 3.1, 4.9)).toBe(0);
        // Cut off at the range end even though the sound is longer.
        expect(getWaveformPeak(waveform, 5.1, 5.9)).toBeCloseTo(0.25);
        expect(getWaveformPeak(waveform, 6.1, 10)).toBe(0);
    });

    test('draws nothing for silence and a closed path for sound', () => {
        const silent = mixEnvelope([], 10);
        expect(getWaveformPath(silent, {width: 100, height: 20, start: 0, pixelsPerSecond: 10})).toBe('');
        const loud = mixEnvelope([{start: 0, end: 10, speed: 1, volume: 1, buffer: makeBuffer(10)}], 10);
        expect(getWaveformPath(loud, {width: 100, height: 20, start: 0, pixelsPerSecond: 10}))
            .toMatch(/^M.*Z$/);
    });
});
