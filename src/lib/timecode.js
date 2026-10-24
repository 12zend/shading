const pad = (value, length = 2) => String(value).padStart(length, '0');

/**
 * Format seconds as a clock readout with decimal seconds (MM:SS.cc, or
 * H:MM:SS.cc from one hour), the single clock format shared by the timeline
 * transport and its accessible labels.
 * @param {number} seconds time in seconds
 * @returns {string} timecode
 */
const formatTimecode = seconds => {
    // Round once on the whole value so 59.999 becomes 01:00.00, never 00:60.00.
    const totalHundredths = Math.max(0, Math.round((Number(seconds) || 0) * 100));
    const hundredths = totalHundredths % 100;
    const totalSeconds = Math.floor(totalHundredths / 100);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    const clock = `${pad(m)}:${pad(s)}.${pad(hundredths)}`;
    return h > 0 ? `${h}:${clock}` : clock;
};

export default formatTimecode;
