/* eslint-disable */

import JSZip from '@turbowarp/jszip';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';

import {boolean, color, number} from './helpers';
import {markMovieProject} from '../project-format';

const CUSTOM_SHADER_PROJECT_KEY = 'penFXShaders';
const CUSTOM_SHADER_FORMAT = 'shading.app/penfx-shader';
const CUSTOM_SHADER_VERSION = 1;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 128;
const MAX_MANIFEST_CHARACTERS = 64 * 1024;
const MAX_SHADER_CHARACTERS = 512 * 1024;
const MAX_TOTAL_SHADER_CHARACTERS = 2 * 1024 * 1024;
const MAX_BLOCKS = 32;
const MAX_INPUTS = 12;
const STANDARD_UNIFORMS = new Set(['u_image', 'u_resolution', 'u_time', 'u_frame']);
const INPUT_TYPES = new Set(['angle', 'boolean', 'color', 'integer', 'menu', 'number']);

const cloneJSON = value => JSON.parse(JSON.stringify(value));

const humanize = value => String(value || '')
    .replace(/\.glsl$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slug = value => humanize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'shader';

const hashText = value => {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const assertString = (value, label, maximum = 120) => {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} is required.`);
    if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
    return text;
};

const normalizeId = (value, label) => {
    const id = assertString(value, label, 48).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        throw new Error(`${label} must use lowercase letters, numbers, and hyphens.`);
    }
    return id;
};

const normalizePath = (value, label) => {
    const path = assertString(value, label, 240).replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = path.split('/');
    if (path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error(`${label} must be a relative path without dot segments.`);
    }
    return parts.join('/');
};

const dirname = path => {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
};

const joinPath = (root, relative) => root ? `${root}/${relative}` : relative;

const normalizeNumber = (value, fallback, label) => {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(result)) throw new Error(`${label} must be a finite number.`);
    return result;
};

const normalizeInput = (rawInput, blockLabel) => {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
        throw new Error(`${blockLabel} has an invalid input.`);
    }
    const id = assertString(rawInput.id, `${blockLabel} input id`, 32).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(id)) {
        throw new Error(`${blockLabel} input id ${id} must use A-Z, 0-9, and underscores.`);
    }
    const type = String(rawInput.type || 'number').toLowerCase();
    if (!INPUT_TYPES.has(type)) throw new Error(`${blockLabel} input ${id} has unsupported type ${type}.`);
    const label = assertString(rawInput.label || humanize(id), `${blockLabel} input ${id} label`, 48);
    const uniform = assertString(rawInput.uniform || `u_${id.toLowerCase()}`, `${blockLabel} input ${id} uniform`, 64);
    if (!/^u_[A-Za-z][A-Za-z0-9_]*$/.test(uniform) || STANDARD_UNIFORMS.has(uniform)) {
        throw new Error(`${blockLabel} input ${id} has invalid or reserved uniform ${uniform}.`);
    }
    const result = {
        id,
        label,
        type,
        uniform
    };
    if (type === 'menu') {
        if (!Array.isArray(rawInput.items) || rawInput.items.length < 1 || rawInput.items.length > 32) {
            throw new Error(`${blockLabel} input ${id} must define 1 to 32 menu items.`);
        }
        result.items = rawInput.items.map((item, index) => assertString(
            item,
            `${blockLabel} input ${id} menu item ${index + 1}`,
            64
        ));
        if (new Set(result.items).size !== result.items.length) {
            throw new Error(`${blockLabel} input ${id} menu items must be unique.`);
        }
        result.defaultValue = rawInput.defaultValue === undefined ? result.items[0] : String(rawInput.defaultValue);
        if (!result.items.includes(result.defaultValue)) {
            throw new Error(`${blockLabel} input ${id} defaultValue must be one of its menu items.`);
        }
    } else if (type === 'color') {
        result.defaultValue = String(rawInput.defaultValue || '#ffffff');
        if (!/^#[0-9a-f]{6}$/i.test(result.defaultValue)) {
            throw new Error(`${blockLabel} input ${id} defaultValue must be a six-digit hex color.`);
        }
    } else if (type === 'boolean') {
        result.defaultValue = rawInput.defaultValue === undefined ? false : boolean(rawInput.defaultValue);
    } else {
        result.defaultValue = normalizeNumber(rawInput.defaultValue, 0, `${blockLabel} input ${id} defaultValue`);
        result.scale = normalizeNumber(rawInput.scale, 1, `${blockLabel} input ${id} scale`);
        result.offset = normalizeNumber(rawInput.offset, 0, `${blockLabel} input ${id} offset`);
    }
    return result;
};

const normalizeBlock = (rawBlock, source, usedIds) => {
    if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
        throw new Error('Each shader block must be an object.');
    }
    const id = normalizeId(rawBlock.id, 'Shader block id');
    if (usedIds.has(id)) throw new Error(`Duplicate shader block id: ${id}.`);
    usedIds.add(id);
    const name = assertString(rawBlock.name || humanize(id), `Shader block ${id} name`, 64);
    const file = normalizePath(rawBlock.file || `${id}.glsl`, `Shader block ${id} file`);
    if (!/\.glsl$/i.test(file)) throw new Error(`Shader block ${id} file must end in .glsl.`);
    const inputs = rawBlock.inputs === undefined ? [] : rawBlock.inputs;
    if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) {
        throw new Error(`Shader block ${id} must define no more than ${MAX_INPUTS} inputs.`);
    }
    const normalizedInputs = inputs.map(input => normalizeInput(input, `Shader block ${id}`));
    if (new Set(normalizedInputs.map(input => input.id)).size !== normalizedInputs.length) {
        throw new Error(`Shader block ${id} input ids must be unique.`);
    }
    if (new Set(normalizedInputs.map(input => input.uniform)).size !== normalizedInputs.length) {
        throw new Error(`Shader block ${id} uniforms must be unique.`);
    }
    const generatedText = [name].concat(normalizedInputs.map(input => `${input.label}: [${input.id}]`)).join(' ');
    const text = assertString(rawBlock.text || generatedText, `Shader block ${id} text`, 320);
    const placeholders = [];
    const placeholderPattern = /\[([A-Z][A-Z0-9_]*)\]/g;
    let placeholderMatch = placeholderPattern.exec(text);
    while (placeholderMatch) {
        placeholders.push(placeholderMatch[1]);
        placeholderMatch = placeholderPattern.exec(text);
    }
    const inputIds = normalizedInputs.map(input => input.id);
    if (placeholders.some(placeholder => !inputIds.includes(placeholder)) ||
        inputIds.some(inputId => !placeholders.includes(inputId))) {
        throw new Error(`Shader block ${id} text placeholders must match its input ids.`);
    }
    const fragmentSource = assertString(source, `Shader block ${id} GLSL`, MAX_SHADER_CHARACTERS);
    if (fragmentSource.indexOf('\0') !== -1) throw new Error(`Shader block ${id} GLSL contains a null byte.`);
    if (!/\bvoid\s+main\s*\(/.test(fragmentSource)) {
        throw new Error(`Shader block ${id} GLSL must define void main().`);
    }
    return {
        id,
        name,
        text,
        file,
        source: fragmentSource.replace(/\r\n?/g, '\n'),
        inputs: normalizedInputs
    };
};

const normalizePackage = rawPackage => {
    if (!rawPackage || typeof rawPackage !== 'object' || Array.isArray(rawPackage)) {
        throw new Error('Shader package descriptor must be an object.');
    }
    if (rawPackage.format !== CUSTOM_SHADER_FORMAT) {
        throw new Error(`Shader package format must be ${CUSTOM_SHADER_FORMAT}.`);
    }
    if (Number(rawPackage.version) !== CUSTOM_SHADER_VERSION) {
        throw new Error(`Unsupported shader package version: ${rawPackage.version}.`);
    }
    const id = normalizeId(rawPackage.id, 'Shader package id');
    const name = assertString(rawPackage.name || humanize(id), 'Shader package name', 64);
    if (!Array.isArray(rawPackage.blocks) || rawPackage.blocks.length < 1 || rawPackage.blocks.length > MAX_BLOCKS) {
        throw new Error(`Shader package must define 1 to ${MAX_BLOCKS} blocks.`);
    }
    const usedIds = new Set();
    const blocks = rawPackage.blocks.map(rawBlock => normalizeBlock(rawBlock, rawBlock.source, usedIds));
    const totalCharacters = blocks.reduce((total, block) => total + block.source.length, 0);
    if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) {
        throw new Error('Shader package GLSL is too large.');
    }
    return {
        format: CUSTOM_SHADER_FORMAT,
        version: CUSTOM_SHADER_VERSION,
        id,
        name,
        blocks
    };
};

const entryUncompressedSize = entry => {
    const size = entry && entry._data && entry._data.uncompressedSize;
    return Number.isFinite(size) ? size : 0;
};

const readEntryText = async (entry, maximum, label) => {
    if (entryUncompressedSize(entry) > maximum * 4) throw new Error(`${label} is too large.`);
    const text = await entry.async('string');
    if (text.length > maximum) throw new Error(`${label} is too large.`);
    return text;
};

const parseShaderZip = async (data, archiveName = 'shader.zip') => {
    const byteLength = data && (data.byteLength === undefined ? data.size : data.byteLength);
    if (Number.isFinite(byteLength) && byteLength > MAX_ARCHIVE_BYTES) {
        throw new Error('Shader zip must be 10 MB or smaller.');
    }
    const zip = await JSZip.loadAsync(data);
    const entries = Object.values(zip.files).filter(entry => !entry.dir && !/^__MACOSX\//.test(entry.name));
    if (entries.length > MAX_ARCHIVE_FILES) throw new Error('Shader zip contains too many files.');
    const declaredSize = entries.reduce((total, entry) => total + entryUncompressedSize(entry), 0);
    if (declaredSize > MAX_TOTAL_SHADER_CHARACTERS * 4) throw new Error('Shader zip expands to too much data.');
    const entryMap = new Map();
    entries.forEach(entry => {
        const path = normalizePath(entry.name, 'Zip entry path');
        entryMap.set(path, entry);
    });
    const manifests = entries.filter(entry => /(^|\/)shading-shader\.json$/i.test(entry.name));
    if (manifests.length > 1) throw new Error('Shader zip must contain only one shading-shader.json.');

    if (!manifests.length) {
        const shaderEntries = entries.filter(entry => /\.glsl$/i.test(entry.name));
        if (!shaderEntries.length) throw new Error('Shader zip does not contain a .glsl file.');
        if (shaderEntries.length > MAX_BLOCKS) throw new Error(`Shader zip contains more than ${MAX_BLOCKS} GLSL files.`);
        const blocks = [];
        let totalCharacters = 0;
        const usedIds = new Set();
        for (let index = 0; index < shaderEntries.length; index++) {
            const entry = shaderEntries[index];
            const source = await readEntryText(entry, MAX_SHADER_CHARACTERS, entry.name);
            totalCharacters += source.length;
            if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) throw new Error('Shader package GLSL is too large.');
            let id = slug(entry.name.replace(/\.glsl$/i, ''));
            if (usedIds.has(id)) id = `${id.slice(0, 39)}-${hashText(entry.name).slice(0, 8)}`;
            usedIds.add(id);
            blocks.push({
                id,
                name: humanize(entry.name.split('/').pop()),
                text: humanize(entry.name.split('/').pop()),
                file: normalizePath(entry.name, 'GLSL file path'),
                source,
                inputs: []
            });
        }
        const baseName = String(archiveName || 'shader.zip').replace(/\.zip$/i, '');
        return normalizePackage({
            format: CUSTOM_SHADER_FORMAT,
            version: CUSTOM_SHADER_VERSION,
            id: `${slug(baseName).slice(0, 39)}-${hashText(blocks.map(block => block.file).join('|')).slice(0, 8)}`,
            name: humanize(baseName) || 'Imported shaders',
            blocks
        });
    }

    const manifestPath = normalizePath(manifests[0].name, 'Manifest path');
    const manifestRoot = dirname(manifestPath);
    const manifestText = await readEntryText(manifests[0], MAX_MANIFEST_CHARACTERS, manifestPath);
    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    } catch (error) {
        throw new Error(`Could not parse ${manifestPath}: ${error.message}`);
    }
    if (!manifest || !Array.isArray(manifest.blocks)) {
        throw new Error(`${manifestPath} must contain a blocks array.`);
    }
    const hydrated = Object.assign({}, manifest, {blocks: []});
    let totalCharacters = 0;
    for (const rawBlock of manifest.blocks) {
        const relativePath = normalizePath(rawBlock && rawBlock.file, 'Shader block file');
        const path = joinPath(manifestRoot, relativePath);
        const entry = entryMap.get(path);
        if (!entry) throw new Error(`Shader file not found in zip: ${relativePath}.`);
        const source = await readEntryText(entry, MAX_SHADER_CHARACTERS, relativePath);
        totalCharacters += source.length;
        if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) throw new Error('Shader package GLSL is too large.');
        hydrated.blocks.push(Object.assign({}, rawBlock, {file: relativePath, source}));
    }
    return normalizePackage(hydrated);
};

const argumentTypeForInput = input => {
    if (input.type === 'angle') return ArgumentType.ANGLE;
    if (input.type === 'boolean') return ArgumentType.BOOLEAN;
    if (input.type === 'color') return ArgumentType.COLOR;
    return input.type === 'menu' ? ArgumentType.STRING : ArgumentType.NUMBER;
};

const programNameFor = (packageId, blockId) => `custom:${packageId}:${blockId}`;
const opcodeFor = (packageId, blockId) => `shader_${packageId.replace(/-/g, '_')}_${blockId.replace(/-/g, '_')}`;
const menuNameFor = (packageId, blockId, inputId) => (
    `shader_${packageId.replace(/-/g, '_')}_${blockId.replace(/-/g, '_')}_${inputId.toLowerCase()}`
);

const readBlobAsArrayBuffer = blob => {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read shader zip.'));
        reader.readAsArrayBuffer(blob);
    });
};

class PenFXCustomShaderManager {
    constructor (vm, penFX) {
        this.vm = vm;
        this.penFX = penFX;
        this.packages = new Map();
        this.knownOpcodes = new Set();
        this.serializationInstalled = false;
        this.installSerializationHooks();
    }

    installSerializationHooks () {
        if (this.serializationInstalled || !this.vm || typeof this.vm.toJSON !== 'function' ||
            typeof this.vm.deserializeProject !== 'function') return;
        this.serializationInstalled = true;
        const originalToJSON = this.vm.toJSON.bind(this.vm);
        this.vm.toJSON = (targetId, serializationOptions) => {
            const project = JSON.parse(originalToJSON(targetId, serializationOptions));
            const packages = this.serializePackages();
            if (packages.length) project[CUSTOM_SHADER_PROJECT_KEY] = packages;
            else delete project[CUSTOM_SHADER_PROJECT_KEY];
            return JSON.stringify(markMovieProject(project));
        };
        const originalDeserializeProject = this.vm.deserializeProject.bind(this.vm);
        this.vm.deserializeProject = async (projectJSON, zip) => {
            await this.restorePackages(projectJSON && projectJSON[CUSTOM_SHADER_PROJECT_KEY]);
            return originalDeserializeProject(projectJSON, zip);
        };
    }

    serializePackages () {
        return Array.from(this.packages.values(), packageDescriptor => cloneJSON(packageDescriptor));
    }

    getToolboxBlocks () {
        const blocks = [
            {blockType: BlockType.LABEL, text: 'Custom Shaders'},
            {blockType: BlockType.BUTTON, text: 'Import shader', func: 'importShaderPackage'}
        ];
        for (const packageDescriptor of this.packages.values()) {
            blocks.push('---');
            blocks.push({blockType: BlockType.LABEL, text: packageDescriptor.name});
            for (const shaderBlock of packageDescriptor.blocks) {
                const argumentsInfo = {};
                for (const input of shaderBlock.inputs) {
                    argumentsInfo[input.id] = {
                        type: argumentTypeForInput(input),
                        defaultValue: input.defaultValue
                    };
                    if (input.type === 'menu') {
                        argumentsInfo[input.id].menu = menuNameFor(
                            packageDescriptor.id,
                            shaderBlock.id,
                            input.id
                        );
                    }
                }
                const opcode = opcodeFor(packageDescriptor.id, shaderBlock.id);
                blocks.push({
                    opcode,
                    func: opcode,
                    blockType: BlockType.COMMAND,
                    text: shaderBlock.text,
                    arguments: argumentsInfo
                });
            }
        }
        blocks.push('---');
        return blocks;
    }

    getMenus () {
        const menus = {};
        for (const packageDescriptor of this.packages.values()) {
            for (const shaderBlock of packageDescriptor.blocks) {
                for (const input of shaderBlock.inputs) {
                    if (input.type !== 'menu') continue;
                    menus[menuNameFor(packageDescriptor.id, shaderBlock.id, input.id)] = {
                        acceptReporters: true,
                        items: input.items.slice()
                    };
                }
            }
        }
        return menus;
    }

    installIntoEngine (engine) {
        for (const packageDescriptor of this.packages.values()) {
            for (const shaderBlock of packageDescriptor.blocks) {
                engine.registerCustomShader(
                    programNameFor(packageDescriptor.id, shaderBlock.id),
                    shaderBlock.source
                );
            }
        }
    }

    _bindPackage (packageDescriptor) {
        for (const shaderBlock of packageDescriptor.blocks) {
            const opcode = opcodeFor(packageDescriptor.id, shaderBlock.id);
            const programName = programNameFor(packageDescriptor.id, shaderBlock.id);
            this.knownOpcodes.add(opcode);
            this.penFX[opcode] = args => {
                const uniforms = {
                    u_resolution: [0, 0],
                    u_time: this._timelineTime(),
                    u_frame: this._timelineFrame()
                };
                const integerUniforms = ['u_frame'];
                for (const input of shaderBlock.inputs) {
                    const value = args && args[input.id] === undefined ? input.defaultValue : args[input.id];
                    if (input.type === 'color') {
                        uniforms[input.uniform] = color(value);
                    } else if (input.type === 'boolean') {
                        uniforms[input.uniform] = boolean(value) ? 1 : 0;
                        integerUniforms.push(input.uniform);
                    } else if (input.type === 'menu') {
                        uniforms[input.uniform] = Math.max(0, input.items.indexOf(String(value)));
                        integerUniforms.push(input.uniform);
                    } else {
                        let numericValue = (number(value) * input.scale) + input.offset;
                        if (input.type === 'integer') {
                            numericValue = Math.round(numericValue);
                            integerUniforms.push(input.uniform);
                        }
                        uniforms[input.uniform] = numericValue;
                    }
                }
                this.penFX._safe(engine => engine.customShader(
                    programName,
                    uniforms,
                    integerUniforms,
                    this.penFX.blendMode
                ));
            };
            if (this.penFX.engine) this.penFX.engine.registerCustomShader(programName, shaderBlock.source);
        }
    }

    _replacePackages (packages) {
        if (this.penFX.engine) {
            for (const packageDescriptor of this.packages.values()) {
                for (const shaderBlock of packageDescriptor.blocks) {
                    this.penFX.engine.unregisterCustomShader(programNameFor(packageDescriptor.id, shaderBlock.id));
                }
            }
        }
        for (const opcode of this.knownOpcodes) this.penFX[opcode] = () => undefined;
        this.packages.clear();
        packages.forEach(packageDescriptor => {
            this.packages.set(packageDescriptor.id, packageDescriptor);
            this._bindPackage(packageDescriptor);
        });
    }

    _timelineTime () {
        const timeline = this.vm && this.vm.runtime && this.vm.runtime.movieAssetManager &&
            this.vm.runtime.movieAssetManager.timeline;
        const currentTime = timeline && Number(timeline.currentTime);
        return Number.isFinite(currentTime) ? currentTime : 0;
    }

    _timelineFrame () {
        const timeline = this.vm && this.vm.runtime && this.vm.runtime.movieAssetManager &&
            this.vm.runtime.movieAssetManager.timeline;
        const frameRate = timeline && Number(timeline.framerate);
        return Math.round(this._timelineTime() * (Number.isFinite(frameRate) ? frameRate : 30));
    }

    async _refreshBlocks () {
        const extensionManager = this.vm && this.vm.extensionManager;
        if (!extensionManager || typeof extensionManager.refreshBlocks !== 'function') return;
        if (typeof extensionManager.isExtensionLoaded === 'function' && !extensionManager.isExtensionLoaded('penfx')) {
            return;
        }
        await extensionManager.refreshBlocks('penfx');
    }

    async restorePackages (serializedPackages) {
        const packages = [];
        if (Array.isArray(serializedPackages)) {
            for (const descriptor of serializedPackages) {
                try {
                    packages.push(normalizePackage(descriptor));
                } catch (error) {
                    console.error('[Pen FX] Could not restore custom shader package:', error);
                }
            }
        }
        this._replacePackages(packages);
        await this._refreshBlocks();
    }

    async importZip (data, archiveName) {
        const packageDescriptor = await parseShaderZip(data, archiveName);
        const engine = this.penFX._getEngine();
        for (const shaderBlock of packageDescriptor.blocks) {
            try {
                engine.validateCustomShader(shaderBlock.source);
            } catch (error) {
                throw new Error(`${shaderBlock.file}: ${error.message}`);
            }
        }
        const packages = Array.from(this.packages.values()).filter(existing => existing.id !== packageDescriptor.id);
        packages.push(packageDescriptor);
        this._replacePackages(packages);
        await this._refreshBlocks();
        if (this.vm && this.vm.runtime && typeof this.vm.runtime.emitProjectChanged === 'function') {
            this.vm.runtime.emitProjectChanged();
        }
        return packageDescriptor;
    }

    openImportPicker () {
        if (typeof document === 'undefined' || !document.body) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip,application/x-zip-compressed';
        input.hidden = true;
        const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            cleanup();
            if (!file) return;
            readBlobAsArrayBuffer(file)
                .then(data => this.importZip(data, file.name))
                .catch(error => {
                    console.error('[Pen FX] Shader import failed:', error);
                    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                        window.alert(`Shader import failed.\n\n${error.message}`);
                    }
                });
        }, {once: true});
        document.body.appendChild(input);
        input.click();
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', () => setTimeout(cleanup, 0), {once: true});
        }
    }
}

export {
    CUSTOM_SHADER_FORMAT,
    CUSTOM_SHADER_PROJECT_KEY,
    CUSTOM_SHADER_VERSION,
    PenFXCustomShaderManager,
    normalizePackage,
    opcodeFor,
    parseShaderZip,
    programNameFor
};
export default PenFXCustomShaderManager;
