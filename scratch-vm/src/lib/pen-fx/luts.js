import EventEmitter from 'events';
import {markMovieProject} from '../project-format';

const PROJECT_KEY = 'penFXLUTs';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_LUTS = 32;

// Horizontal strips: red varies across each square, green downwards, blue by square.
// Square tile atlases and vertical strips use the same row-major slice order.
const lutLayout = (width, height, settings = {}) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width * height > 256 ** 3) throw new Error('LUT dimensions exceed the supported pixel limit.');
    const mode = settings.mode || 'auto';
    if (!['auto', 'tiles', 'hald'].includes(mode)) throw new Error('Unknown LUT layout.');
    let size = Number(settings.size);
    let columns;
    let rows;
    let count = 1;
    if (mode === 'hald') {
        const level = Math.round(Math.cbrt(width));
        size = level * level;
        if (width !== height || level ** 3 !== width || level < 2 || size > 256) {
            throw new Error('Hald LUTs must be square with a cube-number side (8, 27, 64, 125, 216, 512…).');
        }
        columns = 0;
        rows = 0;
    } else if (mode === 'tiles') {
        columns = Number(settings.columns);
        rows = Math.ceil(size / columns);
        if (!Number.isInteger(size) || size < 2 || size > 256 ||
            !Number.isInteger(columns) || columns < 1 || columns > size ||
            width % (columns * size) !== 0 || height % (rows * size) !== 0) {
            throw new Error('Set the RGB size and slice columns to match the image dimensions.');
        }
        count = (width / (columns * size)) * (height / (rows * size));
    } else {
        size = Math.round(Math.cbrt(width * height));
        if (size >= 2 && size <= 256 && size ** 3 === width * height &&
            width % size === 0 && height % size === 0) {
            columns = width / size;
            rows = height / size;
        } else {
            // ReShade MultiLUT/PD80: rows of horizontal N² × N LUT strips.
            size = Math.sqrt(width);
            if (!Number.isInteger(size) || size < 2 || size > 256 || height % size !== 0) {
                throw new Error('Cannot detect this LUT. Choose a layout and specify its RGB size and slice columns.');
            }
            columns = size;
            rows = 1;
            count = height / size;
        }
    }
    const index = typeof settings.index === 'undefined' ? 0 : Number(settings.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new Error(`Choose a LUT number between 1 and ${count}.`);
    }
    const result = {size, columns, rows};
    // Keep legacy descriptors unchanged; extended metadata is opt-in.
    if (mode !== 'auto' || count !== 1 || settings.flipGreen) {
        Object.assign(result, {mode, count, index, flipGreen: settings.flipGreen === true});
    }
    return result;
};

const pngDimensions = (bytes, settings) => {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || bytes.length > MAX_BYTES || signature.some((value, i) => bytes[i] !== value) ||
        String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
        throw new Error('Choose a PNG file smaller than 32 MB.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return {width, height, ...lutLayout(width, height, settings)};
};

const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error('Could not read the LUT PNG.'));
    reader.readAsArrayBuffer(file);
});

const toDataURL = bytes => {
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    }
    return `data:image/png;base64,${btoa(binary)}`;
};

const fromDataURL = data => {
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > MAX_BYTES * 1.4) {
        throw new Error('Invalid saved LUT PNG.');
    }
    return Uint8Array.from(atob(data.slice(22)), character => character.charCodeAt(0));
};

const decodePNG = async (bytes, layout) => {
    const blob = new Blob([bytes], {type: 'image/png'});
    let image;
    if (typeof createImageBitmap === 'function') {
        image = await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
    } else {
        image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not decode the LUT PNG.'));
            img.src = toDataURL(bytes);
        });
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, layout.width, layout.height).data;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] !== 255) throw new Error('Use an opaque PNG LUT without transparent pixels.');
        }
        return pixels;
    } finally {
        if (image.close) image.close();
    }
};

// Repack whole slices, never resample. A 128³ strip becomes a 1536 × 1408 atlas.
const packLUT = (pixels, layout, maxSize) => {
    const columns = Math.ceil(Math.sqrt(layout.size));
    const rows = Math.ceil(layout.size / columns);
    const width = columns * layout.size;
    const height = rows * layout.size;
    if (Math.max(width, height) > maxSize) throw new Error('This LUT exceeds the GPU texture size limit.');
    const packed = new Uint8Array(width * height * 4);
    const index = layout.index || 0;
    const lutColumns = layout.mode === 'hald' ? 1 : layout.width / (layout.columns * layout.size);
    const originX = (index % lutColumns) * layout.columns * layout.size;
    const originY = Math.floor(index / lutColumns) * layout.rows * layout.size;
    for (let slice = 0; slice < layout.size; slice++) {
        for (let y = 0; y < layout.size; y++) {
            const green = layout.flipGreen ? layout.size - 1 - y : y;
            const source = layout.mode === 'hald' ? ((slice * layout.size * layout.size) + (green * layout.size)) * 4 :
                (((originY + (Math.floor(slice / layout.columns) * layout.size) + green) * layout.width) +
                    originX + ((slice % layout.columns) * layout.size)) * 4;
            const target = ((((Math.floor(slice / columns) * layout.size) + y) * width) +
                ((slice % columns) * layout.size)) * 4;
            packed.set(pixels.subarray(source, source + (layout.size * 4)), target);
        }
    }
    return {pixels: packed, width, height, columns};
};

