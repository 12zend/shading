const pad = (value, length = 2) => String(value).padStart(length, '0');

/**
 * Format seconds as SMPTE-style timecode (HH:MM:SS:FF), the single clock format
 * shared by the top-bar readout and the timeline transport.
 * @param {number} seconds time in seconds
 * @param {number} framerate frames per second
 * @returns {string} timecode
 */
const formatTimecode = (seconds, framerate) => {
    const fps = Math.max(1, Math.round(Number(framerate) || 1));
    const totalFrames = Math.max(0, Math.round((Number(seconds) || 0) * fps));
    const frames = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames, String(fps - 1).length)}`;
};

export default formatTimecode;
