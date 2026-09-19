import {
    MovieRenderingFrameStore,
    drawRenderingFrame,
    withRenderingFrames
} from '../../../scratch-vm/src/lib/movie-rendering-frame-store';
import {createMixedAudioBuffer} from '../../../scratch-vm/src/lib/movie-asset-manager-render-export';

const makeStore = () => {
    const store = Object.create(MovieRenderingFrameStore.prototype);
    store.nextId = 0;
    store.references = 1;
    store.pendingBytes = 0;
    store.destroy = jest.fn();
    store.transaction = jest.fn(async (mode, operation) => operation({put: jest.fn()}));
    return store;
};

const canvas = () => ({width: 1920, height: 1080, toBlob: callback => callback(new Blob(['png']))});

test('spools 5941 full-HD frames without retaining their pixel surfaces', async () => {
    const store = makeStore();
    const frames = [];
    for (let index = 0; index < 5941; index++) {
        const surface = canvas();
        const frame = store.capture(surface);
        frames.push(frame);
        expect(store.pendingBytes).toBe(1920 * 1080 * 4);
        await frame.ready;
        expect(surface.width * surface.height).toBe(0);
        expect(store.pendingBytes).toBe(0);
    }
    expect(frames).toHaveLength(5941);
    expect(frames[5940]).toMatchObject({width: 1920, height: 1080, id: 5940});
    expect(store.references).toBe(1);
});

test('holds the frame store until pending writes and exports finish after a clear', async () => {
    const store = makeStore();
    let encode;
    const surface = canvas();
    surface.toBlob = callback => { encode = callback; };
    const frame = store.capture(surface);
    const exporting = withRenderingFrames([frame], async () => { await frame.ready; });
    store.release();
    expect(store.destroy).not.toHaveBeenCalled();
    encode(new Blob(['png']));
    await exporting;
    expect(store.destroy).toHaveBeenCalledTimes(1);
});

test('releases surfaces and reports a failed storage write', async () => {
    const store = makeStore();
    store.transaction.mockRejectedValue(new Error('quota'));
    const surface = canvas();
    const frame = store.capture(surface);
    await expect(frame.ready).rejects.toThrow('quota');
    expect(surface.width).toBe(0);
    expect(store.pendingBytes).toBe(0);
    expect(store.references).toBe(1);
});

test('bounds legacy synchronous capture queues without returning a promise', () => {
    const store = makeStore();
    store.pendingBytes = 128 * 1024 * 1024;
    const surface = canvas();
    expect(() => store.capture(surface)).toThrow('Too many pending frames');
    expect(surface.width).toBe(0);
});

test('closes each decoded bitmap even when drawing fails', async () => {
    const original = global.createImageBitmap;
    const bitmap = {close: jest.fn()};
    global.createImageBitmap = jest.fn(async () => bitmap);
    try {
        const frame = {store: {read: async () => new Blob(['png'])}};
        await expect(drawRenderingFrame({drawImage: () => { throw new Error('draw'); }}, frame, 10, 10))
            .rejects.toThrow('draw');
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    } finally {
        global.createImageBitmap = original;
    }
});

const audioContext = {
    createBuffer: (channels, length, sampleRate) => {
        const data = Array.from({length: channels}, () => new Float32Array(length));
        return {sampleRate, numberOfChannels: channels, getChannelData: channel => data[channel]};
    }
};

test('chunked audio matches the full mix across clip offsets, resampling, speed and pan', () => {
    const source = audioContext.createBuffer(2, 44100 * 4, 44100);
    for (let index = 0; index < 44100 * 4; index++) {
        source.getChannelData(0)[index] = Math.sin(index / 100);
        source.getChannelData(1)[index] = Math.cos(index / 70);
    }
    const clips = [
        {buffer: source, startTime: 0.17, offset: 0.13, playbackRate: 0.7, volume: 0.8, pan: 0.3},
        {buffer: source, startTime: 1.8, offset: 0.3, duration: 0.7, playbackRate: 1.5, volume: 0.6, pan: -0.4}
    ];
    const full = createMixedAudioBuffer(audioContext, clips, 3.25, 48000, 0.5);
    for (const [start, duration] of [[0, 1], [1, 1], [2, 1], [3, 0.25]]) {
        const chunk = createMixedAudioBuffer(audioContext, clips, duration, 48000, 0.5, start);
        for (let channel = 0; channel < 2; channel++) {
            expect(chunk.getChannelData(channel)).toEqual(
                full.getChannelData(channel).slice(start * 48000, (start + duration) * 48000)
            );
        }
    }
});
