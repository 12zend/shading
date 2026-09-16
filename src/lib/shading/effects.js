/* eslint-disable no-mixed-operators */
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const rgb = value => {
    let hex = String(value || '#000000').replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c)
            .join('');
    }
    const number = /^[a-f\d]{6}$/i.test(hex) ? parseInt(hex, 16) : finite(value, 0);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255].map(v => v / 255);
};

const gradePixels = (data, args) => {
    const temperature = clamp(finite(args.TEMP, 0), -100, 100) / 100;
    const tint = clamp(finite(args.TINT, 0), -100, 100) / 100;
    const saturation = Math.max(0, finite(args.SATURATION, 100) / 100);
    const contrast = Math.max(0, finite(args.CONTRAST, 100) / 100);
    const pivot = clamp(finite(args.PIVOT, 0.5));
    const ranges = ['SHADOW', 'MIDTONE', 'HIGHLIGHT'].map(range => ({
        add: rgb(args[`${range}_ADD`] || '#000000'),
        mul: rgb(args[`${range}_MUL`] || '#ffffff'),
        div: rgb(args[`${range}_DIV`] || '#ffffff')
    }));
    for (let i = 0; i < data.length; i += 4) {
        const c = [data[i] / 255 + temperature * 0.1, data[i + 1] / 255 + tint * 0.1,
            data[i + 2] / 255 - temperature * 0.1];
        const luminance = clamp(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
        const shadow = Math.pow(1 - luminance, 2);
        const highlight = Math.pow(luminance, 2);
        const weights = [shadow, 1 - shadow - highlight, highlight];
        for (let channel = 0; channel < 3; channel++) {
            const value = (luminance + (c[channel] - luminance) * saturation - pivot) * contrast + pivot;
            let graded = 0;
            for (let range = 0; range < 3; range++) {
                const operation = ranges[range];
                graded += weights[range] * ((value + operation.add[channel]) * operation.mul[channel] /
                    Math.max(1 / 255, operation.div[channel]));
            }
            data[i + channel] = Math.round(clamp(graded) * 255);
        }
    }
    return data;
};

const edgeIndex = (index, length, mode) => {
    if (index >= 0 && index < length) return index;
    if (mode === 'transparent') return -1;
    if (mode === 'mirror') {
        const period = length * 2;
        const reflected = ((index % period) + period) % period;
        return reflected < length ? reflected : period - reflected - 1;
    }
    return clamp(index, 0, length - 1);
};

// Separable sliding windows make large radii O(width * height), not O(radius * pixels).
const boxPass = (source, width, height, radius, horizontal, edge) => {
    const output = new Float32Array(source.length);
    const length = horizontal ? width : height;
    const lines = horizontal ? height : width;
    const diameter = radius * 2 + 1;
    for (let line = 0; line < lines; line++) {
        const sums = [0, 0, 0, 0];
        const indexOf = coordinate => {
            const at = edgeIndex(coordinate, length, edge);
            return at < 0 ? -1 : (horizontal ? line * width + at : at * width + line) * 4;
        };
        const accumulate = (coordinate, sign) => {
            const index = indexOf(coordinate);
            if (index < 0) return;
            for (let c = 0; c < 4; c++) sums[c] += source[index + c] * sign;
        };
        for (let x = -radius; x <= radius; x++) accumulate(x, 1);
        for (let x = 0; x < length; x++) {
            const index = (horizontal ? line * width + x : x * width + line) * 4;
            for (let c = 0; c < 4; c++) output[index + c] = sums[c] / diameter;
            accumulate(x - radius, -1);
            accumulate(x + radius + 1, 1);
        }
    }
    return output;
};

const blurPixels = (data, width, height, args) => {
    const radius = clamp(Math.round(finite(args.RADIUS, 0)), 0, 256);
    if (!radius) return data;
    const repeat = args.REPEAT === true || String(args.REPEAT) === 'true';
    const edge = repeat && args.EDGE === 'transparent' ? 'clamp' : String(args.EDGE || 'clamp');
    let buffer = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        for (let c = 0; c < 3; c++) buffer[i + c] = data[i + c] * alpha;
        buffer[i + 3] = data[i + 3];
    }
    const passes = args.MODE === 'box' ? 1 : 3;
    const passRadius = passes === 1 ? radius : Math.max(1, Math.round(radius / Math.sqrt(3)));
    for (let pass = 0; pass < passes; pass++) {
        buffer = boxPass(buffer, width, height, passRadius, true, edge);
        buffer = boxPass(buffer, width, height, passRadius, false, edge);
    }
    for (let i = 0; i < data.length; i += 4) {
        const alpha = buffer[i + 3] / 255;
        for (let c = 0; c < 3; c++) data[i + c] = alpha > 0 ? buffer[i + c] / alpha : 0;
        data[i + 3] = buffer[i + 3];
    }
    return data;
};

const averageColor = data => {
    const result = [0, 0, 0];
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        weight += alpha;
        for (let c = 0; c < 3; c++) result[c] += data[i + c] * alpha;
    }
    return result.map(value => (weight ? value / weight : 0));
};

const autoGradePixels = (data, background) => {
    const source = averageColor(data);
    const destination = averageColor(background);
    if (source.every(v => v === 0) || destination.every(v => v === 0)) return data;
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            data[i + c] *= clamp(destination[c] / Math.max(1, source[c]), 0.25, 4);
        }
    }
    return data;
};
export {gradePixels, blurPixels, autoGradePixels, edgeIndex};
