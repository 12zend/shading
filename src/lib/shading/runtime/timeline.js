import installTimelineSound from './timeline-sound';
import {getShadeTimelineSettings, markShadeProject} from '../project-format';

const DEFAULT_DURATION = 10;
const MIN_DURATION = 0.1;
const MAX_DURATION = 60 * 60;

const DEFAULT_RENDER_WIDTH = 1920;
const DEFAULT_RENDER_HEIGHT = 1080;
const DEFAULT_RENDER_FRAMERATE = 30;
const MIN_RENDER_SIZE = 16;
const MAX_RENDER_SIZE = 7680;
const MIN_RENDER_FRAMERATE = 1;
const MAX_RENDER_FRAMERATE = 120;

const THREAD_STATUS_PROMISE_WAIT = 1;
const THREAD_STATUS_DONE = 4;
const MAX_SYNCHRONOUS_RENDER_STEPS = 1000;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const normalizeDuration = value => {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clamp(parsed, MIN_DURATION, MAX_DURATION) : null;
};

const normalizeRenderSize = value => {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? clamp(parsed, MIN_RENDER_SIZE, MAX_RENDER_SIZE) : null;
};

const normalizeRenderFramerate = value => {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? clamp(parsed, MIN_RENDER_FRAMERATE, MAX_RENDER_FRAMERATE) : null;
};

const installEventHats = runtime => {
    if (!runtime._hats) runtime._hats = {};
    runtime._hats.event_initialize = {
        restartExistingThreads: true
    };
    runtime._hats.event_renderframe = {
        restartExistingThreads: true
    };
};

/**
 * A small controller around Scratch VM's project clock.
 *
 * The clock is the same clock used by the Sensing "timer" reporter. The
 * timeline never keeps a second time value, so seeking here also changes the
 * value seen by Scratch blocks and by any renderer that reads projectTimer().
 */
class ShadingTimeline {
    constructor (runtime, options = {}) {
        this.runtime = runtime;
        installEventHats(runtime);
        this.duration = normalizeDuration(options.duration) || DEFAULT_DURATION;
        this.renderWidth = normalizeRenderSize(
            typeof options.renderWidth === 'undefined' ? options.width : options.renderWidth
        ) || DEFAULT_RENDER_WIDTH;
        this.renderHeight = normalizeRenderSize(
            typeof options.renderHeight === 'undefined' ? options.height : options.renderHeight
        ) || DEFAULT_RENDER_HEIGHT;
        this.renderFramerate = normalizeRenderFramerate(
            typeof options.renderFramerate === 'undefined' ? options.framerate : options.renderFramerate
        ) || DEFAULT_RENDER_FRAMERATE;

        this.handleBeforeExecute = this.handleBeforeExecute.bind(this);
        this.handleAfterExecute = this.handleAfterExecute.bind(this);
        this.handleProjectStart = this.handleProjectStart.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
        this.renderFrameTriggeredInStep = false;
        this.runtime.on('BEFORE_EXECUTE', this.handleBeforeExecute);
        this.runtime.on('AFTER_EXECUTE', this.handleAfterExecute);
        this.runtime.on('PROJECT_START', this.handleProjectStart);
        this.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);

