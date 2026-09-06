import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

if (!compatBlocks.stacked.includes('sound_playattime')) {
    compatBlocks.stacked.push('sound_playattime');
}

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getSoundName = value => String(value === null || typeof value === 'undefined' ? '' : value);

/**
 * Play ranged sound blocks against the shared timeline clock.
 *
 * A render-frame script is evaluated repeatedly while the timeline plays. The
 * manager keeps one Web Audio source per block so those evaluations update an
 * existing playback rather than restarting the sound every frame.
 */
class TimelineSound {
    constructor (runtime, timeline) {
        this.runtime = runtime;
        this.timeline = timeline;
        this.playbacks = new Map();
        this.sources = new Set();
        this.recording = false;
        this.recordedSoundEvents = [];
        this.recordedSoundKeys = new Set();
        this.previousPrimitive = runtime._primitives && runtime._primitives.sound_playattime;

        this.handleProjectStart = this.handleProjectStart.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
        this.handleTimelineSeek = this.handleTimelineSeek.bind(this);
        this.handleTimelineUpdate = this.handleTimelineUpdate.bind(this);
        this.playSoundAtTime = this.playSoundAtTime.bind(this);

        if (!runtime._primitives) runtime._primitives = {};
        runtime._primitives.sound_playattime = this.playSoundAtTime;
        runtime.on('PROJECT_START', this.handleProjectStart);
        runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
        runtime.on('SHADING_TIMELINE_SEEK', this.handleTimelineSeek);
        runtime.on('SHADING_TIMELINE_UPDATE', this.handleTimelineUpdate);
    }

    handleProjectStart () {
        this.stopAll();
    }

    handleProjectLoaded () {
        this.stopAll();
    }

    handleTimelineSeek () {
        this.stopAll();
    }

    handleTimelineUpdate (snapshot) {
        if (snapshot && snapshot.isPlaying === false) this.stopAll();
    }

    beginRecording () {
        this.recording = true;
        this.recordedSoundEvents.length = 0;
        this.recordedSoundKeys.clear();
    }

    endRecording () {
        const events = this.recordedSoundEvents.slice();
        this.recording = false;
        this.recordedSoundEvents.length = 0;
        this.recordedSoundKeys.clear();
        return events;
    }

    findSound (target, requestedName) {
        const sounds = target && target.sprite && Array.isArray(target.sprite.sounds) ? target.sprite.sounds : [];
        if (sounds.length === 0) return null;

        const soundName = getSoundName(requestedName);
        const namedSound = sounds.find(sound => sound && sound.name === soundName);
        if (namedSound) return namedSound;

        const requestedIndex = parseInt(soundName, 10);
        if (Number.isNaN(requestedIndex)) return null;
        const index = (((requestedIndex - 1) % sounds.length) + sounds.length) % sounds.length;
        return sounds[index] || null;
    }

    getBlockAtThreadTop (util) {
        const thread = util && util.thread;
        const blocks = thread && (thread.blockContainer || (util.target && util.target.blocks));
        if (!thread || !blocks || typeof blocks.getBlock !== 'function') return null;
        return blocks.getBlock(thread.topBlock);
    }

    isRenderFrameEvaluation (util) {
        const topBlock = this.getBlockAtThreadTop(util);
        return Boolean(topBlock && topBlock.opcode === 'event_renderframe');
    }

    getBlockKey (target, sound, util) {
        const thread = util && util.thread;
        const blockId = thread && typeof thread.peekStack === 'function' ?
            thread.peekStack() : 'sound_playattime';
        return `${target.id || 'target'}:${blockId}:${sound.soundId || sound.name}`;
    }

    getConfiguration (args) {
        const start = Math.max(0, toNumber(args && args.T1));
        const requestedEnd = Number(args && args.T2);
        const end = Number.isFinite(requestedEnd) ? Math.max(start, requestedEnd) : Number.POSITIVE_INFINITY;
        const requestedSpeed = Number(args && args.SPEED);
        const speed = Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 1;
        return {
            end,
            speed,
            start,
            volume: clamp(toNumber(args && args.VOLUME, 100), 0, 100) / 100
        };
    }

