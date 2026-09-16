import {
    DEFAULT_RENDER_FRAMERATE,
    DEFAULT_RENDER_HEIGHT,
    DEFAULT_RENDER_WIDTH,
    MAX_RENDER_FRAMERATE,
    MAX_RENDER_SIZE,
    MIN_RENDER_FRAMERATE,
    MIN_RENDER_SIZE
} from './runtime/timeline';

const OUTPUT_EXTENSION = 'mp4';
const OUTPUT_MIME_TYPE = 'video/mp4';
const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

const clampInt = (value, minimum, maximum, fallback) => {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
};

const pickDefined = (first, second) => (typeof first === 'undefined' ? second : first);

const normalizeExportSettings = (settings = {}) => ({
    width: clampInt(
        pickDefined(settings.width, settings.renderWidth),
        MIN_RENDER_SIZE,
        MAX_RENDER_SIZE,
        DEFAULT_RENDER_WIDTH
    ),
    height: clampInt(
        pickDefined(settings.height, settings.renderHeight),
        MIN_RENDER_SIZE,
        MAX_RENDER_SIZE,
        DEFAULT_RENDER_HEIGHT
    ),
    framerate: clampInt(
        pickDefined(
            pickDefined(settings.framerate, settings.fps),
            settings.renderFramerate
        ),
        MIN_RENDER_FRAMERATE,
        MAX_RENDER_FRAMERATE,
        DEFAULT_RENDER_FRAMERATE
    )
});

const getTotalFrameCount = (duration, framerate) => {
    const safeDuration = Math.max(0.1, Number(duration) || 0.1);
    const safeFramerate = clampInt(
        framerate, MIN_RENDER_FRAMERATE, MAX_RENDER_FRAMERATE, DEFAULT_RENDER_FRAMERATE
    );
    return Math.max(1, Math.round(safeDuration * safeFramerate));
};

const createAbortError = () => {
    if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
};

