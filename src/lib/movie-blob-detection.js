const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const normalizeFrame = frame => {
    if (!frame || !frame.data) return null;
    const width = Math.max(1, Math.round(Number(frame.width) || 0));
    const height = Math.max(1, Math.round(Number(frame.height) || 0));
    if (frame.data.length < width * height * 4) return null;
    return {data: frame.data, height, width};
};

const straightChannel = (data, offset, channel) => {
    const alpha = data[offset + 3];
    if (alpha <= 0) return 0;
    return clamp((data[offset + channel] * 255) / alpha, 0, 255);
};

const luminance = (data, offset) => (
    (straightChannel(data, offset, 0) * 0.299) +
    (straightChannel(data, offset, 1) * 0.587) +
    (straightChannel(data, offset, 2) * 0.114)
);

const buildIntegral = (frame, sample) => {
    const stride = frame.width + 1;
    const values = new Float64Array(stride * (frame.height + 1));
    for (let y = 0; y < frame.height; y++) {
        let row = 0;
        for (let x = 0; x < frame.width; x++) {
            row += sample(frame.data, ((y * frame.width) + x) * 4);
            values[((y + 1) * stride) + x + 1] = values[(y * stride) + x + 1] + row;
        }
    }
    return values;
};

const integralSample = (integral, width, height, x, y, radius) => {
    const stride = width + 1;
    const x0 = Math.max(0, x - radius);
    const y0 = Math.max(0, y - radius);
    const x1 = Math.min(width, x + radius + 1);
    const y1 = Math.min(height, y + radius + 1);
    const sum = integral[(y1 * stride) + x1] - integral[(y0 * stride) + x1] -
        integral[(y1 * stride) + x0] + integral[(y0 * stride) + x0];
    return sum / ((x1 - x0) * (y1 - y0));
};

const makeMask = (frame, options, previousFrame) => {
    const mode = ['alpha', 'bright', 'color', 'dark', 'motion'].includes(String(options.mode).toLowerCase()) ?
        String(options.mode).toLowerCase() : 'dark';
    const threshold = clamp(Number(options.threshold) || 0, 0, 255);
    const blurRadius = clamp(Math.round(Number(options.blurRadius) || 0), 0, 100);
    const targetColor = Array.isArray(options.targetColor) || ArrayBuffer.isView(options.targetColor) ?
        options.targetColor : [1, 1, 1];
    const mask = new Uint8Array(frame.width * frame.height);
    const previousMatches = previousFrame && previousFrame.width === frame.width &&
        previousFrame.height === frame.height;
    if (mode === 'motion' && !previousMatches) return mask;

    const alphaSample = (data, offset) => data[offset + 3];
    const channelSamples = [0, 1, 2].map(channel => (
        (data, offset) => straightChannel(data, offset, channel)
    ));
    const lumaIntegral = blurRadius > 0 && mode !== 'color' ? buildIntegral(frame, luminance) : null;
    const alphaIntegral = blurRadius > 0 ? buildIntegral(frame, alphaSample) : null;
    const colorIntegrals = blurRadius > 0 && mode === 'color' ?
        channelSamples.map(sample => buildIntegral(frame, sample)) : null;
    const previousLumaIntegral = blurRadius > 0 && mode === 'motion' ? buildIntegral(previousFrame, luminance) : null;

    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            const index = (y * frame.width) + x;
            const offset = index * 4;
            const averageAlpha = alphaIntegral ?
                integralSample(alphaIntegral, frame.width, frame.height, x, y, blurRadius) : frame.data[offset + 3];
            let matches = false;
            if (mode === 'alpha') {
                matches = averageAlpha >= threshold;
            } else if (mode === 'color') {
                if (averageAlpha > 0) {
                    let distance = 0;
                    for (let channel = 0; channel < 3; channel++) {
                        const value = colorIntegrals ?
                            integralSample(colorIntegrals[channel], frame.width, frame.height, x, y, blurRadius) :
                            straightChannel(frame.data, offset, channel);
                        distance += Math.abs(value - (clamp(Number(targetColor[channel]) || 0, 0, 1) * 255));
                    }
                    matches = distance < threshold * 3;
                }
            } else if (mode === 'motion') {
                const current = lumaIntegral ?
                    integralSample(lumaIntegral, frame.width, frame.height, x, y, blurRadius) :
                    luminance(frame.data, offset);
                const previous = previousLumaIntegral ?
                    integralSample(previousLumaIntegral, frame.width, frame.height, x, y, blurRadius) :
                    luminance(previousFrame.data, offset);
                const alphaDelta = Math.abs(frame.data[offset + 3] - previousFrame.data[offset + 3]);
                matches = Math.max(Math.abs(current - previous), alphaDelta) >= threshold;
            } else if (averageAlpha > 0) {
                const value = lumaIntegral ?
                    integralSample(lumaIntegral, frame.width, frame.height, x, y, blurRadius) :
                    luminance(frame.data, offset);
                matches = mode === 'bright' ? value >= threshold : value <= threshold;
            }
            mask[index] = matches ? 1 : 0;
        }
    }
    return mask;
};