    recordSoundAtTime (target, sound, configuration, key) {
        if (this.recordedSoundKeys.has(key)) return;

        const soundBank = target && target.sprite && target.sprite.soundBank;
        const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
            soundBank.getSoundPlayer(sound.soundId) : null;
        const buffer = player && player.buffer;
        if (!buffer || typeof buffer.getChannelData !== 'function') return;

        const currentTime = this.timeline.currentTime;
        const offset = Math.max(0, (currentTime - configuration.start) * configuration.speed);
        if (Number.isFinite(buffer.duration) && offset >= buffer.duration) return;

        this.recordedSoundKeys.add(key);
        this.recordedSoundEvents.push({
            buffer,
            duration: Number.isFinite(configuration.end) ?
                Math.max(0, configuration.end - currentTime) : Infinity,
            key,
            offset,
            pan: this.getTargetPan(target),
            playbackRate: configuration.speed,
            startTime: currentTime,
            volume: configuration.volume * this.getTargetVolume(target)
        });
    }

    playSoundAtTime (args, util) {
        const target = util && util.target;
        if (!target) return;

        const sound = this.findSound(target, args && args.SOUND_MENU);
        if (!sound || !sound.soundId) return;

        const configuration = this.getConfiguration(args);
        const key = this.getBlockKey(target, sound, util);
        const isPlaying = this.timeline.isPlaying;

        // Offline export pauses the shared clock. Record the first active
        // evaluation of each render-frame block as a clip; the exporter mixes
        // those clips into the MP4 audio track after all video frames render.
        if (this.recording && this.isRenderFrameEvaluation(util)) {
            const currentTime = this.timeline.currentTime;
            if (currentTime >= configuration.start && currentTime < configuration.end) {
                this.recordSoundAtTime(target, sound, configuration, key);
            }
            return;
        }

        // A paused render-frame evaluation is used to redraw a scrubbed frame;
        // it should not make the editor play audio on every scrub.
        if (!isPlaying && this.isRenderFrameEvaluation(util)) {
            this.stopPlayback(key);
            return;
        }

        if (!isPlaying) {
            if (!this.playbacks.has(key)) {
                this.startPlayback(target, sound, {
                    ...configuration,
                    duration: Number.isFinite(configuration.end) ?
                        Math.max(0, configuration.end - configuration.start) : Infinity,
                    offset: 0,
                    key
                });
            }
            return;
        }

        const currentTime = this.timeline.currentTime;
        if (currentTime < configuration.start || currentTime >= configuration.end) {
            this.stopPlayback(key);
            return;
        }

        const offset = (currentTime - configuration.start) * configuration.speed;
        const player = target.sprite.soundBank && target.sprite.soundBank.getSoundPlayer(sound.soundId);
        const buffer = player && player.buffer;
        if (!buffer || (Number.isFinite(buffer.duration) && offset >= buffer.duration)) {
            this.stopPlayback(key);
            return;
        }

        let playback = this.playbacks.get(key);
        if (playback && playback.soundId !== sound.soundId) {
            this.stopPlayback(key, playback);
            playback = null;
        }
        if (!playback) {
            playback = this.startPlayback(target, sound, {
                ...configuration,
                duration: Number.isFinite(configuration.end) ? configuration.end - currentTime : Infinity,
                offset,
                key
            });
        }
        if (playback) this.updatePlayback(playback, target, configuration);
    }

    getOutputNode (audioEngine) {
        if (audioEngine && typeof audioEngine.getInputNode === 'function') {
            return audioEngine.getInputNode();
        }
        return audioEngine && audioEngine.inputNode;
    }

    getTargetVolume (target) {
        return clamp(toNumber(target && target.volume, 100), 0, 100) / 100;
    }

    getTargetPan (target) {
        return clamp(toNumber(target && target.soundEffects && target.soundEffects.pan), -100, 100) / 100;
    }