        // Opening the editor should show a deterministic first frame.
        this.stop();
    }

    get clock () {
        return this.runtime.ioDevices && this.runtime.ioDevices.clock;
    }

    get currentTime () {
        const clock = this.clock;
        if (!clock || typeof clock.projectTimer !== 'function') return 0;
        const value = Number(clock.projectTimer());
        return Number.isFinite(value) ? clamp(value, 0, this.duration) : 0;
    }

    get isPlaying () {
        const clock = this.clock;
        return Boolean(clock && !clock._paused && this.currentTime < this.duration);
    }

    snapshot () {
        return {
            currentTime: this.currentTime,
            duration: this.duration,
            isPlaying: this.isPlaying,
            renderWidth: this.renderWidth,
            renderHeight: this.renderHeight,
            renderFramerate: this.renderFramerate
        };
    }

    get stepTime () {
        const milliseconds = Number(this.runtime.currentStepTime);
        return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : 1 / 30;
    }

    emitUpdate () {
        this.runtime.emit('SHADING_TIMELINE_UPDATE', this.snapshot());
    }

    triggerRenderFrame (options = {}) {
        let threads = [];
        if (typeof this.runtime.startHats === 'function') {
            threads = this.runtime.startHats('event_renderframe', {}) || [];
        }
        if (options.synchronous) this.executeRenderFrameThreads(threads);
        this.runtime.emit('SHADING_RENDER_FRAME', this.snapshot(), threads);
        return threads;
    }

    /**
     * Drain render-frame scripts that were just started while the timeline is
     * paused. The normal VM tick will eventually run these threads, but that
     * is too late for a scrubbed or offline-rendered frame: the stage would be
     * copied before the script had a chance to update it.
     * @param {Array.<Thread>} threads - Threads started for this frame.
     * @returns {void}
     */
    executeRenderFrameThreads (threads) {
        const sequencer = this.runtime.sequencer;
        const activeThreads = Array.isArray(this.runtime.threads) ? this.runtime.threads : [];
        if (!sequencer || typeof sequencer.stepThread !== 'function') return;

        for (const thread of threads || []) {
            let steps = 0;
            while (
                activeThreads.indexOf(thread) !== -1 &&
                thread.stack &&
                thread.stack.length > 0 &&
                thread.status !== THREAD_STATUS_PROMISE_WAIT &&
                thread.status !== THREAD_STATUS_DONE &&
                steps < MAX_SYNCHRONOUS_RENDER_STEPS
            ) {
                sequencer.stepThread(thread);
                steps++;
            }

            if (
                activeThreads.indexOf(thread) !== -1 &&
                ((thread.stack && thread.stack.length === 0) || thread.status === THREAD_STATUS_DONE)
            ) {
                activeThreads.splice(activeThreads.indexOf(thread), 1);
                if (this.runtime.threadMap && typeof this.runtime.threadMap.delete === 'function') {
                    this.runtime.threadMap.delete(thread.getId());
                }
            }
        }

        if (typeof this.runtime.updateThreadMap === 'function') this.runtime.updateThreadMap();
    }

    updateClock () {
        if (typeof this.runtime.updateCurrentMSecs === 'function') this.runtime.updateCurrentMSecs();
    }

    setClockTime (seconds) {
        const clock = this.clock;
        if (!clock || !clock._projectTimer) return;

        this.updateClock();
        const milliseconds = clamp(Number(seconds) || 0, 0, this.duration) * 1000;
        clock._projectTimer.startTime = this.runtime.currentMSecs - milliseconds;
        if (clock._paused) clock._pausedTime = milliseconds;
    }

    /**
     * Seek the shared Sensing timer. The optional flag is used by the export
     * loop so it does not cause a React update for every encoded frame.
     * @param {number} seconds - The requested project time.
     * @param {boolean} emit - Whether to request a preview frame and notify listeners.
     * @returns {void}
     */
    seek (seconds, emit = true) {
        this.setClockTime(seconds);
        if (emit) {
            this.runtime.emit('SHADING_TIMELINE_SEEK', this.snapshot());
            // Scrubbing is also a render request. The clock is paused here,
            // so the hat runs once for the selected frame instead of being
            // driven by wall-clock time.
            this.triggerRenderFrame({synchronous: !this.isPlaying});
            this.emitUpdate();
        }
    }

    step (direction) {
        const frame = Math.round(this.currentTime / this.stepTime) + Math.sign(direction);
        this.pause();
        this.seek(frame * this.stepTime);
    }

    play () {
        const clock = this.clock;
        if (!clock) return;
        if (this.currentTime >= this.duration) this.setClockTime(0);
        if (clock._paused && typeof clock.resume === 'function') clock.resume();
        this.emitUpdate();
    }

    pause () {
        const clock = this.clock;
        if (!clock) return;
        if (!clock._paused && typeof clock.pause === 'function') clock.pause();
        this.emitUpdate();
    }

    stop () {
        const clock = this.clock;
        if (!clock) return;
        if (!clock._paused && typeof clock.pause === 'function') clock.pause();
        this.setClockTime(0);
        this.triggerRenderFrame({synchronous: true});
        this.emitUpdate();
    }

    restart () {
        const clock = this.clock;
        if (!clock) return;
        this.setClockTime(0);
        if (clock._paused && typeof clock.resume === 'function') clock.resume();
        this.emitUpdate();
    }

    setDuration (seconds, emitProjectChanged = true) {
        const duration = normalizeDuration(seconds);
        if (duration === null) return false;
        const currentTime = this.currentTime;
        const changed = duration !== this.duration;
        this.duration = duration;
        if (currentTime > duration) this.setClockTime(duration);
        if (changed && emitProjectChanged && typeof this.runtime.emitProjectChanged === 'function') {
            this.runtime.emitProjectChanged();
        }
        this.emitUpdate();
        return true;
    }

    setRenderSettings (settings = {}, emitProjectChanged = true) {
        let changed = false;
        const pickDefined = (first, second) => (typeof first === 'undefined' ? second : first);
        const width = normalizeRenderSize(pickDefined(settings.width, settings.renderWidth));
        const height = normalizeRenderSize(pickDefined(settings.height, settings.renderHeight));
        const framerate = normalizeRenderFramerate(
            pickDefined(settings.framerate, settings.renderFramerate)
        );

        if (width !== null && width !== this.renderWidth) {
            this.renderWidth = width;
            changed = true;
        }
        if (height !== null && height !== this.renderHeight) {
            this.renderHeight = height;
            changed = true;
        }
        if (framerate !== null && framerate !== this.renderFramerate) {
            this.renderFramerate = framerate;
            changed = true;
        }
        if (changed) {
            if (emitProjectChanged && typeof this.runtime.emitProjectChanged === 'function') {
                this.runtime.emitProjectChanged();
            }
            this.emitUpdate();
        }
        return changed;
    }

    restore (settings) {
        const duration = normalizeDuration(settings && settings.duration) || DEFAULT_DURATION;
        this.duration = duration;
        this.renderWidth = normalizeRenderSize(settings && (settings.renderWidth || settings.width)) ||
            DEFAULT_RENDER_WIDTH;
        this.renderHeight = normalizeRenderSize(settings && (settings.renderHeight || settings.height)) ||
            DEFAULT_RENDER_HEIGHT;
        this.renderFramerate = normalizeRenderFramerate(
            settings && (settings.renderFramerate || settings.framerate)
        ) || DEFAULT_RENDER_FRAMERATE;
        this.stop();
    }

    toJSON () {
        return {
            duration: this.duration,
            renderWidth: this.renderWidth,
            renderHeight: this.renderHeight,
            renderFramerate: this.renderFramerate
        };
    }

    handleProjectStart () {
        // runtime.greenFlag() resets the clock immediately after PROJECT_START;
        // restart also resumes a clock paused by the timeline stop button.
        this.restart();
        if (typeof this.runtime.startHats === 'function') {
            const threads = this.runtime.startHats('event_initialize', {}) || [];
            this.runtime.emit('SHADING_INITIALIZE', this.snapshot(), threads);
        }
    }

    handleProjectLoaded () {
        this.stop();
    }

    handleBeforeExecute () {
        const clock = this.clock;
        if (!clock || clock._paused) return;

        const currentTime = Number(clock.projectTimer());
        if (!Number.isFinite(currentTime)) return;

        if (currentTime >= this.duration) {
            this.setClockTime(this.duration);
            this.triggerRenderFrame();
            this.renderFrameTriggeredInStep = true;
            if (typeof clock.pause === 'function') clock.pause();
            return;
        }

        this.triggerRenderFrame();
        this.renderFrameTriggeredInStep = true;
    }

    handleAfterExecute () {
        const clock = this.clock;
        if (clock && !clock._paused && Number(clock.projectTimer()) >= this.duration) {
            this.setClockTime(this.duration);
            if (!this.renderFrameTriggeredInStep) this.triggerRenderFrame();
            if (typeof clock.pause === 'function') clock.pause();
        } else if (clock && !clock._paused && !this.renderFrameTriggeredInStep) {
            // Keep the hook useful for runtimes which only expose an
            // AFTER_EXECUTE notification (and for lightweight VM adapters).
            this.triggerRenderFrame();
        }
        this.renderFrameTriggeredInStep = false;
        this.emitUpdate();
    }

    dispose () {
        this.runtime.off('BEFORE_EXECUTE', this.handleBeforeExecute);
        this.runtime.off('AFTER_EXECUTE', this.handleAfterExecute);
        this.runtime.off('PROJECT_START', this.handleProjectStart);
        this.runtime.off('PROJECT_LOADED', this.handleProjectLoaded);
    }
}

