/* eslint-disable */

import {boolean, mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.pixelSort = function (type, spanLimit, invertMask, minimum, maximum, sortBy, reverse, gamma, centerX, centerY,
        mixValue, blendMode) {
        const gl = this.gl;
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        const pixelCount = this.width * this.height;
        if (!this.pixelSortSource || this.pixelSortSource.length !== pixelCount * 4) {
            this.pixelSortSource = new Uint8Array(pixelCount * 4);
            this.pixelSortOutput = new Uint8Array(pixelCount * 4);
            this.pixelSortKeys = new Float64Array(pixelCount);
            this.pixelSortSelected = new Uint8Array(pixelCount);
        }
        const source = this.pixelSortSource;
        const output = this.pixelSortOutput;
        const keys = this.pixelSortKeys;
        const selected = this.pixelSortSelected;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, source);
        output.set(source);
        const low = Math.min(minimum, maximum);
        const high = Math.max(minimum, maximum);
        for (let index = 0, offset = 0; index < pixelCount; index++, offset += 4) {
            const alphaByte = source[offset + 3];
            let value = -1;
            if (alphaByte > 0) {
                const r = source[offset] / alphaByte;
                const g = source[offset + 1] / alphaByte;
                const b = source[offset + 2] / alphaByte;
                if (sortBy === 'saturation') {
                    value = Math.max(r, g, b) - Math.min(r, g, b);
                } else if (sortBy === 'hue') {
                    const max = Math.max(r, g, b);
                    const delta = max - Math.min(r, g, b);
                    if (delta <= 0.00001) {
                        value = 0;
                    } else {
                        let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
                        if (hue < 0) hue += 6;
                        value = hue / 6;
                    }
                } else {
                    value = r * 0.2126 + g * 0.7152 + b * 0.0722;
                }
            }
            keys[index] = value;
            const inside = value >= low && value <= high;
            selected[index] = value >= 0 && (invertMask ? !inside : inside) ? 1 : 0;
        }
        const requestedSpan = Math.floor(Math.abs(spanLimit));
        const indices = this.pixelSortIndices;
        const lineIndices = this.pixelSortLine;
        const compare = reverse ?
            (a, b) => keys[b] - keys[a] || a - b :
            (a, b) => keys[a] - keys[b] || a - b;
        const inverseMix = 1 - mixValue;
        const applyGamma = gamma !== 1;
        const sortLine = line => {
            const lineLength = line.length;
            const maxSpan = requestedSpan >= lineLength ? lineLength : Math.min(256, Math.max(1, requestedSpan));
            let position = 0;
            while (position < lineLength) {
                const pixelIndex = line[position];
                if (!selected[pixelIndex]) {
                    position++; continue;
                }
                const start = position;
                let count = 0;
                while (position < lineLength && count < maxSpan) {
                    const candidate = line[position];
                    if (!selected[candidate]) break;
                    indices[count++] = candidate;
                    position++;
                }
                indices.length = count;
                indices.sort(compare);
                for (let i = 0; i < count; i++) {
                    const targetOffset = line[start + i] * 4;
                    const sampleOffset = indices[i] * 4;
                    const alphaByte = source[sampleOffset + 3];
                    let red = source[sampleOffset];
                    let green = source[sampleOffset + 1];
                    let blue = source[sampleOffset + 2];
                    if (applyGamma && alphaByte > 0) {
                        red = Math.pow(Math.max(0, red / alphaByte), gamma) * alphaByte;
                        green = Math.pow(Math.max(0, green / alphaByte), gamma) * alphaByte;
                        blue = Math.pow(Math.max(0, blue / alphaByte), gamma) * alphaByte;
                    }
                    output[targetOffset] = Math.round(source[targetOffset] * inverseMix + red * mixValue);
                    output[targetOffset + 1] = Math.round(source[targetOffset + 1] * inverseMix + green * mixValue);
                    output[targetOffset + 2] = Math.round(source[targetOffset + 2] * inverseMix + blue * mixValue);
                    output[targetOffset + 3] = Math.round(source[targetOffset + 3] * inverseMix + alphaByte * mixValue);
                }
            }
        };
        if (type === 'x' || type === 'y') {
            const lineCount = type === 'y' ? this.width : this.height;
            const lineLength = type === 'y' ? this.height : this.width;
            const stride = type === 'y' ? this.width : 1;
            for (let lineNumber = 0; lineNumber < lineCount; lineNumber++) {
                const lineStart = type === 'y' ? lineNumber : lineNumber * this.width;
                lineIndices.length = lineLength;
                for (let position = 0; position < lineLength; position++) {
                    lineIndices[position] = lineStart + position * stride;
                }
                sortLine(lineIndices);
            }
        } else {
            const center = [
                Math.min(this.width - 0.5, Math.max(0.5, this.width * 0.5 + centerX)),
                Math.min(this.height - 0.5, Math.max(0.5, this.height * 0.5 + centerY))
            ];
            const maxRadius = Math.ceil(Math.max(
                Math.hypot(center[0], center[1]),
                Math.hypot(this.width - center[0], center[1]),
                Math.hypot(center[0], this.height - center[1]),
                Math.hypot(this.width - center[0], this.height - center[1])
            ));
            const addPolarPixel = (x, y, previous) => {
                const px = Math.floor(x);
                const py = Math.floor(y);
                if (px < 0 || px >= this.width || py < 0 || py >= this.height) return previous;
                const index = py * this.width + px;
                if (index !== previous) lineIndices.push(index);
                return index;
            };
            if (type === 'size') {
                const rayCount = Math.min(1440, Math.max(360, Math.ceil(Math.PI * 2 * maxRadius)));
                for (let ray = 0; ray < rayCount; ray++) {
                    const angle = ray / rayCount * Math.PI * 2;
                    const cosine = Math.cos(angle);
                    const sine = Math.sin(angle);
                    let previous = -1;
                    lineIndices.length = 0;
                    for (let radius = 0; radius <= maxRadius; radius++) {
                        previous = addPolarPixel(center[0] + cosine * radius, center[1] + sine * radius, previous);
                    }
                    sortLine(lineIndices);
                }
            } else {
                for (let radius = 0; radius <= maxRadius; radius++) {
                    const sampleCount = Math.max(1, Math.ceil(Math.PI * 2 * Math.max(radius, 1)));
                    let previous = -1;
                    lineIndices.length = 0;
                    for (let sample = 0; sample < sampleCount; sample++) {
                        const angle = sample / sampleCount * Math.PI * 2;
                        previous = addPolarPixel(center[0] + Math.cos(angle) * radius,
                            center[1] + Math.sin(angle) * radius, previous);
                    }
                    sortLine(lineIndices);
                }
            }
        }
        const direct = this._canRenderDirectly(blendMode);
        if (!direct) this._ensureSecondaryBuffer();
        gl.bindTexture(gl.TEXTURE_2D, direct ? skin._texture : this.textures[1]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, output);
        if (direct) this._markSkinChanged(skin);
        else this._finish(skin, this.textures[1], blendMode);
    };

    PenFX.prototype.pixelSort = function (args) {
        const type = ['x', 'y', 'size', 'dir'].includes(String(args.TYPE)) ? String(args.TYPE) : 'x';
        const sortBy = ['luminance', 'saturation', 'hue'].includes(String(args.SORTBY)) ? String(args.SORTBY) : 'luminance';
        this._safe(engine => engine.pixelSort(type, numberOr(args.SPAN, numberOr(args.VALUE, 64)), boolean(args.INVERT),
            Math.min(1, Math.max(0, numberOr(args.MIN, 0))), Math.min(1, Math.max(0, numberOr(args.MAX, 1))),
            sortBy, boolean(args.REVERSE), Math.max(0.01, numberOr(args.GAMMA, 1)), number(args.CENTERX),
            number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