    updatePlayback (playback, target, configuration) {
        if (playback.source && playback.source.playbackRate) {
            playback.source.playbackRate.value = configuration.speed;
        }
        if (playback.gain) {
            playback.gain.gain.value = configuration.volume * this.getTargetVolume(target);
        }
        if (playback.pan) playback.pan.pan.value = this.getTargetPan(target);
    }

    startPlayback (target, sound, configuration) {
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
            soundBank.getSoundPlayer(sound.soundId) : null;
        const buffer = player && player.buffer;
        const outputNode = this.getOutputNode(audioEngine);
        if (!context || typeof context.createBufferSource !== 'function' || !buffer || !outputNode) return null;

        const source = context.createBufferSource();
        const nodes = [source];
        source.buffer = buffer;
        source.playbackRate.value = configuration.speed;
        let output = source;
        let pan = null;
        let gain = null;

        if (typeof context.createStereoPanner === 'function') {
            pan = context.createStereoPanner();
            pan.pan.value = this.getTargetPan(target);
            output.connect(pan);
            output = pan;
            nodes.push(pan);
        }
        if (typeof context.createGain === 'function') {
            gain = context.createGain();
            gain.gain.value = configuration.volume * this.getTargetVolume(target);
            output.connect(gain);
            output = gain;
            nodes.push(gain);
        }
        output.connect(outputNode);

        const playback = {
            gain,
            key: configuration.key,
            nodes,
            pan,
            soundId: sound.soundId,
            source
        };
        source.onended = () => {
            this.sources.delete(playback);
            if (this.playbacks.get(playback.key) === playback) this.playbacks.delete(playback.key);
            nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        };
        this.sources.add(playback);
        this.playbacks.set(configuration.key, playback);

        const when = Number.isFinite(Number(context.currentTime)) ? Number(context.currentTime) : 0;
        const offset = Math.max(0, toNumber(configuration.offset));
        const sourceDuration = Number(configuration.duration);
        try {
            if (Number.isFinite(sourceDuration)) {
                const duration = Math.max(0, sourceDuration * configuration.speed);
                if (duration <= 0) {
                    this.stopPlayback(configuration.key, playback);
                    return null;
                }
                source.start(when, offset, duration);
            } else {
                source.start(when, offset);
            }
        } catch (error) {
            this.stopPlayback(configuration.key, playback);
            return null;
        }
        return playback;
    }

    stopPlayback (key, requestedPlayback) {
        const playback = requestedPlayback || this.playbacks.get(key);
        if (!playback) return;
        playback.source.onended = null;
        try {
            playback.source.stop(0);
        } catch (error) {
            // The source may have ended between timeline evaluations.
        }
        playback.nodes.forEach(node => {
            if (typeof node.disconnect === 'function') node.disconnect();
        });
        this.sources.delete(playback);
        if (this.playbacks.get(key) === playback) this.playbacks.delete(key);
    }

    stopAll () {
        for (const playback of Array.from(this.sources)) this.stopPlayback(playback.key, playback);
        this.sources.clear();
        this.playbacks.clear();
    }

    dispose () {
        this.stopAll();
        this.endRecording();
        this.runtime.off('PROJECT_START', this.handleProjectStart);
        this.runtime.off('PROJECT_LOADED', this.handleProjectLoaded);
        this.runtime.off('SHADING_TIMELINE_SEEK', this.handleTimelineSeek);
        this.runtime.off('SHADING_TIMELINE_UPDATE', this.handleTimelineUpdate);
        if (this.runtime._primitives.sound_playattime === this.playSoundAtTime) {
            if (this.previousPrimitive) this.runtime._primitives.sound_playattime = this.previousPrimitive;
            else delete this.runtime._primitives.sound_playattime;
        }
        if (this.runtime.shadingTimelineSound === this) delete this.runtime.shadingTimelineSound;
    }
}

const installTimelineSound = (runtime, timeline) => {
    if (!runtime) return null;
    if (runtime.shadingTimelineSound) return runtime.shadingTimelineSound;
    const sound = new TimelineSound(runtime, timeline);
    runtime.shadingTimelineSound = sound;
    return sound;
};

export {
    TimelineSound,
    installTimelineSound
};

export default installTimelineSound;
