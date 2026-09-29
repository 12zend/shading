/**
 * @fileoverview
 * Loudness envelope of the movie's sound track, for drawing volume waves on the timelines.
 *
 * The track is derived from the "play sound … time: start~end" (and "play sound at frame") blocks in
 * render-frame scripts, using the same rule as playback: during [start, end) the sound plays from
 * offset (time - start) × speed. Blocks whose values come from reporters cannot be placed statically
 * and are left out.
 */
import {parseTimeRange} from '../../scratch-vm/src/lib/time-range';

const SOURCE_PEAKS_PER_SECOND = 200;
const MAX_TIMELINE_BUCKETS = 20000;
const MAX_BUCKETS_PER_SECOND = 100;
const RECOMPUTE_DELAY_MS = 250;

// AudioBuffer -> peak amplitude per 1/SOURCE_PEAKS_PER_SECOND s (max over channels).
const sourcePeakCache = new WeakMap();

const analyzeBuffer = buffer => {
    if (sourcePeakCache.has(buffer)) return sourcePeakCache.get(buffer);
    const bucketSize = Math.max(1, Math.round(buffer.sampleRate / SOURCE_PEAKS_PER_SECOND));
    const peaks = new Float32Array(Math.ceil(buffer.length / bucketSize));
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index++) {
            const value = Math.abs(samples[index]);
            const bucket = (index / bucketSize) | 0;
            if (value > peaks[bucket]) peaks[bucket] = value;
        }
    }
    const result = {duration: buffer.duration, peaks};
    sourcePeakCache.set(buffer, result);
    return result;
};

const readLiteral = (blocks, input) => {
    if (!input || !input.shadow || input.block !== input.shadow) return null;
    const shadow = blocks.getBlock(input.shadow);
    const fields = shadow && shadow.fields ? Object.values(shadow.fields) : [];
    return fields.length === 1 ? fields[0].value : null;
};

const literalNumber = (blocks, input, fallback) => {
    const value = readLiteral(blocks, input);
    if (value === null) return input ? null : fallback;
    const number = Number(value);
    return Number.isNaN(number) ? null : number;
};

const isRenderFrameScript = (blocks, blockId) => {
    const topId = typeof blocks.getTopLevelScript === 'function' ? blocks.getTopLevelScript(blockId) : null;
    const top = topId && blocks.getBlock(topId);
    return Boolean(top && top.opcode === 'event_renderframe');
};

/**
 * Sound events that can be placed on the timeline without running the project.
 * @param {VirtualMachine} vm Scratch VM.
 * @param {number} framerate Timeline frame rate, for frame-based sound blocks.
 * @returns {Array<object>} Events with target, sound, start, end, speed and volume.
 */
const collectSoundEvents = (vm, framerate) => {
    const events = [];
    const targets = (vm && vm.runtime && vm.runtime.targets) || [];
    for (const target of targets) {
        if (!target || !target.isOriginal || !target.blocks || !target.sprite) continue;
        const blocks = target.blocks;
        for (const block of Object.values(blocks._blocks || {})) {
            if (block.opcode !== 'sound_playattime' && block.opcode !== 'sound_playatframe') continue;
            if (!isRenderFrameScript(blocks, block.id)) continue;
            const soundName = readLiteral(blocks, block.inputs.SOUND_MENU);
            const sound = (target.sprite.sounds || []).find(item => item && item.name === String(soundName));
            if (!sound) continue;
            let start;
            let end = Infinity;
            let speed = 1;
            let volume = 100;
            if (block.opcode === 'sound_playatframe') {
                const frame = literalNumber(blocks, block.inputs.FRAME, null);
                if (frame === null) continue;
                start = Math.max(0, frame) / framerate;
            } else if (block.inputs.TIME_RANGE) {
                const range = readLiteral(blocks, block.inputs.TIME_RANGE);
                if (range === null) continue;
                const parsed = parseTimeRange(range);
                start = Math.max(0, parsed.start);
                end = Number.isNaN(parsed.end) ? Infinity : Math.max(start, parsed.end);
                speed = literalNumber(blocks, block.inputs.SPEED, 1);
                volume = literalNumber(blocks, block.inputs.VOLUME, 100);
                if (speed === null || volume === null) continue;
                if (!(speed > 0)) speed = 1;
            } else {
                // The legacy TIME-only block plays from an offset when clicked; it has no timeline position.
                continue;
            }
            events.push({
                end,
                sound,
                speed,
                start,
                target,
                volume: Math.max(0, Math.min(100, volume)) / 100
            });
        }
    }
    return events;
};

const getLoadedBuffer = (target, sound) => {
    const bank = target.sprite && target.sprite.soundBank;
    const player = bank && bank.soundPlayers && bank.soundPlayers[sound.soundId];
    return player && player.buffer ? player.buffer : null;
};

/**
 * Mix the events into a loudness envelope.
 * @param {Array<object>} events Sound events with a decoded `buffer`.
 * @param {number} duration Timeline duration in seconds.
 * @returns {{duration: number, rate: number, peaks: Float32Array}} Envelope, rate in buckets per second.
 */
const mixEnvelope = (events, duration) => {
    const rate = Math.max(1, Math.min(MAX_BUCKETS_PER_SECOND, MAX_TIMELINE_BUCKETS / duration));
    const peaks = new Float32Array(Math.ceil(duration * rate) + 1);
    for (const event of events) {
        const source = analyzeBuffer(event.buffer);
        const playEnd = Math.min(event.end, event.start + (source.duration / event.speed), duration);
        const first = Math.max(0, Math.floor(event.start * rate));
        const last = Math.min(peaks.length - 1, Math.ceil(playEnd * rate));
        for (let bucket = first; bucket < last; bucket++) {
            const time = bucket / rate;
            if (time < event.start) continue;
            const from = Math.floor((time - event.start) * event.speed * SOURCE_PEAKS_PER_SECOND);
            const to = Math.max(from + 1, Math.floor(((time - event.start) + (1 / rate)) *
                event.speed * SOURCE_PEAKS_PER_SECOND));
            let peak = 0;
            for (let index = from; index < to && index < source.peaks.length; index++) {
                if (source.peaks[index] > peak) peak = source.peaks[index];
            }
            peaks[bucket] = Math.min(1, peaks[bucket] + (peak * event.volume));
        }
    }
    return {duration, peaks, rate};
};