const installShadingTimeline = (vm, options = {}) => {
    if (!vm || !vm.runtime) return null;
    if (vm.runtime.shadingTimeline) return vm.runtime.shadingTimeline;
    const timeline = new ShadingTimeline(vm.runtime, options);
    vm.runtime.shadingTimeline = timeline;
    timeline.sound = installTimelineSound(vm.runtime, timeline);

    if (typeof vm.toJSON === 'function') {
        const originalToJSON = vm.toJSON.bind(vm);
        vm.toJSON = (targetId, serializationOptions) => {
            const projectJSON = JSON.parse(originalToJSON(targetId, serializationOptions));
            // A sprite export is not a project file and must not contain
            // project-level Shading settings.
            if (typeof targetId !== 'undefined' && targetId !== null) {
                return JSON.stringify(projectJSON);
            }
            return JSON.stringify(markShadeProject(projectJSON, timeline.toJSON()));
        };
    }

    if (typeof vm.deserializeProject === 'function') {
        const originalDeserializeProject = vm.deserializeProject.bind(vm);
        vm.deserializeProject = async (projectJSON, zip) => {
            const result = await originalDeserializeProject(projectJSON, zip);
            timeline.restore(getShadeTimelineSettings(projectJSON));
            return result;
        };
    }
    return timeline;
};

export {
    DEFAULT_DURATION,
    DEFAULT_RENDER_FRAMERATE,
    DEFAULT_RENDER_HEIGHT,
    DEFAULT_RENDER_WIDTH,
    MAX_DURATION,
    MAX_RENDER_FRAMERATE,
    MAX_RENDER_SIZE,
    MIN_DURATION,
    MIN_RENDER_FRAMERATE,
    MIN_RENDER_SIZE,
    installEventHats,
    ShadingTimeline,
    installShadingTimeline,
    ShadingTimeline as default
};