const createCanvas = (width, height) => {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        throw new Error('A browser canvas is required for rendering');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

const getStageCanvas = vm => {
    const canvas = vm && vm.renderer && vm.renderer.canvas;
    if (!canvas) throw new Error('The Scratch stage is not ready for rendering');
    return canvas;
};

const hasTimelineSoundBlocks = vm => {
    const targets = vm && vm.runtime && Array.isArray(vm.runtime.targets) ? vm.runtime.targets : [];
    return targets.some(target => {
        const blocks = target && target.blocks && target.blocks._blocks;
        return blocks && Object.values(blocks).some(block => block && block.opcode === 'sound_playattime');
    });
};

const getAudioContext = vm => vm && vm.runtime && vm.runtime.audioEngine &&
    vm.runtime.audioEngine.audioContext;

const normalizeAudioSampleRate = value => {
    const sampleRate = Math.round(Number(value));
    return Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000 ?
        sampleRate : null;
};

const getTimelineAudioSampleRate = (vm, audioContext) => {
    const contextSampleRate = normalizeAudioSampleRate(audioContext && audioContext.sampleRate);
    if (contextSampleRate) return contextSampleRate;

    const targets = vm && vm.runtime && Array.isArray(vm.runtime.targets) ? vm.runtime.targets : [];
    for (const target of targets) {
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const sounds = target && target.sprite && Array.isArray(target.sprite.sounds) ? target.sprite.sounds : [];
        for (const sound of sounds) {
            const player = soundBank && typeof soundBank.getSoundPlayer === 'function' && sound.soundId ?
                soundBank.getSoundPlayer(sound.soundId) : null;
            const sampleRate = normalizeAudioSampleRate(player && player.buffer && player.buffer.sampleRate);
            if (sampleRate) return sampleRate;
        }
    }
    return DEFAULT_AUDIO_SAMPLE_RATE;
};

const createMixedAudioBuffer = (audioContext, events, duration, sampleRate) => {
    const frameCount = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
    const mixed = audioContext.createBuffer(2, frameCount, sampleRate);
    const left = mixed.getChannelData(0);
    const right = mixed.getChannelData(1);

    for (const event of events || []) {
        const buffer = event && event.buffer;
        if (!buffer || typeof buffer.getChannelData !== 'function') continue;
        const sourceRate = normalizeAudioSampleRate(buffer.sampleRate) || sampleRate;
        const sourceLeft = buffer.getChannelData(0);
        const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
        const playbackRate = Number(event.playbackRate);
        const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
        const sourceOffset = Math.max(0, Number(event.offset) || 0) * sourceRate;
        const startFrame = Math.max(0, Math.round((Number(event.startTime) || 0) * sampleRate));
        if (startFrame >= frameCount || sourceOffset >= sourceLeft.length) continue;

        const naturalDuration = Math.max(0, (sourceLeft.length - sourceOffset) /
            sourceRate / safePlaybackRate);
        const requestedDuration = Number(event.duration);
        const clipDuration = Number.isFinite(requestedDuration) ?
            Math.min(naturalDuration, Math.max(0, requestedDuration)) : naturalDuration;
        const outputFrames = Math.min(
            frameCount - startFrame,
            Math.max(0, Math.ceil(clipDuration * sampleRate))
        );
        const pan = Math.max(-1, Math.min(1, Number(event.pan) || 0));
        const volume = Math.max(0, Math.min(1, Number(event.volume) || 0));
        const leftGain = volume * (pan > 0 ? 1 - pan : 1);
        const rightGain = volume * (pan < 0 ? 1 + pan : 1);

        for (let outputIndex = 0; outputIndex < outputFrames; outputIndex++) {
            const sourcePosition = sourceOffset + ((outputIndex / sampleRate) * sourceRate * safePlaybackRate);
            const firstIndex = Math.floor(sourcePosition);
            if (firstIndex >= sourceLeft.length) break;
            const secondIndex = Math.min(sourceLeft.length - 1, firstIndex + 1);
            const interpolation = sourcePosition - firstIndex;
            const sourceLeftSample = sourceLeft[firstIndex] +
                ((sourceLeft[secondIndex] - sourceLeft[firstIndex]) * interpolation);
            const sourceRightSample = sourceRight[firstIndex] +
                ((sourceRight[secondIndex] - sourceRight[firstIndex]) * interpolation);
            const destinationIndex = startFrame + outputIndex;
            left[destinationIndex] += sourceLeftSample * leftGain;
            right[destinationIndex] += sourceRightSample * rightGain;
        }
    }

    // Keep the mix inside the range accepted by AudioBuffer encoders. This
    // also prevents several overlapping timeline clips from hard-clipping
    // the resulting MP4 audio.
    for (let index = 0; index < frameCount; index++) {
        left[index] = Math.max(-1, Math.min(1, left[index]));
        right[index] = Math.max(-1, Math.min(1, right[index]));
    }
    return mixed;
};

const getFrameRenderer = (vm, renderFrame) => {
    if (typeof renderFrame === 'function') return renderFrame;
    const runtimeRenderer = vm && vm.runtime && vm.runtime.renderFrameAtTime;
    return typeof runtimeRenderer === 'function' ? runtimeRenderer.bind(vm.runtime) : null;
};

/**
 * Render the visible Scratch stage to an MP4 file one timestamp at a time.
 *
 * The exporter deliberately does not create another VM or move project
 * objects. Each frame seeks the shared Sensing timer, asks the existing stage
 * renderer to draw, copies that canvas into a fixed-size capture surface, and
 * hands it to Mediabunny. Render-frame sound blocks are mixed into an audio
 * track at the same timestamps. A host with a time-aware custom renderer may
 * pass `renderFrame({vm, time, canvas, width, height})` in options.
 * @param {VirtualMachine} vm - The VM whose stage should be rendered.
 * @param {object} options - Export settings, progress callback, and abort signal.
 * @returns {Promise<object>} The encoded MP4 blob and its render metadata.
 */
const exportTimelineVideo = async (vm, options = {}) => {
    const {onProgress, signal} = options;
    const {width, height, framerate} = normalizeExportSettings(options);
    const throwIfAborted = () => {
        if (signal && signal.aborted) throw createAbortError();
    };
    throwIfAborted();

    const timeline = vm && vm.runtime && vm.runtime.shadingTimeline;
    if (!timeline) throw new Error('The timeline is not installed');
    if (typeof VideoEncoder === 'undefined') {
        throw new Error('This browser cannot encode video (WebCodecs is unavailable)');
    }

    const stageCanvas = getStageCanvas(vm);
    const stageRenderer = vm.renderer;
    const scene = vm.runtime.shadingScene;
    const customRenderFrame = getFrameRenderer(vm, options.renderFrame);
    const hasAudioBlocks = hasTimelineSoundBlocks(vm);
    const audioContext = getAudioContext(vm);
    const timelineSound = timeline.sound || (vm.runtime && vm.runtime.shadingTimelineSound);
    const captureCanvas = createCanvas(width, height);
    const captureContext = captureCanvas.getContext('2d');
    if (!captureContext) throw new Error('The browser cannot create a 2D capture canvas');

    const duration = Math.max(0.1, Number(timeline.duration) || 0.1);
    const totalFrames = getTotalFrameCount(duration, framerate);
    const savedTime = timeline.currentTime;
    const wasPlaying = timeline.isPlaying;

    timeline.pause();

    let output = null;
    let videoSource = null;
    let audioSource = null;
    let audioSampleRate = DEFAULT_AUDIO_SAMPLE_RATE;
    let outputFinalized = false;
    let videoSourceClosed = false;
    let audioRecordingStarted = false;
    try {
        if (scene) {
            scene.exporting = true;
            await scene.previewPromise;
        }
        // Use Mediabunny's compiled browser entry explicitly. Webpack 4 can
        // otherwise follow the package metadata into mediabunny/src/*.ts,
        // which it cannot parse as JavaScript.
        const mediabunny = await import('mediabunny/dist/modules/src/index.js');
        throwIfAborted();
        const {
            BufferTarget,
            CanvasSource,
            Mp4OutputFormat,
            Output,
            Quality,
            AudioBufferSource,
            getFirstEncodableAudioCodec,
            getFirstEncodableVideoCodec
        } = mediabunny;

        output = new Output({
            format: new Mp4OutputFormat(),
            target: new BufferTarget()
        });
        const videoCodec = await getFirstEncodableVideoCodec(
            output.format.getSupportedVideoCodecs(),
            {width, height}
        );
        if (!videoCodec) {
            throw new Error('This browser cannot encode video (no supported MP4 video codec)');
        }

        videoSource = new CanvasSource(captureCanvas, {
            codec: videoCodec,
            quality: new Quality('high')
        });
        output.addVideoTrack(videoSource, {frameRate: framerate});

        if (hasAudioBlocks) {
            if (!audioContext || typeof audioContext.createBuffer !== 'function') {
                throw new Error('This browser cannot render timeline audio');
            }
            audioSampleRate = getTimelineAudioSampleRate(vm, audioContext);
            const audioCodec = await getFirstEncodableAudioCodec(
                output.format.getSupportedAudioCodecs(),
                {numberOfChannels: 2, sampleRate: audioSampleRate}
            );
            if (!audioCodec) {
                throw new Error('This browser cannot encode MP4 audio');
            }
            audioSource = new AudioBufferSource({
                codec: audioCodec,
                quality: new Quality('high')
            });
            output.addAudioTrack(audioSource);
        }
        if (timelineSound && hasAudioBlocks && typeof timelineSound.beginRecording === 'function') {
            timelineSound.beginRecording();
            audioRecordingStarted = true;
        }
        await output.start();

        for (let frame = 0; frame < totalFrames; frame++) {
            throwIfAborted();
            const timestamp = frame / framerate;
            timeline.seek(Math.min(timestamp, duration), false);
            // Export pauses the shared clock. Execute each render-frame hat
            // synchronously after seeking so timer-dependent Scratch blocks
            // update the stage before the canvas is captured.
            if (typeof timeline.triggerRenderFrame === 'function') {
                timeline.triggerRenderFrame({synchronous: true});
            }

            if (customRenderFrame) {
                // eslint-disable-next-line no-await-in-loop
                await customRenderFrame({
                    canvas: captureCanvas,
                    height,
                    time: Math.min(timestamp, duration),
                    vm,
                    width
                });
            } else if (stageRenderer && typeof stageRenderer.drawFrame === 'function') {
                // Await video seeking and render at export resolution, not preview resolution.
                // eslint-disable-next-line no-await-in-loop
                await stageRenderer.drawFrame(captureCanvas);
            } else {
                // Force a draw even when the VM has not marked the renderer
                // dirty; the timer may be consumed by an external renderer.
                if (stageRenderer && Object.prototype.hasOwnProperty.call(stageRenderer, 'dirty')) {
                    stageRenderer.dirty = true;
                }
                if (stageRenderer && typeof stageRenderer.draw === 'function') stageRenderer.draw();
                captureContext.clearRect(0, 0, width, height);
                captureContext.drawImage(stageCanvas, 0, 0, width, height);
            }

            // eslint-disable-next-line no-await-in-loop
            await videoSource.add(timestamp, 1 / framerate);
            if (typeof onProgress === 'function') {
                try {
                    onProgress({
                        currentTime: Math.min(timestamp, duration),
                        duration,
                        frame: frame + 1,
                        progress: (frame + 1) / totalFrames,
                        totalFrames
                    });
                } catch (error) {
                    // Progress callbacks must not break an export.
                }
            }
            if (frame % 30 === 29) {
                // Let the settings dialog paint during long exports.
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 0));
                throwIfAborted();
            }
        }

        videoSource.close();
        videoSourceClosed = true;
        if (audioSource) {
            const recordedSoundEvents = audioRecordingStarted && timelineSound ?
                timelineSound.endRecording() : [];
            audioRecordingStarted = false;
            const audioBuffer = createMixedAudioBuffer(
                audioContext,
                recordedSoundEvents,
                duration,
                audioSampleRate
            );
            await audioSource.add(audioBuffer);
        }
        await output.finalize();
        outputFinalized = true;
        throwIfAborted();

        const buffer = output.target.buffer;
        if (!buffer || !buffer.byteLength) throw new Error('Rendering produced no video data');
        const blob = new Blob([buffer], {type: OUTPUT_MIME_TYPE});
        return {
            blob,
            duration,
            extension: OUTPUT_EXTENSION,
            framerate,
            height,
            mimeType: OUTPUT_MIME_TYPE,
            hasAudio: Boolean(audioSource),
            totalFrames,
            width
        };
    } catch (error) {
        if (videoSource && !videoSourceClosed) {
            try {
                videoSource.close();
            } catch (closeError) {
                // Ignore cleanup errors while reporting the original failure.
            }
        }
        if (output && !outputFinalized) {
            try {
                await output.cancel();
            } catch (cancelError) {
                // Ignore cleanup errors while reporting the original failure.
            }
        }
        throw error;
    } finally {
        if (scene) {
            scene.exporting = false; scene.lastPreviewKey = '';
        }
        if (audioRecordingStarted && timelineSound && typeof timelineSound.endRecording === 'function') {
            timelineSound.endRecording();
        }
        timeline.seek(savedTime, false);
        if (!wasPlaying && typeof timeline.triggerRenderFrame === 'function') {
            timeline.triggerRenderFrame({synchronous: true});
        }
        if (wasPlaying) timeline.play();
        else timeline.pause();
    }
};

export {
    OUTPUT_EXTENSION,
    OUTPUT_MIME_TYPE,
    exportTimelineVideo,
    getTotalFrameCount,
    normalizeExportSettings
};
export default exportTimelineVideo;