const dilateMask = (mask, width, height, radius) => {
    if (radius <= 0) return mask;
    const stride = width + 1;
    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += mask[(y * width) + x];
            integral[((y + 1) * stride) + x + 1] = integral[(y * stride) + x + 1] + row;
        }
    }
    const result = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(height, y + radius + 1);
        for (let x = 0; x < width; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(width, x + radius + 1);
            const sum = integral[(y1 * stride) + x1] - integral[(y0 * stride) + x1] -
                integral[(y1 * stride) + x0] + integral[(y0 * stride) + x0];
            result[(y * width) + x] = sum > 0 ? 1 : 0;
        }
    }
    return result;
};

const findBoxes = (mask, frame) => {
    const boxes = [];
    const stack = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start]) continue;
        mask[start] = 0;
        let head = 0;
        let tail = 1;
        stack[0] = start;
        let minimumX = start % frame.width;
        let maximumX = minimumX;
        let minimumY = Math.floor(start / frame.width);
        let maximumY = minimumY;
        let pixelArea = 0;
        while (head < tail) {
            const index = stack[head++];
            const x = index % frame.width;
            const y = Math.floor(index / frame.width);
            pixelArea++;
            minimumX = Math.min(minimumX, x);
            maximumX = Math.max(maximumX, x);
            minimumY = Math.min(minimumY, y);
            maximumY = Math.max(maximumY, y);
            const neighbours = [
                x > 0 ? index - 1 : -1,
                x + 1 < frame.width ? index + 1 : -1,
                y > 0 ? index - frame.width : -1,
                y + 1 < frame.height ? index + frame.width : -1
            ];
            for (const neighbour of neighbours) {
                if (neighbour < 0 || !mask[neighbour]) continue;
                mask[neighbour] = 0;
                stack[tail++] = neighbour;
            }
        }
        const centerX = Math.floor((minimumX + maximumX + 1) / 2);
        const centerY = Math.floor((minimumY + maximumY + 1) / 2);
        const centerOffset = ((centerY * frame.width) + centerX) * 4;
        boxes.push({
            centerX,
            centerY,
            color: [0, 1, 2].map(channel => straightChannel(frame.data, centerOffset, channel)),
            height: maximumY - minimumY + 1,
            maximumX,
            maximumY,
            minimumX,
            minimumY,
            pixelArea,
            width: maximumX - minimumX + 1
        });
    }
    return boxes;
};

/**
 * Key a frame and return one bounding box for every four-connected region.
 * This follows HL_Blobox's core pipeline: keying, optional motion dilation,
 * connected-component extraction, then long-edge percentage filtering.
 * @param {object} inputFrame current premultiplied RGBA frame
 * @param {object} options keying and size options
 * @param {object} previousInputFrame previous frame used by motion mode
 * @returns {Array<object>} detected pixel-coordinate boxes
 */
const detectMovieBlobs = (inputFrame, options = {}, previousInputFrame = null) => {
    const frame = normalizeFrame(inputFrame);
    if (!frame) return [];
    const previousFrame = normalizeFrame(previousInputFrame);
    let mask = makeMask(frame, options, previousFrame);
    if (String(options.mode).toLowerCase() === 'motion') {
        mask = dilateMask(mask, frame.width, frame.height, 2);
    }
    const frameDimension = Math.max(frame.width, frame.height, 1);
    const minimumSize = clamp(Number(options.minimumSize) || 0, 0, 100);
    const maximumSizeValue = Number(options.maximumSize);
    const maximumSize = clamp(Number.isFinite(maximumSizeValue) ? maximumSizeValue : 100, minimumSize, 100);
    const maximumBoxes = clamp(Math.round(Number(options.maximumBoxes) || 100), 1, 1000);
    return findBoxes(mask, frame)
        .filter(box => {
            const percentage = Math.max(box.width, box.height) / frameDimension * 100;
            return percentage >= minimumSize && percentage <= maximumSize;
        })
        .sort((left, right) => (right.pixelArea - left.pixelArea) ||
            (left.minimumY - right.minimumY) || (left.minimumX - right.minimumX))
        .slice(0, maximumBoxes)
        .map((box, index) => ({...box, id: index + 1}));
};

