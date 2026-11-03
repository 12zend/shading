// Read a simulation value between two steps: S(t) for t between step k and step k + 1, `alpha` of the way.

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

const lerp = (from, to, alpha) => from + ((to - from) * alpha);

// Degrees along the shorter way round.
const lerpAngle = (from, to, alpha) => from + ((positiveModulo((to - from) + 180, 360) - 180) * alpha);

const slerp = (from, to, alpha) => {
    let [bx, by, bz, bw] = to;
    const [ax, ay, az, aw] = from;
    let cosine = (ax * bx) + (ay * by) + (az * bz) + (aw * bw);
    // q and -q are the same rotation: go the short way.
    if (cosine < 0) {
        cosine = -cosine;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    let fromWeight = 1 - alpha;
    let toWeight = alpha;
    if (cosine < 0.9995) {
        const angle = Math.acos(Math.min(1, cosine));
        const sine = Math.sin(angle);
        fromWeight = Math.sin((1 - alpha) * angle) / sine;
        toWeight = Math.sin(alpha * angle) / sine;
    }
    const result = [
        (ax * fromWeight) + (bx * toWeight),
        (ay * fromWeight) + (by * toWeight),
        (az * fromWeight) + (bz * toWeight),
        (aw * fromWeight) + (bw * toWeight)
    ];
    const length = Math.hypot(...result) || 1;
    return result.map(component => component / length);
};

const isNumberList = (value, length) => Array.isArray(value) && value.length === length &&
    value.every(item => typeof item === 'number');

/**
 * @param {*} from Value at step k.
 * @param {*} to Value at step k + 1 (undefined when the key appeared or disappeared).
 * @param {number} alpha 0 at step k, 1 at step k + 1.
 * @param {string} type Interpolation type of the key (see SimulationState.types).
 * @returns {*} The value at alpha. Strings, booleans and list lengths are not interpolated: they keep step k's.
 */
const interpolateValue = (from, to, alpha, type = null) => {
    if (alpha <= 0 || typeof to === 'undefined') return from;
    if (typeof from === 'undefined') return alpha >= 1 ? to : from;
    if (type === 'quaternion' && isNumberList(from, 4) && isNumberList(to, 4)) return slerp(from, to, alpha);
    if (type === 'pose' && isNumberList(from, 7) && isNumberList(to, 7)) {
        return [
            lerp(from[0], to[0], alpha),
            lerp(from[1], to[1], alpha),
            lerp(from[2], to[2], alpha),
            ...slerp(from.slice(3), to.slice(3), alpha)
        ];
    }
    if (typeof from === 'number' && typeof to === 'number') {
        return type === 'angle' ? lerpAngle(from, to, alpha) : lerp(from, to, alpha);
    }
    if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
        return from.map((item, index) => (
            typeof item === 'number' && typeof to[index] === 'number' ?
                (type === 'angle' ? lerpAngle(item, to[index], alpha) : lerp(item, to[index], alpha)) : item
        ));
    }
    return from;
};

// Value of `key` between two snapshots.
const interpolateSnapshots = (from, to, alpha, key) => {
    const type = from.types.get(key) || (to && to.types.get(key)) || null;
    return interpolateValue(from.values.get(key), to ? to.values.get(key) : from.values.get(key), to ? alpha : 0, type);
};

export {
    interpolateSnapshots,
    interpolateValue,
    lerpAngle,
    slerp
};
