import {calculateEasingProgress, normalizeEasingType} from './movie-easing';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

const getObjectTime = (runtime, util) => {
    const manager = runtime && runtime.movieAssetManager;
    const timelineTime = manager && manager.timeline && Number(manager.timeline.currentTime);
    let time = Number.isFinite(timelineTime) ? timelineTime : 0;
    if (!Number.isFinite(timelineTime) && util && typeof util.ioQuery === 'function') {
        time = finiteNumber(util.ioQuery('clock', 'projectTimer'));
    }
    const offset = util && util.thread ? finiteNumber(util.thread.objectTimeOffset) : 0;
    return time - offset;
};

const calculateAnimationValue = ({from, to, start, end, easing, power = 2}, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const startTime = finiteNumber(start);
    const endTime = finiteNumber(end);
    const currentTime = finiteNumber(time);
    if (endTime <= startTime) return currentTime < startTime ? startValue : endValue;
    if (currentTime <= startTime) return startValue;
    if (currentTime >= endTime) return endValue;
    const progress = (currentTime - startTime) / (endTime - startTime);
    const eased = calculateEasingProgress(normalizeEasingType(easing), progress, power);
    return startValue + ((endValue - startValue) * eased);
};

const calculateLoopValue = (from, to, duration, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const period = Math.abs(finiteNumber(duration));
    if (period <= 0) return startValue;
    const progress = positiveModulo(finiteNumber(time), period) / period;
    return startValue + ((endValue - startValue) * progress);
};

const calculatePingPongValue = (from, to, duration, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const period = Math.abs(finiteNumber(duration));
    if (period <= 0) return startValue;
    const cycle = positiveModulo(finiteNumber(time), period) / period;
    const progress = cycle <= 0.5 ? cycle * 2 : (1 - cycle) * 2;
    return startValue + ((endValue - startValue) * progress);
};

// Deterministic integer hash returning a value in [-1, 1]. It deliberately avoids Math.random so
// seeking to a frame and rendering that frame offline always produce exactly the same result.
const seededNoise = (index, seed) => {
    let value = (Math.trunc(index) ^ Math.imul(Math.trunc(seed), 0x45d9f3b)) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (((value >>> 0) / 0xffffffff) * 2) - 1;
};

const calculateWiggleValue = (frequency, amount, seed, time) => {
    const cyclesPerSecond = Math.abs(finiteNumber(frequency));
    const amplitude = finiteNumber(amount);
    if (cyclesPerSecond <= 0 || amplitude === 0) return 0;
    const sample = finiteNumber(time) * cyclesPerSecond;
    const index = Math.floor(sample);
    const progress = sample - index;
    const smoothProgress = progress * progress * (3 - (2 * progress));
    const first = seededNoise(index, seed);
    const second = seededNoise(index + 1, seed);
    return (first + ((second - first) * smoothProgress)) * amplitude;
};

const isTimeWithin = (time, start, end) => {
    const first = finiteNumber(start);
    const second = finiteNumber(end);
    const minimum = Math.min(first, second);
    const maximum = Math.max(first, second);
    const current = finiteNumber(time);
    return current >= minimum && current <= maximum;
};

const posterizeTime = (time, framerate) => {
    const fps = Math.abs(finiteNumber(framerate));
    if (fps <= 0) return 0;
    return Math.floor((finiteNumber(time) * fps) + 1e-9) / fps;
};

const parseHexColor = value => {
    const source = String(value || '').trim();
    const short = /^#([0-9a-f]{3})$/i.exec(source);
    if (short) return short[1].split('').map(component => parseInt(component + component, 16));
    const full = /^#([0-9a-f]{6})$/i.exec(source);
    if (full) {
        return [
            parseInt(full[1].slice(0, 2), 16),
            parseInt(full[1].slice(2, 4), 16),
            parseInt(full[1].slice(4, 6), 16)
        ];
    }
    return [0, 0, 0];
};

const toHexColor = components => `#${components.map(component => (
    Math.round(clamp(component, 0, 255))
        .toString(16)
        .padStart(2, '0')
)).join('')}`;

const interpolateColor = (from, to, progress) => {
    const start = parseHexColor(from);
    const end = parseHexColor(to);
    const amount = clamp(finiteNumber(progress), 0, 1);
    return toHexColor(start.map((component, index) => component + ((end[index] - component) * amount)));
};

const interpolateAngle = (from, to, progress) => {
    const start = finiteNumber(from);
    const end = finiteNumber(to);
    const delta = positiveModulo(end - start + 180, 360) - 180;
    return start + (delta * clamp(finiteNumber(progress), 0, 1));
};

const getAnimationProgress = ({start, end, easing, power = 2}, time) => calculateAnimationValue({
    from: 0,
    to: 1,
    start,
    end,
    easing,
    power
}, time);

export {
    calculateAnimationValue,
    calculateLoopValue,
    calculatePingPongValue,
    calculateWiggleValue,
    finiteNumber,
    getAnimationProgress,
    getObjectTime,
    interpolateAngle,
    interpolateColor,
    isTimeWithin,
    posterizeTime,
    seededNoise
};