const paintPixel = (output, index, rgb, opacity) => {
    const alpha = clamp(opacity, 0, 1);
    const inverse = 1 - alpha;
    const offset = index * 4;
    output[offset] = Math.round((clamp(rgb[0], 0, 1) * 255 * alpha) + (output[offset] * inverse));
    output[offset + 1] = Math.round((clamp(rgb[1], 0, 1) * 255 * alpha) + (output[offset + 1] * inverse));
    output[offset + 2] = Math.round((clamp(rgb[2], 0, 1) * 255 * alpha) + (output[offset + 2] * inverse));
    output[offset + 3] = Math.round((255 * alpha) + (output[offset + 3] * inverse));
};

/**
 * Draw debugger-style bounding boxes over a premultiplied RGBA frame.
 * @param {object} inputFrame source frame
 * @param {Array<object>} boxes detected boxes
 * @param {object} options overlay appearance
 * @returns {Uint8Array} frame containing the overlay
 */
const drawMovieBlobOverlay = (inputFrame, boxes, options = {}) => {
    const frame = normalizeFrame(inputFrame);
    if (!frame) return new Uint8Array(0);
    const output = new Uint8Array(frame.data);
    if (!Array.isArray(boxes) || !boxes.length) return output;
    const overlay = new Uint8Array(frame.width * frame.height);
    const shape = String(options.shape).toLowerCase() === 'ellipse' ? 'ellipse' : 'rectangle';
    const strokeWidth = clamp(Math.round(Number(options.strokeWidth) || 1), 1, Math.max(frame.width, frame.height));
    const marker = options.marker === true;
    const fillOpacity = clamp(Number(options.fillOpacity) || 0, 0, 1);
    const strokeOpacityValue = Number(options.strokeOpacity);
    const strokeOpacity = clamp(Number.isFinite(strokeOpacityValue) ? strokeOpacityValue : 1, 0, 1);
    const overlayColor = Array.isArray(options.color) || ArrayBuffer.isView(options.color) ?
        options.color : [0, 1, 1];

    for (const box of boxes) {
        const x0 = clamp(Math.round(box.minimumX), 0, frame.width - 1);
        const x1 = clamp(Math.round(box.maximumX), 0, frame.width - 1);
        const y0 = clamp(Math.round(box.minimumY), 0, frame.height - 1);
        const y1 = clamp(Math.round(box.maximumY), 0, frame.height - 1);
        const centerX = (x0 + x1 + 1) / 2;
        const centerY = (y0 + y1 + 1) / 2;
        const radiusX = Math.max(0.5, (x1 - x0 + 1) / 2);
        const radiusY = Math.max(0.5, (y1 - y0 + 1) / 2);
        const innerRadiusX = Math.max(0, radiusX - strokeWidth);
        const innerRadiusY = Math.max(0, radiusY - strokeWidth);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let inside = true;
                let onStroke;
                if (shape === 'ellipse') {
                    const dx = (x + 0.5 - centerX) / radiusX;
                    const dy = (y + 0.5 - centerY) / radiusY;
                    inside = (dx * dx) + (dy * dy) <= 1;
                    const insideInner = innerRadiusX > 0 && innerRadiusY > 0 &&
                        (((x + 0.5 - centerX) / innerRadiusX) ** 2) +
                        (((y + 0.5 - centerY) / innerRadiusY) ** 2) <= 1;
                    onStroke = inside && !insideInner;
                } else {
                    onStroke = x - x0 < strokeWidth || x1 - x < strokeWidth ||
                        y - y0 < strokeWidth || y1 - y < strokeWidth;
                }
                const index = (y * frame.width) + x;
                if (onStroke) overlay[index] = Math.max(overlay[index], Math.round(strokeOpacity * 255));
                else if (inside && fillOpacity > 0) {
                    overlay[index] = Math.max(overlay[index], Math.round(fillOpacity * 255));
                }
            }
        }
        if (marker) {
            const cx = clamp(Math.floor(centerX), 0, frame.width - 1);
            const cy = clamp(Math.floor(centerY), 0, frame.height - 1);
            const markerRadius = Math.max(3, strokeWidth * 2);
            for (let delta = -markerRadius; delta <= markerRadius; delta++) {
                const horizontalX = cx + delta;
                const verticalY = cy + delta;
                if (horizontalX >= 0 && horizontalX < frame.width) {
                    overlay[(cy * frame.width) + horizontalX] = Math.round(strokeOpacity * 255);
                }
                if (verticalY >= 0 && verticalY < frame.height) {
                    overlay[(verticalY * frame.width) + cx] = Math.round(strokeOpacity * 255);
                }
            }
        }
    }
    for (let index = 0; index < overlay.length; index++) {
        if (overlay[index]) paintPixel(output, index, overlayColor, overlay[index] / 255);
    }
    return output;
};

export {detectMovieBlobs as default, drawMovieBlobOverlay};