const uploadLUT = (gl, pixels, layout) => {
    const atlas = packLUT(pixels, layout, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const texture = gl.createTexture();
    const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const flags = [gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_COLORSPACE_CONVERSION_WEBGL];
    const previous = flags.map(flag => gl.getParameter(flag));
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.pixels);
        return {texture, width: atlas.width, height: atlas.height, columns: atlas.columns};
    } catch (error) {
        gl.deleteTexture(texture);
        throw error;
    } finally {
        flags.forEach((flag, index) => gl.pixelStorei(flag, previous[index]));
        gl.bindTexture(gl.TEXTURE_2D, binding);
    }
};

class PenFXLUTManager extends EventEmitter {
    constructor (vm, options = {}) {
        super();
        this.vm = vm;
        this.items = [];
        this.generation = 0;
        this.decode = options.decode || decodePNG;
        this.upload = options.upload || uploadLUT;
        const renderer = vm.runtime.renderer || {};
        this.gl = renderer._gl || renderer.gl;
        if (typeof vm.toJSON === 'function' && typeof vm.deserializeProject === 'function') {
            const serialize = vm.toJSON.bind(vm);
            vm.toJSON = (...args) => {
                const project = JSON.parse(serialize(...args));
                if (this.items.length) project[PROJECT_KEY] = this.serialize();
                else delete project[PROJECT_KEY];
                return JSON.stringify(markMovieProject(project));
            };
            const deserialize = vm.deserializeProject.bind(vm);
            vm.deserializeProject = async (project, zip) => {
                await this.restore(project && project[PROJECT_KEY]);
                return deserialize(project, zip);
            };
        }
    }

    serialize () {
        return this.items.map(({id, name, data, settings}) => (
            settings ? {id, name, data, settings} : {id, name, data}
        ));
    }

    changed (dirty = true) {
        this.emit('changed');
        if (dirty && this.vm.runtime.emitProjectChanged) this.vm.runtime.emitProjectChanged();
    }

    uniqueName (name, exceptId) {
        const base = String(name || 'LUT').trim()
            .slice(0, 64) || 'LUT';
        let result = base;
        let suffix = 2;
        const names = new Set(this.items.filter(item => item.id !== exceptId).map(item => item.name));
        while (names.has(result)) {
            result = `${base.slice(0, 56)} ${suffix++}`;
        }
        return result;
    }

    async prepare (bytes, name, id, settings) {
        const layout = pngDimensions(bytes, settings);
        const pixels = await this.decode(bytes, layout);
        const gpu = this.upload(this.gl, pixels, layout);
        return {id, name, data: toDataURL(bytes), ...layout, gpu, settings: settings && {...settings}, pixels};
    }

    async importFile (file, settings) {
        if (file.size > MAX_BYTES) throw new Error('Choose a PNG file smaller than 32 MB.');
        const generation = this.generation;
        const bytes = await readFile(file);
        const item = await this.prepare(bytes, '', `lut-${Date.now()}-${Math.random().toString(36)
            .slice(2)}`, settings);
        if (generation !== this.generation || this.items.length >= MAX_LUTS) {
            this.release(item);
            throw new Error(generation === this.generation ? 'A project can contain up to 32 LUTs.' :
                'The project changed. Import the LUT again.');
        }
        item.name = this.uniqueName(file.name.replace(/\.png$/i, ''));
        this.items.push(item);
        this.changed();
        return item;
    }

    configure (id, settings) {
        const item = this.find(id);
        if (!item) return;
        const layout = pngDimensions(fromDataURL(item.data), settings);
        const gpu = this.upload(this.gl, item.pixels, layout);
        this.release(item);
        Object.assign(item, layout, {gpu,
            settings: {...settings},
            index: layout.index || 0,
            count: layout.count || 1,
            mode: layout.mode || 'auto',
            flipGreen: layout.flipGreen || false});
        this.changed();
    }

    find (name) {
        return this.items.find(item => item.id === String(name) || item.name === String(name));
    }

    rename (id, name) {
        const item = this.find(id);
        if (!item) return;
        item.name = this.uniqueName(name, id);
        this.changed();
    }

    release (item) {
        if (item.gpu && this.gl) this.gl.deleteTexture(item.gpu.texture);
    }

    remove (id) {
        const item = this.find(id);
        if (!item) return;
        this.items = this.items.filter(candidate => candidate !== item);
        this.release(item);
        this.changed();
    }

    async restore (descriptors) {
        const generation = ++this.generation;
        const next = [];
        try {
            if (descriptors !== null && typeof descriptors !== 'undefined' &&
                (!Array.isArray(descriptors) || descriptors.length > MAX_LUTS)) {
                throw new Error('Invalid saved LUT list.');
            }
            for (const descriptor of descriptors || []) {
                if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id ||
                    typeof descriptor.name !== 'string' || !descriptor.name.trim() || descriptor.name.length > 64 ||
                    next.some(item => item.id === descriptor.id || item.name === descriptor.name)) {
                    throw new Error('Invalid or duplicate saved LUT name.');
                }
                next.push(await this.prepare(
                    fromDataURL(descriptor.data), descriptor.name, descriptor.id, descriptor.settings
                ));
            }
            if (generation !== this.generation) throw new Error('LUT loading was superseded by another project.');
        } catch (error) {
            next.forEach(item => this.release(item));
            throw error;
        }
        this.items.forEach(item => this.release(item));
        this.items = next;
        this.changed(false);
    }
}

export {PenFXLUTManager, lutLayout, packLUT, pngDimensions, fromDataURL, toDataURL};
export default PenFXLUTManager;
