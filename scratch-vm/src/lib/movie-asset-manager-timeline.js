import {
    TIMELINE_DEFAULT_DURATION,
    TIMELINE_MAX_DURATION
} from './movie-asset-manager-constants';
import {
    clamp,
    normalizeTimelineKeyframes,
    toNumber
} from './movie-asset-manager-utils';
import {captureVariables, syncSimulations} from './simulation-blocks';

// The timeline playhead is driven by the underlying clock. Project scripts read the offset clock instead.
const getTimelineClockTime = clock => {
    if (clock && typeof clock.projectTimerWithoutOffset === 'function') {
        return clock.projectTimerWithoutOffset();
    }
    return clock && typeof clock.projectTimer === 'function' ? clock.projectTimer() : 0;
};

// Frame times are snapped with this tolerance so a time computed as k / fps never lands just below frame k.
const FRAME_EPSILON = 1e-9;

// How long one VM tick may spend computing simulation steps before the frame waits for the next tick.
const SIMULATION_BUDGET_MS = {preview: 8, export: 50};
// A frame that read simulation times that were not computed is discarded and evaluated again once they are. Each
// evaluation can only add times to the computed ones, so this is a safety net, not the normal end of the loop.
const MAX_SIMULATION_REDOS = 16;

const MovieAssetManagerTimelineMethods = {
    // The one definition of frame time. Preview playback, export, seeking and single-frame PNG export all go
    // through these, so frame N always evaluates at exactly N / fps however it is reached.
    getFrameTime (frameIndex) {
        return toNumber(frameIndex) / this.timeline.framerate;
    },

    // The frame showing at `seconds`: frame k covers [k / fps, (k + 1) / fps).
    getFrameIndexAtTime (seconds) {
        return Math.max(0, Math.floor((toNumber(seconds) * this.timeline.framerate) + FRAME_EPSILON));
    },

    // The first frame at or after `seconds` (the first frame of an export range).
    getFirstFrameIndexFrom (seconds) {
        return Math.max(0, Math.ceil((toNumber(seconds) * this.timeline.framerate) - FRAME_EPSILON));
    },

    // Snap a time to the start of the frame showing at it, within the timeline.
    snapTimelineTime (seconds) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        return Math.min(this.timeline.duration, this.getFrameTime(this.getFrameIndexAtTime(time)));
    },

    serializeTimeline () {
        return {
            duration: this.timeline.duration,
            exportFormat: this.timeline.exportFormat,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            keyframes: this.getTimelineKeyframes(),
            rangeEnd: this.timeline.rangeEnd,
            rangeStart: this.timeline.rangeStart,
            reuseFrames: this.timeline.reuseFrames,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    },

    getTimelineSettings () {
        const rangeStart = clamp(toNumber(this.timeline.rangeStart), 0, this.timeline.duration);
        return {
            duration: this.timeline.duration,
            exportFormat: this.normalizeRenderingFormat(this.timeline.exportFormat),
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            rangeEnd: clamp(
                toNumber(this.timeline.rangeEnd, this.timeline.duration),
                rangeStart,
                this.timeline.duration
            ),
            rangeStart,
            reuseFrames: this.timeline.reuseFrames !== false,
            width: this.timeline.width
        };
    },

    restoreTimeline (descriptor) {
        const [stageWidth, stageHeight] = this.getStageSize();
        const hasSettings = descriptor && typeof descriptor === 'object';
        const settings = hasSettings ? descriptor : {};
        const currentFramerate = this.runtime.frameLoop && this.runtime.frameLoop.framerate;
        this.timeline.currentTime = 0;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.exportFormat = this.normalizeRenderingFormat(settings.exportFormat);
        this.timeline.framerate = this.normalizeRenderingFramerate(
            hasSettings ? settings.framerate : currentFramerate
        );
        this.timeline.height = Math.max(1, Math.round(toNumber(settings.height, stageHeight)));
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.offlineRenderScheduled = false;
        this.timeline.offlineRenderTimer = null;
        this.timeline.offlineRendering = false;
        this.timeline.keyframes = normalizeTimelineKeyframes(settings.keyframes, this.timeline.duration);
        this.timeline.pendingFrame = true;
        this.timeline.playing = false;
        // The preview runs `initialize` once before the first frame it evaluates after a project is opened.
        this.timeline.previewInitialized = false;
        this.timeline.previewFrameIndex = null;
        this.timeline.startClockAfterInitialize = false;
        this.timeline.recording = false;
        this.timeline.rangeStart = clamp(toNumber(settings.rangeStart), 0, this.timeline.duration);
        this.timeline.rangeEnd = clamp(
            toNumber(settings.rangeEnd, this.timeline.duration),
            this.timeline.rangeStart,
            this.timeline.duration
        );
        this.timeline.renderFrameThreads = [];
        this.timeline.sound = String(settings.sound || '');
        this.timeline.reuseFrames = settings.reuseFrames !== false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.width = Math.max(1, Math.round(toNumber(settings.width, stageWidth)));
        this.setTimelineClock(0, true);
        if (hasSettings) {
            this.vm.setFramerate(this.timeline.framerate);
        }
        this.emitTimelineChanged();
    },

    normalizeTimelineDuration (value) {
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0) return TIMELINE_DEFAULT_DURATION;
        return Math.min(TIMELINE_MAX_DURATION, Math.max(0.1, duration));
    },

    getTimelineState () {
        const rangeStart = clamp(toNumber(this.timeline.rangeStart), 0, this.timeline.duration);
        return {
            currentTime: this.timeline.currentTime,
            duration: this.timeline.duration,
            exportFormat: this.normalizeRenderingFormat(this.timeline.exportFormat),
            frameCount: Array.isArray(this.renderingFrames) ? this.renderingFrames.length : 0,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            keyframes: this.getTimelineKeyframes(),
            playing: this.timeline.playing,
            rangeEnd: clamp(
                toNumber(this.timeline.rangeEnd, this.timeline.duration),
                rangeStart,
                this.timeline.duration
            ),
            rangeStart,
            recording: this.timeline.recording,
            reuseFrames: this.timeline.reuseFrames !== false,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    },

    emitTimelineChanged () {
        this.emit('timelineChanged', this.getTimelineState());
    },

    getTimelineKeyframes () {
        return normalizeTimelineKeyframes(this.timeline.keyframes, this.timeline.duration);
    },

    getKeyframeTime (id) {
        const keyframes = this.getTimelineKeyframes();
        if (!keyframes.length) return 0;
        const position = clamp(toNumber(id, 1), 1, keyframes.length) - 1;
        const leftIndex = Math.floor(position);
        const rightIndex = Math.ceil(position);
        if (leftIndex === rightIndex) return keyframes[leftIndex];
        const progress = position - leftIndex;
        return keyframes[leftIndex] + ((keyframes[rightIndex] - keyframes[leftIndex]) * progress);
    },

    getLeftKeyframeTime (firstId, secondId) {
        return Math.min(this.getKeyframeTime(firstId), this.getKeyframeTime(secondId));
    },

    addTimelineKeyframe (seconds = this.timeline.currentTime) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        const keyframes = normalizeTimelineKeyframes(
            this.getTimelineKeyframes().concat([time]),
            this.timeline.duration
        );
        if (keyframes.length === this.getTimelineKeyframes().length) return;
        this.timeline.keyframes = keyframes;
        this.emitTimelineChanged();
        this.runtime.emitProjectChanged();
    },

    removeTimelineKeyframe (id) {
        const keyframes = this.getTimelineKeyframes();
        const index = Math.round(toNumber(id)) - 1;
        if (index < 0 || index >= keyframes.length) return;
        keyframes.splice(index, 1);
        this.timeline.keyframes = keyframes;
        this.emitTimelineChanged();
        this.runtime.emitProjectChanged();
    },

    setTimelineClock (seconds, paused) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        const clock = this.runtime.ioDevices.clock;
        this.runtime.updateCurrentMSecs();
        clock._projectTimer.startTime = this.runtime.currentMSecs - (time * 1000);
        clock._pausedTime = time * 1000;
        clock._paused = Boolean(paused);
        this.timeline.clockHeld = false;
        this.timeline.currentTime = time;
    },

    // While playback evaluates a frame, scripts that read the project timer (easing, the timer reporter) see the
    // frame's time, as they do during export. The underlying clock keeps running and is released after the tick.
    holdTimelineClock (seconds) {
        const clock = this.runtime.ioDevices.clock;
        if (!clock || clock._paused) return;
        clock._pausedTime = toNumber(seconds) * 1000;
        clock._paused = true;
        this.timeline.clockHeld = true;
    },

    releaseTimelineClock () {
        if (!this.timeline.clockHeld) return;
        this.timeline.clockHeld = false;
        const clock = this.runtime.ioDevices.clock;
        if (clock) clock._paused = false;
    },

    playTimeline () {
        this.cancelFrameTransaction();
        this.cancelPendingObjectDraws();
        if (this.timeline.currentTime >= this.timeline.duration) this.timeline.currentTime = 0;
        this.timeline.currentTime = this.snapTimelineTime(this.timeline.currentTime);
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.timeline.pendingFrame = true;
        this.timeline.playing = true;
        this.timeline.previewFrameIndex = null;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        // Playback starts from `initialize`, wherever the playhead is. The clock and timeline sounds wait for it.
        this.setTimelineClock(this.timeline.currentTime, true);
        this.timeline.startClockAfterInitialize = true;
        this.startTimelineInitialize();
        if (!this.timeline.initializing) this.startTimelinePlaybackClock();
        this.emitTimelineChanged();
    },

    startTimelinePlaybackClock () {
        this.timeline.startClockAfterInitialize = false;
        if (!this.timeline.playing) return;
        this.setTimelineClock(this.timeline.currentTime, false);
        this.playTimelineSounds(this.timeline.currentTime);
    },

    // Start the `initialize` hats. Their threads (and initializePromises) hold the next frame until they finish.
    startTimelineInitialize () {
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = true;
        const initializeThreads = this.runtime.startHats('event_initialize');
        this.timeline.initializeThreads = Array.isArray(initializeThreads) ? initializeThreads : [];
        if (!this.timeline.initializeThreads.length && !this.timeline.initializePromises.size) {
            this.finishTimelineInitialize();
        }
    },

    finishTimelineInitialize () {
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        // Simulations read ordinary variables as they are once `initialize` has run.
        this.simulationVariables = captureVariables(this.runtime);
        this.syncSimulationDefinitions();
        if (!this.timeline.recording) this.timeline.previewInitialized = true;
        if (this.timeline.startClockAfterInitialize) this.startTimelinePlaybackClock();
    },

    pauseTimeline () {
        this.cancelFrameTransaction();
        this.cancelPendingObjectDraws();
        this.cancelSimulationWork();
        const clock = this.runtime.ioDevices.clock;
        if (this.timeline.playing && !this.timeline.startClockAfterInitialize) {
            this.timeline.currentTime = this.snapTimelineTime(getTimelineClockTime(clock));
            // The clock may have reached a frame that playback had not evaluated yet; show that frame.
            if (this.getFrameIndexAtTime(this.timeline.currentTime) !== this.timeline.previewFrameIndex) {
                this.timeline.pendingFrame = true;
            }
        }
        this.timeline.playing = false;
        this.timeline.startClockAfterInitialize = false;
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.setTimelineClock(this.timeline.currentTime, true);
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
    },

    stopTimeline () {
        this.cancelFrameTransaction();
        this.cancelPendingObjectDraws();
        this.cancelSimulationWork();
        const cancelledRendering = this.timeline.recording;
        this.playedTimelineSoundBlocks.clear();
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.timeline.startClockAfterInitialize = false;
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.setTimelineClock(0, true);
        this.timeline.pendingFrame = true;
        this.emitTimelineChanged();
        if (cancelledRendering) this.emit('timelineRenderCancelled');
    },

    seekTimeline (seconds) {
        this.cancelFrameTransaction();
        this.cancelPendingObjectDraws();
        this.cancelSimulationWork();
        const wasPlaying = this.timeline.playing;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        // A seek does not run `initialize`. One cancelled here (playback start) is started again by playback.
        const restartInitialize = wasPlaying && this.timeline.startClockAfterInitialize;
        this.timeline.startClockAfterInitialize = false;
        this.setTimelineClock(this.snapTimelineTime(seconds), !wasPlaying);
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.pendingFrame = true;
        this.timeline.previewFrameIndex = null;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        if (restartInitialize) {
            this.setTimelineClock(this.timeline.currentTime, true);
            this.timeline.startClockAfterInitialize = true;
            this.startTimelineInitialize();
        } else if (wasPlaying) {
            this.playTimelineSounds(this.timeline.currentTime);
        }
        this.emitTimelineChanged();
    },

    requestTimelinePreviewRefresh () {
        clearTimeout(this.timelinePreviewRefreshTimeout);
        this.timelinePreviewRefreshTimeout = setTimeout(() => {
            this.timelinePreviewRefreshTimeout = null;
            if (this.timeline.playing || this.timeline.recording) return;
            this.seekTimeline(this.timeline.currentTime);
        }, 0);
    },

    handleProjectChanged () {
        // Render-frame scripts can update serializable Movie state themselves. Refreshing in response to those
        // updates would continuously restart a paused preview, so only edits made outside the frame transaction
        // should schedule another evaluation at the current timeline time.
        if (this.timeline.renderedThisStep) return;
        // Only simulations whose definition changed are computed again; editing a render-frame script keeps them.
        this.syncSimulationDefinitions();
        this.renderCacheGeneration = (Number(this.renderCacheGeneration) || 0) + 1;
        if (this.renderingFrameCache instanceof Map) this.renderingFrameCache.clear();
        if (this.renderingSoundEventCache instanceof Map) this.renderingSoundEventCache.clear();
        this.requestTimelinePreviewRefresh();
    },

    updateTimelineSettings (settings, options = {}) {
        const previousSettings = this.getTimelineSettings();
        const previousDuration = this.timeline.duration;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.keyframes = normalizeTimelineKeyframes(this.timeline.keyframes, this.timeline.duration);
        if (Object.prototype.hasOwnProperty.call(settings, 'exportFormat')) {
            this.timeline.exportFormat = this.normalizeRenderingFormat(settings.exportFormat);
        }
        this.timeline.framerate = this.normalizeRenderingFramerate(settings.framerate);
        this.timeline.height = Math.max(1, Math.min(4096, Math.round(toNumber(settings.height, this.timeline.height))));
        if (Object.prototype.hasOwnProperty.call(settings, 'sound')) {
            this.timeline.sound = String(settings.sound || '');
        }
        if (Object.prototype.hasOwnProperty.call(settings, 'reuseFrames')) {
            this.timeline.reuseFrames = settings.reuseFrames !== false;
        }
        const currentRangeStart = toNumber(this.timeline.rangeStart);
        const currentRangeEnd = toNumber(this.timeline.rangeEnd, this.timeline.duration);
        this.timeline.rangeStart = clamp(
            toNumber(settings.rangeStart, currentRangeStart),
            0,
            this.timeline.duration
        );
        this.timeline.rangeEnd = clamp(
            toNumber(settings.rangeEnd, Math.max(this.timeline.rangeStart, currentRangeEnd)),
            this.timeline.rangeStart,
            this.timeline.duration
        );
        this.timeline.width = Math.max(1, Math.min(4096, Math.round(toNumber(settings.width, this.timeline.width))));
        this.vm.setFramerate(this.timeline.framerate);
        if (this.timeline.currentTime > this.timeline.duration || previousDuration !== this.timeline.duration) {
            this.seekTimeline(Math.min(this.timeline.currentTime, this.timeline.duration));
        } else {
            this.timeline.pendingFrame = true;
            this.emitTimelineChanged();
        }
        const nextSettings = this.getTimelineSettings();
        const settingsChanged = JSON.stringify(previousSettings) !== JSON.stringify(nextSettings);
        if (settingsChanged) {
            this.emit('timelineSettingsChanged', nextSettings, {
                previousSettings,
                remote: options.remote === true
            });
        }
        if (settingsChanged) this.runtime.emitProjectChanged();
    },

    getRenderingFrameCacheKey (frameIndex) {
        return [
            this.renderCacheGeneration,
            this.timeline.width,
            this.timeline.height,
            this.timeline.framerate,
            this.getSimulationCacheKey(),
            frameIndex
        ].join(':');
    },

    // ---- simulations ------------------------------------------------------------------------------------------

    getSimulationRuntime () {
        return this.runtime && this.runtime.simulationRuntime ? this.runtime.simulationRuntime : null;
    },

    // {simulation name: [{start, end}]} seconds that are computed (see SimulationCache.getRanges).
    getSimulationCacheRanges () {
        const simulationRuntime = this.getSimulationRuntime();
        return simulationRuntime ? simulationRuntime.getCachedRanges() : {};
    },

    // The hashes of every simulation: a cached frame is only reused while they are unchanged.
    getSimulationCacheKey () {
        const simulationRuntime = this.getSimulationRuntime();
        if (!simulationRuntime || typeof simulationRuntime.names !== 'function') return '';
        return simulationRuntime.names().sort()
            .map(name => `${name}=${simulationRuntime.simulations.get(name).definition.hash}`)
            .join(',');
    },

    syncSimulationDefinitions () {
        const simulationRuntime = this.getSimulationRuntime();
        if (!simulationRuntime || !this.vm) return;
        if (!this.simulationVariables) this.simulationVariables = captureVariables(this.runtime);
        try {
            syncSimulations(this.vm, this.simulationVariables);
        } catch (error) {
            this.reportSimulationError({name: '', error});
        }
    },

    cancelSimulationWork () {
        const simulationRuntime = this.getSimulationRuntime();
        if (simulationRuntime) simulationRuntime.cancel();
        if (this.timeline) {
            this.timeline.waitingForSimulation = false;
            this.timeline.simulationRequests = [];
            this.timeline.simulationRedos = 0;
        }
    },

    reportSimulationError ({name, error}) {
        if (!(this.simulationErrorKeys instanceof Set)) this.simulationErrorKeys = new Set();
        const message = error && error.message ? error.message : String(error);
        const key = `${name}\u0000${message}`;
        if (this.simulationErrorKeys.has(key)) return;
        this.simulationErrorKeys.add(key);
        const diagnostic = Object.freeze({code: 'simulation-error', message, simulation: name});
        // eslint-disable-next-line no-console
        console.warn(`[Movie] Simulation ${name}: ${message}`);
        this.emit('simulationError', diagnostic);
    },

    /**
     * Compute every simulation up to the frame's time (and the times the previous evaluation of this frame read),
     * within this tick's budget. Returns false while the frame has to wait for more steps.
     * @param {number} time The frame's time.
     * @returns {boolean} Whether the frame can be evaluated.
     */
    ensureSimulationsForFrame (time) {
        const simulationRuntime = this.getSimulationRuntime();
        if (!simulationRuntime || !simulationRuntime.simulations.size) return true;
        if (!this.simulationVariables) this.syncSimulationDefinitions();
        const requests = simulationRuntime.names().map(name => ({name, time}))
            .concat(this.timeline.simulationRequests || []);
        const budget = this.timeline.recording ? SIMULATION_BUDGET_MS.export : SIMULATION_BUDGET_MS.preview;
        const result = simulationRuntime.ensureTimes(requests, budget);
        for (const error of result.errors) this.reportSimulationError(error);
        // A simulation that failed is not waited for: its reads return its initial state.
        if (result.ready || result.errors.length) {
            this.timeline.waitingForSimulation = false;
            return true;
        }
        this.timeline.waitingForSimulation = true;
        return false;
    },

    // After a frame's scripts and drawing finished: discard the frame if it read simulation times that were not
    // computed. The staging frame is not committed, so nothing of it reaches the screen or the export.
    redoFrameForSimulation () {
        const simulationRuntime = this.getSimulationRuntime();
        if (!simulationRuntime || !simulationRuntime.hasRequestedTimes()) return false;
        const requests = simulationRuntime.takeRequestedTimes();
        if ((Number(this.timeline.simulationRedos) || 0) >= MAX_SIMULATION_REDOS) {
            this.reportSimulationError({
                name: requests[0].name,
                error: new Error('A frame kept reading simulation times that were not computed.')
            });
            return false;
        }
        this.timeline.simulationRedos = (Number(this.timeline.simulationRedos) || 0) + 1;
        this.timeline.simulationRequests = (this.timeline.simulationRequests || []).concat(requests);
        this.cancelFrameTransaction();
        this.discardFrameSoundEvents();
        this.timeline.pendingFrame = true;
        this.timeline.waitingForSimulation = true;
        if (this.timeline.playing) this.timeline.previewFrameIndex = null;
        return true;
    },

    // Forget the sound events recorded while evaluating the current export frame.
    discardFrameSoundEvents () {
        if (!this.timeline.recording || !Array.isArray(this.renderingSoundEvents)) return;
        const frame = this.timeline.renderFrameIndex;
        this.renderingSoundEvents = this.renderingSoundEvents.filter(event => {
            if (Number(event.frame) !== frame) return true;
            if (event.dedupeKey && this.playedTimelineSoundBlocks instanceof Set) {
                this.playedTimelineSoundBlocks.delete(event.dedupeKey);
            }
            return false;
        });
    },

    getRenderEndTime () {
        return Number.isFinite(Number(this.timeline.renderEndTime)) ?
            Number(this.timeline.renderEndTime) : this.timeline.duration;
    },

    prepareOfflineRendering () {
        this.timeline.offlineRendering = true;
        this.timeline.offlineRenderToken = (Number(this.timeline.offlineRenderToken) || 0) + 1;
        const frameLoop = this.runtime.frameLoop;
        this.timeline.offlineFrameLoopWasRunning = Boolean(frameLoop && frameLoop.running);
        if (this.timeline.offlineFrameLoopWasRunning && typeof frameLoop.stop === 'function') frameLoop.stop();
        this.timeline.offlinePreviousTurboMode = this.runtime.turboMode;
        this.runtime.turboMode = true;
    },

    restoreOfflineRendering () {
        if (!this.timeline.offlineRendering && !this.timeline.offlineFrameLoopWasRunning) return;
        if (this.timeline.offlineRenderTimer !== null && typeof this.timeline.offlineRenderTimer !== 'undefined') {
            clearTimeout(this.timeline.offlineRenderTimer);
        }
        this.timeline.offlineRenderTimer = null;
        this.timeline.offlineRenderScheduled = false;
        this.timeline.offlineRendering = false;
        this.runtime.turboMode = this.timeline.offlinePreviousTurboMode;
        const frameLoop = this.runtime.frameLoop;
        if (this.timeline.offlineFrameLoopWasRunning && frameLoop && !frameLoop.running &&
            typeof frameLoop.start === 'function') frameLoop.start();
        this.timeline.offlineFrameLoopWasRunning = false;
        this.timeline.offlinePreviousTurboMode = null;
    },

    getOfflineRenderPromises () {
        const promises = [];
        const add = promise => {
            if (promise && typeof promise.then === 'function' && promises.indexOf(promise) === -1) {
                promises.push(promise);
            }
        };
        const addSet = set => {
            if (!(set instanceof Set)) return;
            set.forEach(add);
        };
        add(this.renderingFrameWrite);
        addSet(this.timeline.initializePromises);
        addSet(this.blockingVideoRenders);
        add(this.frameGraphRenderPromise);
        if (this.targetStates instanceof Map) {
            for (const state of this.targetStates.values()) {
                add(state.objectDrawPromise);
                add(state.modelRenderPromise);
                add(state.textRenderPromise);
                add(state.videoRenderPromise);
            }
        }
        return promises;
    },

    scheduleOfflineRenderStep () {
        if (!this.timeline.offlineRendering || !this.timeline.recording ||
            typeof this.runtime._step !== 'function' || this.timeline.offlineRenderScheduled) return;
        this.timeline.offlineRenderScheduled = true;
        const token = this.timeline.offlineRenderToken;
        const run = () => {
            this.timeline.offlineRenderTimer = null;
            this.timeline.offlineRenderScheduled = false;
            if (!this.timeline.offlineRendering || !this.timeline.recording ||
                token !== this.timeline.offlineRenderToken) return;
            this.runOfflineRenderStep();
        };
        this.timeline.offlineRenderTimer = setTimeout(run, 0);
    },

    runOfflineRenderStep () {
        if (!this.timeline.offlineRendering || !this.timeline.recording) return;
        try {
            // Runtime._step still owns all normal Scratch sequencing and the Movie BEFORE/AFTER hooks. The
            // difference is that the frame loop is stopped and this driver advances it only after the current
            // deterministic frame has finished, so the wall clock can never select or stretch a movie frame.
            this.runtime._step();
        } catch (error) {
            this.failOfflineRendering(error);
            return;
        }
        if (!this.timeline.offlineRendering || !this.timeline.recording) return;
        const promises = this.getOfflineRenderPromises();
        if (promises.length) {
            Promise.all(promises).then(
                () => this.scheduleOfflineRenderStep(),
                error => this.failOfflineRendering(error)
            );
        } else {
            this.scheduleOfflineRenderStep();
        }
    },

    completeOfflineRendering (storageReady = false) {
        if (!this.timeline.offlineRendering) return;
        if (this.renderingFrameWrite && !storageReady) {
            const token = this.timeline.offlineRenderToken;
            this.renderingFrameWrite.then(() => {
                if (this.timeline.offlineRendering && token === this.timeline.offlineRenderToken) {
                    this.completeOfflineRendering(true);
                }
            }, error => {
                if (this.timeline.offlineRendering && token === this.timeline.offlineRenderToken) {
                    this.failOfflineRendering(error);
                }
            });
            return;
        }
        this.timeline.recording = false;
        this.timeline.playing = false;
        this.timeline.pendingFrame = false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.renderFrameThreads = [];
        this.setTimelineClock(this.getRenderEndTime(), true);
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
        this.emit('timelineRenderComplete', this.getTimelineState());
    },

    failOfflineRendering (error) {
        if (!this.timeline.offlineRendering) return;
        this.timeline.recording = false;
        this.timeline.playing = false;
        this.timeline.pendingFrame = false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.renderFrameThreads = [];
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.setTimelineClock(this.timeline.currentTime, true);
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
        this.emit('renderError', error);
    },

    renderTimeline (options = {}) {
        this.cancelFrameTransaction();
        this.cancelPendingObjectDraws();
        this.cancelSimulationWork();
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        const reuseFrames = options.reuseFrames === true;
        this.clearRenderingFrames({preserveCache: reuseFrames});
        this.resizeRendererForTimeline();
        const rangeStart = clamp(
            toNumber(options.start, this.timeline.rangeStart),
            0,
            this.timeline.duration
        );
        const rangeEnd = clamp(
            toNumber(options.end, this.timeline.rangeEnd || this.timeline.duration),
            rangeStart,
            this.timeline.duration
        );
        this.timeline.currentTime = rangeStart;
        this.timeline.pendingFrame = true;
        this.timeline.playing = false;
        this.timeline.recording = true;
        this.timeline.renderEndTime = rangeEnd;
        // A single-frame export (the current frame PNG) renders the frame showing at that time.
        this.timeline.renderFrameIndex = rangeEnd === rangeStart ?
            this.getFrameIndexAtTime(rangeStart) : this.getFirstFrameIndexFrom(rangeStart);
        this.timeline.startClockAfterInitialize = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.renderedThisStep = false;
        this.timeline.reuseFramesDuringRender = reuseFrames;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.prepareOfflineRendering();
        this.setTimelineClock(this.getFrameTime(this.timeline.renderFrameIndex), true);
        this.startTimelineInitialize();
        this.emitTimelineChanged();
        this.scheduleOfflineRenderStep();
    },

    getRendererPixelRatio () {
        return typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0 ?
            Number(window.devicePixelRatio) : 1;
    },

    resizeRendererForTimeline () {
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas || typeof renderer.resize !== 'function') return;
        if (!this.previewRendererSize) {
            this.previewRendererSize = {
                height: renderer.canvas.height,
                width: renderer.canvas.width
            };
        }
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(this.timeline.width / pixelRatio, this.timeline.height / pixelRatio);
    },

    restorePreviewRendererSize () {
        const renderer = this.runtime.renderer;
        const size = this.previewRendererSize;
        this.previewRendererSize = null;
        if (!size || !renderer || typeof renderer.resize !== 'function') return;
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(size.width / pixelRatio, size.height / pixelRatio);
    },

    handleTimelineBeforeExecute () {
        this.beginFrameGraph();
        if (!this.timeline.recording && !this.timeline.initializing && !this.timeline.previewInitialized &&
            (this.timeline.playing || this.timeline.pendingFrame)) {
            // The first preview evaluation after a project is opened runs `initialize` first.
            this.startTimelineInitialize();
        }
        if (this.timeline.initializing) {
            const hasInitializePromises = this.timeline.initializePromises instanceof Set &&
                this.timeline.initializePromises.size > 0;
            if (this.hasActiveInitializeThreads() || hasInitializePromises ||
                this.hasBlockingVideoRenders() || this.hasPendingVisualRenders()) return;
            this.finishTimelineInitialize();
        }
        if (this.timeline.waitingForFrame || this.timeline.waitingForVideo) {
            if (this.hasBlockingVideoRenders() || this.hasPendingVisualRenders()) return;
            // Continue the frame's existing threads after every slow visual operation has completed. Do not
            // restart the hat or advance the deterministic clock while the current frame is still being drawn.
            this.timeline.waitingForFrame = false;
            this.timeline.waitingForVideo = false;
            this.timeline.renderedThisStep = true;
            if (this.timeline.playing) this.holdTimelineClock(this.timeline.currentTime);
            return;
        }
        if (!this.timeline.playing && !this.timeline.pendingFrame && !this.timeline.recording) return;
        if (this.timeline.recording) {
            this.setTimelineClock(
                Math.min(this.getFrameTime(this.timeline.renderFrameIndex), this.getRenderEndTime()),
                true
            );
        } else if (this.timeline.playing) {
            // Playback evaluates whole frames: the clock selects frame floor(t * fps) and the frame is evaluated at
            // exactly that frame's time. A frame is evaluated once; when the preview falls behind, frames are skipped.
            const clockTime = getTimelineClockTime(this.runtime.ioDevices.clock);
            const frameIndex = this.getFrameIndexAtTime(clamp(clockTime, 0, this.timeline.duration));
            if (!this.timeline.pendingFrame && frameIndex === this.timeline.previewFrameIndex) {
                // The clock passed the end of a duration that is not a whole number of frames.
                if (clockTime >= this.timeline.duration) this.pauseTimeline();
                return;
            }
            this.timeline.previewFrameIndex = frameIndex;
            this.timeline.currentTime = Math.min(this.timeline.duration, this.getFrameTime(frameIndex));
            if (clockTime >= this.timeline.duration) this.setTimelineClock(this.timeline.duration, false);
            this.holdTimelineClock(this.timeline.currentTime);
        } else {
            this.timeline.currentTime = this.snapTimelineTime(this.timeline.currentTime);
            this.timeline.previewFrameIndex = this.getFrameIndexAtTime(this.timeline.currentTime);
        }
        this.timeline.pendingFrame = false;
        this.timeline.renderedThisStep = true;
        if (this.timeline.recording && this.timeline.reuseFramesDuringRender &&
            this.renderingFrameCache instanceof Map) {
            const cachedFrame = this.renderingFrameCache.get(
                this.getRenderingFrameCacheKey(this.timeline.renderFrameIndex)
            );
            if (cachedFrame) {
                if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
                if (!Array.isArray(this.renderingFrameNumbers)) this.renderingFrameNumbers = [];
                this.renderingFrames.push(cachedFrame);
                this.renderingFrameNumbers.push(this.timeline.renderFrameIndex);
                if (this.renderingSoundEventCache instanceof Map) {
                    const cachedEvents = this.renderingSoundEventCache.get(
                        this.getRenderingFrameCacheKey(this.timeline.renderFrameIndex)
                    ) || [];
                    for (const event of cachedEvents) {
                        this.renderingSoundEvents.push({...event});
                        if (event.dedupeKey) this.playedTimelineSoundBlocks.add(event.dedupeKey);
                    }
                }
                this.timeline.reusedFrameThisStep = true;
                this.emit('renderingFramesChanged', this.renderingFrames.length);
                return;
            }
        }
        if (!this.ensureSimulationsForFrame(this.timeline.currentTime)) {
            // Not every simulation reached this frame's time within the tick's budget. Nothing of the frame has
            // started: evaluate it again next tick (playback picks the frame the clock has reached by then).
            this.timeline.renderedThisStep = false;
            this.timeline.pendingFrame = true;
            if (this.timeline.playing) this.timeline.previewFrameIndex = null;
            return;
        }
        this.beginObjectVideoAudioFrame();
        this.beginTimelineSoundFrame();
        this.resetDrawingForRenderFrame();
        // Counts evaluations of render frames: per-frame state (such as seeded random call counts) resets with it.
        this.timeline.frameEvaluationId = (Number(this.timeline.frameEvaluationId) || 0) + 1;
        const simulationRuntime = this.getSimulationRuntime();
        if (simulationRuntime) simulationRuntime.takeRequestedTimes();
        const threads = this.runtime.startHats('event_renderframe');
        this.timeline.renderFrameThreads = Array.isArray(threads) ? threads : [];
    },

    handleTimelineAfterExecute () {
        this.releaseTimelineClock();
        this.flushFrameGraph();
        if (!this.timeline.renderedThisStep) return;
        this.timeline.renderedThisStep = false;
        const waitingForVideo = this.hasBlockingVideoRenders();
        if (waitingForVideo || this.hasPendingVisualRenders() || this.hasActiveRenderFrameThreads()) {
            this.timeline.waitingForFrame = true;
            this.timeline.waitingForVideo = waitingForVideo;
            return;
        }
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        if (!this.timeline.reusedFrameThisStep && this.redoFrameForSimulation()) return;
        this.timeline.simulationRequests = [];
        this.timeline.simulationRedos = 0;
        if (!this.timeline.reusedFrameThisStep) {
            this.finishObjectVideoAudioFrame();
            this.finishTimelineSoundFrame();
            this.commitFrameTransaction();
        }
        if (this.timeline.recording) {
            if (!this.timeline.reusedFrameThisStep) {
                try {
                    this.addRenderingFrame();
                } catch (error) {
                    if (!Array.isArray(this.renderingFrameErrors)) this.renderingFrameErrors = [];
                    this.renderingFrameErrors.push({
                        frame: this.timeline.renderFrameIndex,
                        message: error && error.message ? error.message : String(error),
                        time: this.timeline.currentTime
                    });
                    this.timeline.recording = false;
                    this.timeline.playing = false;
                    this.restorePreviewRendererSize();
                    this.setTimelineClock(this.timeline.currentTime, true);
                    this.runtime.stopAll();
                    if (this.timeline.offlineRendering) {
                        this.restoreOfflineRendering();
                    }
                    this.emit('renderError', error);
                }
            }
            this.timeline.reusedFrameThisStep = false;
            if (this.timeline.recording && this.timeline.currentTime < this.getRenderEndTime()) {
                this.timeline.renderFrameIndex++;
                this.timeline.pendingFrame = true;
            }
        }
        this.emitTimelineChanged();
        if (this.timeline.recording && this.timeline.currentTime >= this.getRenderEndTime()) {
            if (this.timeline.offlineRendering) {
                this.completeOfflineRendering();
                return;
            }
            const completedRendering = this.timeline.recording;
            this.timeline.recording = false;
            if (completedRendering) this.emit('timelineRenderComplete', this.getTimelineState());
        } else if (this.timeline.playing && this.timeline.currentTime >= this.timeline.duration) {
            // Preview playback follows the project duration, independent of the last export range.
            this.pauseTimeline();
        }
    }
};

export default MovieAssetManagerTimelineMethods;
