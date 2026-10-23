/**
 * The one time-range formula shared by every Movie time block: `time within`, the `time: [T1] ~ [T2]`
 * draw range of Objects, `time range`, `animate`, the interpolate blocks and `easing`.
 *
 * Time offsets and scopes reach a boundary along different paths (`time - offset` compared with T1,
 * or `time` compared with `T1 + offset`), and floating-point arithmetic does not round both paths
 * the same way (0.1 + 0.2 !== 0.3). Every comparison therefore treats times within TIME_EPSILON
 * seconds of a boundary as being on it, so the blocks agree on the frame where a range starts and ends.
 */

const TIME_EPSILON = 1e-9;

/**
 * Whether a time lies in a range. Both ends are included and reversed ends are swapped.
 *
 * @param {number} time Current time in seconds.
 * @param {number} start Range start in seconds; may be infinite.
 * @param {number} end Range end in seconds; may be infinite.
 * @returns {boolean} True from the start through the end of the range.
 */
const isTimeInRange = (time, start, end) => {
    const minimum = Math.min(start, end);
    const maximum = Math.max(start, end);
    return time >= minimum - TIME_EPSILON && time <= maximum + TIME_EPSILON;
};

/**
 * Linear progress of a time through a range: 0 through the start, 1 from the end on.
 * A range whose end is not after its start switches from 0 to 1 at the start.
 *
 * @param {number} time Current time in seconds.
 * @param {number} start Range start in seconds.
 * @param {number} end Range end in seconds.
 * @returns {number} Progress from 0 to 1.
 */
const getTimeRangeProgress = (time, start, end) => {
    if (end - start <= TIME_EPSILON) return time < start - TIME_EPSILON ? 0 : 1;
    if (time <= start + TIME_EPSILON) return 0;
    if (time >= end - TIME_EPSILON) return 1;
    return (time - start) / (end - start);
};

export {
    TIME_EPSILON,
    getTimeRangeProgress,
    isTimeInRange
};
