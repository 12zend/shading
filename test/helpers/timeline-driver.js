// Drives a VM's Movie timeline through the ways the editor can reach a frame: exporting from the start, exporting
// from just before the frame, seeking while paused, playing and stopping, and exporting again with frame reuse.
// The VM clock is replaced by a manual one so playback is reproducible. Used by the jest determinism harness
// (stub renderer) and by scripts/frame-hash/ (real renderer in Chromium).

const WAYS = ['exportFromStart', 'exportFromNear', 'seek', 'playAndStop', 'exportReusingFrames'];

/**
 * @param {object} options Driver options.
 * @param {object} options.vm VM with the Movie asset manager installed.
 * @param {Function} options.readFrame Returns the signature of the frame currently on screen.
 * @param {Function} options.readExportedFrame Returns the signature of an exported rendering frame.
 * @returns {object} Driver.
 */
const createTimelineDriver = ({vm, readFrame, readExportedFrame}) => {
    const runtime = vm.runtime;
    const manager = runtime.movieAssetManager;
    let nowMSecs = 0;
    runtime.updateCurrentMSecs = () => {
        runtime.currentMSecs = nowMSecs;
    };
    runtime.updateCurrentMSecs();

    const isBusy = () => {
        const timeline = manager.timeline;
        return Boolean(timeline.pendingFrame || timeline.waitingForFrame || timeline.waitingForVideo ||
            timeline.waitingForSimulation || timeline.initializing);
    };

    const driver = {
        get framerate () {
            return manager.timeline.framerate;
        },

        frameTime (frameIndex) {
            return frameIndex / manager.timeline.framerate;
        },

        setClock (seconds) {
            nowMSecs = seconds * 1000;
            runtime.updateCurrentMSecs();
        },

        step () {
            runtime._step();
        },

        // Step until no render-frame script, visual render, initialization or simulation is pending.
        async settle (limit = 1000) {
            for (let index = 0; index < limit; index++) {
                const promises = manager.getOfflineRenderPromises();
                if (promises.length) await Promise.all(promises);
                if (!isBusy()) return;
                driver.step();
            }
            throw new Error('The timeline did not settle.');
        },

        // Export [start, end] seconds. Resolves to a Map of frame index -> exported signature.
        exportRange ({start = 0, end, reuseFrames = false} = {}) {
            return new Promise((resolve, reject) => {
                const finish = () => {
                    manager.removeListener('renderError', fail);
                    const result = new Map();
                    manager.renderingFrames.forEach((frame, index) => {
                        result.set(manager.renderingFrameNumbers[index], readExportedFrame(frame));
                    });
                    resolve(result);
                };
                const fail = error => {
                    manager.removeListener('timelineRenderComplete', finish);
                    reject(error);
                };
                manager.once('timelineRenderComplete', finish);
                manager.once('renderError', fail);
                manager.renderTimeline({start, end, reuseFrames});
            });
        },

        // Seek while paused and evaluate the frame there.
        async seekTo (frameIndex) {
            if (manager.timeline.playing) manager.pauseTimeline();
            manager.seekTimeline(driver.frameTime(frameIndex));
            await driver.settle();
            return readFrame();
        },

        // Play from `from` (or the current frame with seek: false) with the clock advancing by `stepSeconds` per VM
        // tick, then stop on the frame.
        async playUntil (frameIndex, {stepSeconds = 1 / manager.timeline.framerate, from = 0, seek = true} = {}) {
            if (manager.timeline.playing) manager.pauseTimeline();
            if (seek) {
                manager.seekTimeline(driver.frameTime(from));
                await driver.settle();
            } else {
                from = manager.getFrameIndexAtTime(manager.timeline.currentTime);
            }
            await driver.startPlayback();
            const startClock = nowMSecs / 1000;
            const target = driver.frameTime(frameIndex) - driver.frameTime(from);
            let elapsed = 0;
            for (let guard = 0; guard < 100000; guard++) {
                driver.setClock(startClock + elapsed);
                driver.step();
                const promises = manager.getOfflineRenderPromises();
                if (promises.length) await Promise.all(promises);
                if (elapsed >= target - 1e-9) break;
                elapsed = Math.min(target, elapsed + stepSeconds);
            }
            await driver.settle();
            const frame = readFrame();
            manager.pauseTimeline();
            return frame;
        },

        // Start playback and step until `initialize` has finished and the playback clock runs.
        async startPlayback () {
            manager.playTimeline();
            for (let guard = 0; manager.timeline.startClockAfterInitialize && guard < 1000; guard++) {
                driver.step();
                const promises = manager.getOfflineRenderPromises();
                if (promises.length) await Promise.all(promises);
            }
        },

        // Reach `frame` in each of the five ways. Returns {way: signature}.
        async reachFrame (frame) {
            const end = driver.frameTime(frame);
            const fromStart = await driver.exportRange({start: 0, end});
            const fromNear = await driver.exportRange({start: driver.frameTime(Math.max(0, frame - 2)), end});
            const seek = await driver.seekTo(frame);
            const playAndStop = await driver.playUntil(frame);
            await driver.exportRange({start: 0, end, reuseFrames: true});
            const reused = await driver.exportRange({start: 0, end, reuseFrames: true});
            return {
                exportFromStart: fromStart.get(frame),
                exportFromNear: fromNear.get(frame),
                seek,
                playAndStop,
                exportReusingFrames: reused.get(frame)
            };
        },

        dispose () {
            clearTimeout(manager.timelinePreviewRefreshTimeout);
            manager.stopTimeline();
            runtime.stopAll();
        }
    };
    return driver;
};

export {WAYS, createTimelineDriver};