const states = new WeakMap();

const getState = vm => {
    let state = states.get(vm);
    if (state) return state;
    state = {listeners: new Set(), timer: null, waveform: null, version: 0, subscribed: false};
    states.set(vm, state);
    return state;
};

const notify = state => {
    for (const listener of state.listeners) listener(state.waveform);
};

const recompute = vm => {
    const state = getState(vm);
    const version = ++state.version;
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    const timeline = manager && typeof manager.getTimelineState === 'function' ? manager.getTimelineState() : {};
    const duration = Number(timeline.duration) > 0 ? Number(timeline.duration) : 10;
    const framerate = Number(timeline.framerate) > 0 ? Number(timeline.framerate) : 30;
    const events = collectSoundEvents(vm, framerate);
    const pending = [];
    for (const event of events) {
        event.buffer = getLoadedBuffer(event.target, event.sound);
        if (!event.buffer && manager && typeof manager.decodeRenderingSound === 'function') {
            pending.push(manager.decodeRenderingSound(event.sound).then(decoded => {
                event.buffer = decoded && decoded.buffer;
            }, () => {}));
        }
    }
    const finish = () => {
        if (version !== state.version) return;
        const ready = events.filter(event => event.buffer);
        state.waveform = ready.length ? mixEnvelope(ready, duration) : null;
        notify(state);
    };
    if (pending.length) Promise.all(pending).then(finish);
    else finish();
};

const scheduleRecompute = vm => {
    const state = getState(vm);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        state.timer = null;
        recompute(vm);
    }, RECOMPUTE_DELAY_MS);
};

const ensureSubscribed = vm => {
    const state = getState(vm);
    if (state.subscribed || !vm || typeof vm.on !== 'function') return;
    state.subscribed = true;
    const schedule = () => scheduleRecompute(vm);
    vm.on('PROJECT_CHANGED', schedule);
    vm.on('PROJECT_LOADED', schedule);
    vm.on('targetsUpdate', schedule);
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    let lastDuration = null;
    if (manager && typeof manager.on === 'function') {
        manager.on('timelineChanged', timeline => {
            if (timeline && timeline.duration !== lastDuration) {
                lastDuration = timeline.duration;
                schedule();
            }
        });
    }
    recompute(vm);
};

/**
 * Listen for the timeline's volume envelope. The listener is called with the current envelope (or null)
 * right away and whenever the sound blocks, sounds or duration change.
 * @param {VirtualMachine} vm Scratch VM.
 * @param {function(?object)} listener Receives {duration, rate, peaks} or null.
 * @returns {function()} Unsubscribe.
 */
const subscribeTimelineWaveform = (vm, listener) => {
    const state = getState(vm);
    state.listeners.add(listener);
    ensureSubscribed(vm);
    listener(state.waveform);
    return () => state.listeners.delete(listener);
};

/**
 * Loudest level (0..1) in [start, end) of an envelope.
 * @param {?object} waveform Envelope from subscribeTimelineWaveform.
 * @param {number} start Start time in seconds.
 * @param {number} end End time in seconds.
 * @returns {number} Peak level.
 */
const getWaveformPeak = (waveform, start, end) => {
    if (!waveform) return 0;
    const first = Math.max(0, Math.floor(start * waveform.rate));
    const last = Math.min(waveform.peaks.length, Math.max(first + 1, Math.ceil(end * waveform.rate)));
    let peak = 0;
    for (let index = first; index < last; index++) {
        if (waveform.peaks[index] > peak) peak = waveform.peaks[index];
    }
    return peak;
};

/**
 * SVG path of a mirrored volume wave, one column per `step` pixels.
 * @param {?object} waveform Envelope.
 * @param {object} options Drawing options.
 * @param {number} options.width Width in pixels.
 * @param {number} options.height Full height in pixels (the wave is centred).
 * @param {number} options.start Time at x = 0.
 * @param {number} options.pixelsPerSecond Horizontal scale.
 * @param {number} [options.step] Pixels per column.
 * @param {number} [options.y] Top of the drawing area.
 * @returns {string} Path data, or '' when there is nothing to draw.
 */
const getWaveformPath = (waveform, {width, height, start, pixelsPerSecond, step = 1, y = 0}) => {
    if (!waveform || width <= 0) return '';
    const middle = y + (height / 2);
    const top = [];
    const bottom = [];
    let audible = false;
    for (let x = 0; x <= width; x += step) {
        const time = start + (x / pixelsPerSecond);
        const peak = time < 0 || time > waveform.duration ? 0 :
            getWaveformPeak(waveform, time, time + (step / pixelsPerSecond));
        // Square-root scaling keeps quiet passages visible next to loud ones.
        const half = Math.sqrt(peak) * (height / 2);
        if (half > 0.01) audible = true;
        top.push(`${x.toFixed(1)} ${(middle - half).toFixed(2)}`);
        bottom.push(`${x.toFixed(1)} ${(middle + half).toFixed(2)}`);
    }
    if (!audible) return '';
    return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
};

export {
    collectSoundEvents,
    getWaveformPath,
    getWaveformPeak,
    mixEnvelope,
    subscribeTimelineWaveform
};
