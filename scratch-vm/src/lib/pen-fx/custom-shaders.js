/* eslint-disable */

import JSZip from '@turbowarp/jszip';
import EventEmitter from 'events';
import ArgumentType from '../../extension-support/argument-type';
import BlockType from '../../extension-support/block-type';

import {boolean, color, number} from './helpers';
import {BLEND_MODES} from './constants';
import {markMovieProject} from '../project-format';
import {inferShaderInputs} from './shader-uniforms';
import {localize, resolveLocale} from '../movie-block-l10n';
import {programSources as coreProgramSources} from 'scratch-render/src/pen-fx/shaders';
import {getRegisteredProgramNames} from 'scratch-render/src/pen-fx/engine';

const CUSTOM_SHADER_PROJECT_KEY = 'penFXShaders';
const CUSTOM_SHADER_FORMAT = 'shading.app/penfx-shader';
const CUSTOM_SHADER_VERSION = 2;
// Effects that used to ship with the app kept their menus under this package id. Plugin packages that restore
// those blocks register with it as their menu namespace so saved projects keep their menu opcodes.
const DEFAULT_SHADER_PACKAGE_ID = 'penfx-builtins';
const CORE_PACKAGE_ID = 'penfx-core';
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 128;
const MAX_MANIFEST_CHARACTERS = 256 * 1024;
const MAX_SHADER_CHARACTERS = 512 * 1024;
const MAX_TOTAL_SHADER_CHARACTERS = 4 * 1024 * 1024;
const MAX_BLOCKS = 64;
const MAX_INPUTS = 24;
// Plugin packages come from code the user already chose to run, so they may be larger than an imported zip.
const MAX_PLUGIN_BLOCKS = 4096;
const MAX_PLUGIN_INPUTS = 128;
const MAX_PROGRAMS = 64;
const STANDARD_UNIFORMS = new Set(['u_image', 'u_resolution', 'u_time', 'u_frame']);
const INPUT_TYPES = new Set(['angle', 'boolean', 'color', 'costume', 'integer', 'menu', 'number', 'string']);
const BLOCK_TYPES = new Set(['command', 'reporter']);
// Menus that projects saved by old versions reference directly. Effect plugins register their own legacy menus.
const CORE_LEGACY_MENUS = {
    boolean: ['false', 'true'],
    blendMode: BLEND_MODES
};

// The blend mode block is part of the core Looks category; every effect honours it.
const CORE_PACKAGE = {
    format: 'shading.app/penfx-shader',
    version: 2,
    id: CORE_PACKAGE_ID,
    name: 'Blending',
    blocks: [{
        id: 'set-blend-mode',
        name: 'setBlendMode',
        text: 'use [TYPE] blending mode opacity: [OPACITY] %',
        opcode: 'setBlendMode',
        blockType: 'command',
        implementation: {type: 'penfx', opcode: 'setBlendMode'},
        inputs: [
            {id: 'TYPE', label: 'type', type: 'menu', items: BLEND_MODES.slice(), defaultValue: 'normal'},
            {id: 'OPACITY', label: 'opacity', type: 'number', defaultValue: 100}
        ]
    }]
};
const CORE_TRANSLATIONS = {
    ja: {
        'set-blend-mode': {
            name: 'ブレンド',
            text: 'ブレンド [TYPE] 不透明度: [OPACITY] %',
            labels: {TYPE: '種類', OPACITY: '不透明度'}
        }
    }
};

const localizeShaderBlock = (packageDescriptor, shaderBlock, locale) => {
    const translations = packageDescriptor.translations && packageDescriptor.translations[locale];
    const translation = translations && translations[shaderBlock.id];
    if (!translation) return shaderBlock;
    return Object.assign({}, shaderBlock, {
        name: translation.name || shaderBlock.name,
        text: translation.text || shaderBlock.text,
        inputs: shaderBlock.inputs.map(input => Object.assign({}, input, {
            label: translation.labels && translation.labels[input.id] || input.label
        }))
    });
};

const bindableProgramNames = () => new Set(Object.keys(coreProgramSources).concat(getRegisteredProgramNames()));
const DEFAULT_SHADER_SOURCE = `precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_frame;

void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    gl_FragColor = pixel;
}
`;

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

const normalizeInput = (rawInput, blockLabel, shaderInput = true, trusted = false) => {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
        throw new Error(`${blockLabel} has an invalid input.`);
    }
    const id = assertString(rawInput.id, `${blockLabel} input id`, 32).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(id)) {
        throw new Error(`${blockLabel} input id ${id} must use A-Z, 0-9, and underscores.`);
    }
    const type = String(rawInput.type || 'number').toLowerCase();
    if (!INPUT_TYPES.has(type)) throw new Error(`${blockLabel} input ${id} has unsupported type ${type}.`);
    if (shaderInput && (type === 'string' || type === 'costume')) {
        throw new Error(`${blockLabel} input ${id} type ${type} requires a PenFX implementation.`);
    }
    const label = assertString(rawInput.label || humanize(id), `${blockLabel} input ${id} label`, 48);
    const result = {
        id,
        label,
        type
    };
    if (shaderInput) {
        const uniform = assertString(
            rawInput.uniform || `u_${id.toLowerCase()}`,
            `${blockLabel} input ${id} uniform`,
            64
        );
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(uniform) || STANDARD_UNIFORMS.has(uniform)) {
            throw new Error(`${blockLabel} input ${id} has invalid or reserved uniform ${uniform}.`);
        }
        result.uniform = uniform;
        if (rawInput.uniformType !== undefined) {
            result.uniformType = assertString(
                rawInput.uniformType,
                `${blockLabel} input ${id} uniform type`,
                16
            );
        }
        if (rawInput.component !== undefined || rawInput.vectorSize !== undefined) {
            const component = Number(rawInput.component);
            const vectorSize = Number(rawInput.vectorSize);
            if (!Number.isInteger(vectorSize) || vectorSize < 2 || vectorSize > 4 ||
                !Number.isInteger(component) || component < 0 || component >= vectorSize) {
                throw new Error(`${blockLabel} input ${id} has invalid vector component metadata.`);
            }
            result.component = component;
            result.vectorSize = vectorSize;
        }
    }
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
    } else if (type === 'string' || type === 'costume') {
        result.defaultValue = rawInput.defaultValue === undefined ? '' : String(rawInput.defaultValue);
        // A plugin can attach one of its own dynamic menus (for example a list of project assets).
        if (trusted && type === 'string' && rawInput.menu !== undefined) {
            const menu = assertString(rawInput.menu, `${blockLabel} input ${id} menu`, 64);
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(menu)) throw new Error(`${blockLabel} input ${id} menu is invalid.`);
            result.menu = menu;
        }
    } else {
        result.defaultValue = normalizeNumber(rawInput.defaultValue, 0, `${blockLabel} input ${id} defaultValue`);
        if (shaderInput) {
            result.scale = normalizeNumber(rawInput.scale, 1, `${blockLabel} input ${id} scale`);
            result.offset = normalizeNumber(rawInput.offset, 0, `${blockLabel} input ${id} offset`);
        }
    }
    return result;
};

const normalizeBlock = (rawBlock, source, usedIds, trusted = false) => {
    if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
        throw new Error('Each shader block must be an object.');
    }
    const id = normalizeId(rawBlock.id, 'Shader block id');
    if (usedIds.has(id)) throw new Error(`Duplicate shader block id: ${id}.`);
    usedIds.add(id);
    const name = assertString(rawBlock.name || humanize(id), `Shader block ${id} name`, 64);
    let implementation = null;
    if (rawBlock.implementation != null) {
        if (!rawBlock.implementation || typeof rawBlock.implementation !== 'object' ||
            Array.isArray(rawBlock.implementation) || rawBlock.implementation.type !== 'penfx') {
            throw new Error(`Shader block ${id} has an invalid implementation.`);
        }
        const implementationOpcode = assertString(
            rawBlock.implementation.opcode,
            `Shader block ${id} implementation opcode`,
            64
        );
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(implementationOpcode)) {
            throw new Error(`Shader block ${id} implementation opcode is invalid.`);
        }
        implementation = {type: 'penfx', opcode: implementationOpcode};
    }
    let file = null;
    if (!implementation || rawBlock.file != null) {
        file = normalizePath(rawBlock.file || `${id}.glsl`, `Shader block ${id} file`);
        if (!/\.glsl$/i.test(file)) throw new Error(`Shader block ${id} file must end in .glsl.`);
    }
    const inputs = rawBlock.inputs === undefined ? [] : rawBlock.inputs;
    const maxInputs = trusted ? MAX_PLUGIN_INPUTS : MAX_INPUTS;
    if (!Array.isArray(inputs) || inputs.length > maxInputs) {
        throw new Error(`Shader block ${id} must define no more than ${maxInputs} inputs.`);
    }
    const normalizedInputs = inputs.map(input => normalizeInput(input, `Shader block ${id}`, !implementation, trusted));
    if (new Set(normalizedInputs.map(input => input.id)).size !== normalizedInputs.length) {
        throw new Error(`Shader block ${id} input ids must be unique.`);
    }
    if (!implementation) {
        const uniformInputs = new Map();
        for (const input of normalizedInputs) {
            const componentKey = input.component === undefined ? 'scalar' : String(input.component);
            if (!uniformInputs.has(input.uniform)) uniformInputs.set(input.uniform, new Set());
            const components = uniformInputs.get(input.uniform);
            if (components.has(componentKey) || (componentKey === 'scalar' && components.size) ||
                (componentKey !== 'scalar' && components.has('scalar'))) {
                throw new Error(`Shader block ${id} uniform inputs must be unique.`);
            }
            components.add(componentKey);
        }
    }
    const generatedText = [name].concat(normalizedInputs.map(input => `${input.label}: [${input.id}]`)).join(' ');
    const text = assertString(rawBlock.text || generatedText, `Shader block ${id} text`,
        trusted ? 8192 : 1024);
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
    let fragmentSource = null;
    if (!implementation || source != null) {
        fragmentSource = assertString(source, `Shader block ${id} GLSL`, MAX_SHADER_CHARACTERS);
        if (fragmentSource.indexOf('\0') !== -1) throw new Error(`Shader block ${id} GLSL contains a null byte.`);
        if (!/\bvoid\s+main\s*\(/.test(fragmentSource)) {
            throw new Error(`Shader block ${id} GLSL must define void main().`);
        }
    }
    const blockType = String(rawBlock.blockType || 'command').toLowerCase();
    if (!BLOCK_TYPES.has(blockType) || (!implementation && blockType !== 'command')) {
        throw new Error(`Shader block ${id} has unsupported block type ${blockType}.`);
    }
    let groupEffectScope = null;
    if (rawBlock.groupEffectScope !== undefined && rawBlock.groupEffectScope !== null) {
        groupEffectScope = String(rawBlock.groupEffectScope).toLowerCase();
        if (groupEffectScope !== 'expanded') {
            throw new Error(`Shader block ${id} has unsupported groupEffectScope ${rawBlock.groupEffectScope}.`);
        }
    }
    const opcode = rawBlock.opcode == null ? null : assertString(rawBlock.opcode, `Shader block ${id} opcode`, 64);
    if (opcode && (!implementation || !/^[A-Za-z][A-Za-z0-9]*$/.test(opcode))) {
        throw new Error(`Shader block ${id} has an invalid compatibility opcode.`);
    }
    const normalizedBlock = {
        id,
        name,
        text,
        file,
        source: fragmentSource === null ? null : fragmentSource.replace(/\r\n?/g, '\n'),
        inputs: normalizedInputs,
        implementation,
        opcode,
        blockType,
        separatorBefore: rawBlock.separatorBefore === true,
        editorManaged: rawBlock.editorManaged === true,
        autoInputs: rawBlock.autoInputs === true
    };
    if (groupEffectScope) normalizedBlock.groupEffectScope = groupEffectScope;
    return normalizedBlock;
};

const normalizeProgram = (rawProgram, source, usedIds) => {
    if (!rawProgram || typeof rawProgram !== 'object' || Array.isArray(rawProgram)) {
        throw new Error('Each shader program must be an object.');
    }
    const id = normalizeId(rawProgram.id, 'Shader program id');
    if (usedIds.has(id)) throw new Error(`Duplicate shader program id: ${id}.`);
    usedIds.add(id);
    const file = normalizePath(rawProgram.file || `${id}.glsl`, `Shader program ${id} file`);
    if (!/\.glsl$/i.test(file)) throw new Error(`Shader program ${id} file must end in .glsl.`);
    const fragmentSource = assertString(source, `Shader program ${id} GLSL`, MAX_SHADER_CHARACTERS);
    if (fragmentSource.indexOf('\0') !== -1 || !/\bvoid\s+main\s*\(/.test(fragmentSource)) {
        throw new Error(`Shader program ${id} must contain a valid fragment shader with void main().`);
    }
    let bind = null;
    if (rawProgram.bind != null) {
        bind = assertString(rawProgram.bind, `Shader program ${id} bind`, 64);
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(bind) || !bindableProgramNames().has(bind)) {
            throw new Error(`Shader program ${id} cannot bind to ${bind}.`);
        }
    }
    return {id, file, source: fragmentSource.replace(/\r\n?/g, '\n'), bind};
};

/**
 * Validate a PenFX shader package.
 * @param {object} rawPackage Package descriptor (manifest with inline sources).
 * @param {object} [options] Options.
 * @param {boolean} [options.trusted] Package registered by an installed plugin: larger limits and compatibility
 * opcodes are allowed. Imported zips and project data are never trusted.
 * @returns {object} Normalized descriptor.
 */
const normalizePackage = (rawPackage, options = {}) => {
    const trusted = options.trusted === true;
    if (!rawPackage || typeof rawPackage !== 'object' || Array.isArray(rawPackage)) {
        throw new Error('Shader package descriptor must be an object.');
    }
    if (rawPackage.format !== CUSTOM_SHADER_FORMAT) {
        throw new Error(`Shader package format must be ${CUSTOM_SHADER_FORMAT}.`);
    }
    const version = Number(rawPackage.version);
    if (version !== 1 && version !== CUSTOM_SHADER_VERSION) {
        throw new Error(`Unsupported shader package version: ${rawPackage.version}.`);
    }
    const id = normalizeId(rawPackage.id, 'Shader package id');
    const name = assertString(rawPackage.name || humanize(id), 'Shader package name', 64);
    const maxBlocks = trusted ? MAX_PLUGIN_BLOCKS : MAX_BLOCKS;
    if (!Array.isArray(rawPackage.blocks) || rawPackage.blocks.length < 1 || rawPackage.blocks.length > maxBlocks) {
        throw new Error(`Shader package must define 1 to ${maxBlocks} blocks.`);
    }
    const usedIds = new Set();
    const blocks = rawPackage.blocks.map(rawBlock => normalizeBlock(rawBlock, rawBlock.source, usedIds, trusted));
    const rawPrograms = rawPackage.programs === undefined ? [] : rawPackage.programs;
    if (!Array.isArray(rawPrograms) || rawPrograms.length > MAX_PROGRAMS || (version === 1 && rawPrograms.length)) {
        throw new Error(`Shader package must define no more than ${MAX_PROGRAMS} programs.`);
    }
    const usedProgramIds = new Set();
    const programs = rawPrograms.map(rawProgram => normalizeProgram(
        rawProgram,
        rawProgram.source,
        usedProgramIds
    ));
    if (version === 1 && blocks.some(block => block.implementation)) {
        throw new Error('Shader package version 1 does not support implementations.');
    }
    // Implementations are provided by plugins; availability is checked when the package is bound.
    if (!trusted && blocks.some(block => block.opcode)) {
        throw new Error('Compatibility opcodes are reserved for packages registered by plugins.');
    }
    if (!trusted && (id === DEFAULT_SHADER_PACKAGE_ID || id === CORE_PACKAGE_ID)) {
        throw new Error(`${id} is reserved for shading.app.`);
    }
    const totalCharacters = blocks.reduce((total, block) => total + (block.source || '').length, 0) +
        programs.reduce((total, program) => total + program.source.length, 0);
    if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) {
        throw new Error('Shader package GLSL is too large.');
    }
    return {
        format: CUSTOM_SHADER_FORMAT,
        version,
        id,
        name,
        programs,
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
                file: normalizePath(entry.name, 'GLSL file path'),
                source,
                inputs: inferShaderInputs(source, MAX_INPUTS),
                editorManaged: true,
                autoInputs: true
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
    const hydrated = Object.assign({}, manifest, {blocks: [], programs: []});
    let totalCharacters = 0;
    for (const rawBlock of manifest.blocks) {
        if (rawBlock && rawBlock.implementation && rawBlock.file === undefined) {
            hydrated.blocks.push(Object.assign({}, rawBlock));
        } else {
            const relativePath = normalizePath(rawBlock && rawBlock.file, 'Shader block file');
            const path = joinPath(manifestRoot, relativePath);
            const entry = entryMap.get(path);
            if (!entry) throw new Error(`Shader file not found in zip: ${relativePath}.`);
            const source = await readEntryText(entry, MAX_SHADER_CHARACTERS, relativePath);
            totalCharacters += source.length;
            if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) throw new Error('Shader package GLSL is too large.');
            hydrated.blocks.push(Object.assign({}, rawBlock, {file: relativePath, source}));
        }
    }
    const manifestPrograms = manifest.programs === undefined ? [] : manifest.programs;
    if (!Array.isArray(manifestPrograms)) throw new Error(`${manifestPath} programs must be an array.`);
    for (const rawProgram of manifestPrograms) {
        const relativePath = normalizePath(rawProgram && rawProgram.file, 'Shader program file');
        const path = joinPath(manifestRoot, relativePath);
        const entry = entryMap.get(path);
        if (!entry) throw new Error(`Shader file not found in zip: ${relativePath}.`);
        const source = await readEntryText(entry, MAX_SHADER_CHARACTERS, relativePath);
        totalCharacters += source.length;
        if (totalCharacters > MAX_TOTAL_SHADER_CHARACTERS) throw new Error('Shader package GLSL is too large.');
        hydrated.programs.push(Object.assign({}, rawProgram, {file: relativePath, source}));
    }
    return normalizePackage(hydrated);
};

const argumentTypeForInput = input => {
    if (input.type === 'angle') return ArgumentType.ANGLE;
    if (input.type === 'boolean') return ArgumentType.BOOLEAN;
    if (input.type === 'color') return ArgumentType.COLOR;
    if (input.type === 'costume') return ArgumentType.COSTUME;
    if (input.type === 'string') return ArgumentType.STRING;
    return input.type === 'menu' ? ArgumentType.STRING : ArgumentType.NUMBER;
};

const programNameFor = (packageId, blockId) => `custom:${packageId}:${blockId}`;
const opcodeFor = (packageId, blockId, compatibilityOpcode) => compatibilityOpcode ||
    `shader_${packageId.replace(/-/g, '_')}_${blockId.replace(/-/g, '_')}`;
const deleteFunctionFor = packageId => `deleteShaderPackage_${packageId.replace(/-/g, '_')}`;
const programNameForDescriptor = (packageDescriptor, program) =>
    `custom:${packageDescriptor.id}:program:${program.id}`;
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

const readBlobAsText = blob => {
    if (blob && typeof blob.text === 'function') return blob.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read shader file.'));
        reader.readAsText(blob);
    });
};

const resolveLabel = (label, locale, fallback) => {
    if (typeof label === 'function') return String(label(locale) || fallback);
    if (label && typeof label === 'object') return String(label[locale] || label.en || fallback);
    return String(label || fallback);
};

const callWithLocale = (value, locale, fallback) => {
    if (typeof value === 'function') return value(locale) || fallback;
    return value || fallback;
};

const compareSections = (a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

class PenFXCustomShaderManager extends EventEmitter {
    constructor (vm, penFX) {
        super();
        this.vm = vm;
        this.penFX = penFX;
        // Every bound package: plugin packages first (in toolbox order), then the project's custom packages.
        this.packages = new Map();
        this.pluginPackages = new Map();
        this.contributions = new Map();
        // Project packages whose PenFX implementation comes from a plugin that is not installed. They are kept
        // verbatim so saving the project does not drop them, and bind as soon as the plugin is installed.
        this.unavailablePackages = [];
        this.knownOpcodes = new Set();
        this.deleteFunctionNames = new Set();
        this.opcodeWrappers = new WeakSet();
        this.programOverrideStates = new Map();
        this.serializationInstalled = false;
        this.refreshPromise = null;
        this.installSerializationHooks();
        this._registerCorePackage();
    }

    _registerCorePackage () {
        const descriptor = normalizePackage(CORE_PACKAGE, {trusted: true});
        Object.assign(descriptor, {
            isPlugin: true,
            isCore: true,
            order: Number.MAX_SAFE_INTEGER,
            menuNamespace: DEFAULT_SHADER_PACKAGE_ID,
            translations: CORE_TRANSLATIONS,
            legacyMenus: {}
        });
        this.pluginPackages.set(descriptor.id, descriptor);
        this._rebind();
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
            this.emit('projectLoading');
            return originalDeserializeProject(projectJSON, zip);
        };
    }

    serializePackages () {
        return this._customPackages()
            .map(packageDescriptor => cloneJSON(packageDescriptor))
            .concat(this.unavailablePackages.map(cloneJSON));
    }

    _customPackages () {
        return Array.from(this.packages.values()).filter(packageDescriptor => !packageDescriptor.isPlugin);
    }

    _sortedPluginPackages () {
        return Array.from(this.pluginPackages.values()).sort(compareSections);
    }

    _implementationFor (implementationOpcode) {
        // Plugins install implementations on the PenFX prototype; opcode wrappers live on the instance and may
        // share the implementation's name (compatibility opcodes), so they are never treated as implementations.
        const prototype = Object.getPrototypeOf(this.penFX);
        const inherited = prototype && prototype[implementationOpcode];
        if (typeof inherited === 'function' && !this.opcodeWrappers.has(inherited)) return inherited;
        const own = this.penFX[implementationOpcode];
        if (typeof own === 'function' && !this.opcodeWrappers.has(own)) return own;
        return null;
    }

    _missingImplementations (packageDescriptor) {
        return packageDescriptor.blocks
            .filter(block => block.implementation && !this._implementationFor(block.implementation.opcode))
            .map(block => block.implementation.opcode);
    }

    _assertImplementations (packageDescriptor) {
        const missing = this._missingImplementations(packageDescriptor);
        if (missing.length) {
            throw new Error(`PenFX implementation not found: ${missing.join(', ')}. ` +
                'Install the plugin that provides it.');
        }
    }

    // Bind plugin packages and every custom package whose implementations exist.
    _rebind (customPackages = this._customPackages()) {
        const available = [];
        const unavailable = [];
        for (const packageDescriptor of customPackages) {
            if (this._missingImplementations(packageDescriptor).length) unavailable.push(cloneJSON(packageDescriptor));
            else available.push(packageDescriptor);
        }
        for (const rawPackage of this.unavailablePackages) {
            try {
                const packageDescriptor = normalizePackage(rawPackage);
                if (this._missingImplementations(packageDescriptor).length) unavailable.push(rawPackage);
                else available.push(packageDescriptor);
            } catch (error) {
                unavailable.push(rawPackage);
            }
        }
        this.unavailablePackages = unavailable;
        this._replacePackages(this._sortedPluginPackages().concat(available));
    }

    /**
     * Add a PenFX block package provided by a plugin. Its blocks join the Looks category and are not saved into
     * projects; projects only reference the blocks by opcode.
     * @param {object} rawPackage shading.app/penfx-shader package (implementation blocks may use compatibility
     * opcodes, and string inputs may name a plugin menu).
     * @param {object} [options] Registration options.
     * @param {string} [options.pluginId] Owning plugin.
     * @param {number} [options.order] Toolbox position; lower comes first.
     * @param {string|object|Function} [options.label] Toolbox label; defaults to the package name.
     * @param {string} [options.menuNamespace] Package id used for menu names (keeps legacy menu opcodes).
     * @param {object} [options.translations] {locale: {blockId: {name, text, labels}}}.
     * @param {object} [options.legacyMenus] Extra static menus {name: items}.
     * @param {object|Function} [options.menus] Extra menus {name: menuInfo} or (locale) => menus.
     * @param {Array|Function} [options.before] Raw toolbox entries shown before the package blocks.
     * @param {Array|Function} [options.after] Raw toolbox entries shown after the package blocks.
     * @returns {Function} Disposer.
     */
    registerPluginPackage (rawPackage, options = {}) {
        const packageDescriptor = normalizePackage(rawPackage, {trusted: true});
        const id = packageDescriptor.id;
        if (this.pluginPackages.has(id) || this.contributions.has(id)) {
            throw new Error(`PenFX package ${id} is already registered.`);
        }
        if (this._customPackages().some(existing => existing.id === id)) {
            throw new Error(`PenFX package ${id} conflicts with a custom shader package in this project.`);
        }
        const namespace = options.menuNamespace ? normalizeId(options.menuNamespace, 'Menu namespace') : id;
        const opcodes = new Set(this._pluginOpcodes());
        for (const shaderBlock of packageDescriptor.blocks) {
            const opcode = opcodeFor(id, shaderBlock.id, shaderBlock.opcode);
            if (opcodes.has(opcode)) throw new Error(`PenFX opcode ${opcode} is already registered.`);
            opcodes.add(opcode);
        }
        Object.assign(packageDescriptor, {
            isPlugin: true,
            pluginId: options.pluginId || null,
            order: Number.isFinite(Number(options.order)) ? Number(options.order) : 1000,
            label: options.label || null,
            menuNamespace: namespace,
            translations: options.translations || {},
            legacyMenus: options.legacyMenus || {},
            menus: options.menus || null,
            before: options.before || null,
            after: options.after || null
        });
        this._assertImplementations(packageDescriptor);
        this.pluginPackages.set(id, packageDescriptor);
        this._rebind();
        this._scheduleRefresh();
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            if (this.pluginPackages.get(id) !== packageDescriptor) return;
            this.pluginPackages.delete(id);
            this._rebind();
            this._scheduleRefresh();
        };
    }

    /**
     * Add raw extension blocks to the Looks category. Their functions must exist on the PenFX instance.
     * @param {object} contribution Contribution.
     * @param {string} contribution.id Unique id.
     * @param {number} [contribution.order] Toolbox position.
     * @param {string|object|Function} [contribution.label] Section label.
     * @param {Array|Function} contribution.blocks Toolbox entries or (locale) => entries.
     * @param {object|Function} [contribution.menus] Menus or (locale) => menus.
     * @returns {Function} Disposer.
     */
    addToolboxContribution (contribution) {
        const id = normalizeId(contribution && contribution.id, 'Toolbox contribution id');
        if (this.contributions.has(id) || this.pluginPackages.has(id)) {
            throw new Error(`PenFX toolbox section ${id} is already registered.`);
        }
        const entry = {
            id,
            order: Number.isFinite(Number(contribution.order)) ? Number(contribution.order) : 1000,
            label: contribution.label || null,
            blocks: contribution.blocks || [],
            menus: contribution.menus || null
        };
        this.contributions.set(id, entry);
        this._scheduleRefresh();
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            if (this.contributions.get(id) !== entry) return;
            this.contributions.delete(id);
            this._scheduleRefresh();
        };
    }

    _pluginOpcodes () {
        const opcodes = [];
        for (const packageDescriptor of this.pluginPackages.values()) {
            for (const shaderBlock of packageDescriptor.blocks) {
                opcodes.push(opcodeFor(packageDescriptor.id, shaderBlock.id, shaderBlock.opcode));
            }
        }
        return opcodes;
    }

    /**
     * Opcodes (without the `penfx_` prefix) currently provided by each plugin.
     * @returns {Map<string, Set<string>>} pluginId -> opcodes.
     */
    getPluginOpcodes () {
        const result = new Map();
        for (const packageDescriptor of this.pluginPackages.values()) {
            if (!packageDescriptor.pluginId) continue;
            if (!result.has(packageDescriptor.pluginId)) result.set(packageDescriptor.pluginId, new Set());
            const opcodes = result.get(packageDescriptor.pluginId);
            for (const shaderBlock of packageDescriptor.blocks) {
                opcodes.add(opcodeFor(packageDescriptor.id, shaderBlock.id, shaderBlock.opcode));
            }
        }
        return result;
    }

    getShaders () {
        const shaders = [];
        for (const packageDescriptor of this._customPackages()) {
            for (const shaderBlock of packageDescriptor.blocks) {
                if (!shaderBlock.source || shaderBlock.implementation) continue;
                shaders.push({
                    key: `${packageDescriptor.id}:${shaderBlock.id}`,
                    packageId: packageDescriptor.id,
                    blockId: shaderBlock.id,
                    packageName: packageDescriptor.name,
                    name: shaderBlock.name,
                    file: shaderBlock.file,
                    source: shaderBlock.source,
                    inputs: cloneJSON(shaderBlock.inputs),
                    autoInputs: shaderBlock.autoInputs === true,
                    editorManaged: shaderBlock.editorManaged === true
                });
            }
        }
        return shaders;
    }

    getShader (key) {
        return this.getShaders().find(shader => shader.key === key) || null;
    }

    _findShaderBlock (packages, key) {
        const separator = String(key || '').indexOf(':');
        if (separator < 1) return null;
        const packageId = key.slice(0, separator);
        const blockId = key.slice(separator + 1);
        const packageIndex = packages.findIndex(packageDescriptor => packageDescriptor.id === packageId);
        if (packageIndex < 0) return null;
        const blockIndex = packages[packageIndex].blocks.findIndex(shaderBlock => shaderBlock.id === blockId);
        if (blockIndex < 0) return null;
        return {packageIndex, blockIndex};
    }

    _nextPackageId (name) {
        const base = slug(name);
        let id = base;
        let suffix = 2;
        while (this.packages.has(id) || this.pluginPackages.has(id) || id === DEFAULT_SHADER_PACKAGE_ID ||
            id === CORE_PACKAGE_ID) {
            const suffixText = `-${suffix++}`;
            id = `${base.slice(0, 48 - suffixText.length)}${suffixText}`;
        }
        return id;
    }

    _nextShaderName (requestedName) {
        const base = assertString(requestedName, 'Shader name', 64);
        const existingNames = new Set(this.getShaders().map(shader => shader.name.toLowerCase()));
        if (!existingNames.has(base.toLowerCase())) return base;
        let suffix = 2;
        let candidate;
        do {
            const suffixText = ` ${suffix++}`;
            candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
        } while (existingNames.has(candidate.toLowerCase()));
        return candidate;
    }

    async _commitCustomPackages (customPackages) {
        this._rebind(customPackages);
        await this._refreshBlocks();
        if (this.vm && this.vm.runtime && typeof this.vm.runtime.emitProjectChanged === 'function') {
            this.vm.runtime.emitProjectChanged();
        }
    }

    async createShader (options = {}) {
        const name = this._nextShaderName(options.name || 'Shader');
        const source = String(options.source === undefined ? DEFAULT_SHADER_SOURCE : options.source)
            .replace(/\r\n?/g, '\n');
        const packageId = this._nextPackageId(name);
        const blockId = 'main';
        const packageDescriptor = normalizePackage({
            format: CUSTOM_SHADER_FORMAT,
            version: CUSTOM_SHADER_VERSION,
            id: packageId,
            name,
            blocks: [{
                id: blockId,
                name,
                file: `${packageId}.glsl`,
                source,
                inputs: inferShaderInputs(source, MAX_INPUTS),
                editorManaged: true,
                autoInputs: true
            }]
        });
        const engine = this.penFX._getEngine();
        this._validatePackageShaders(engine, packageDescriptor);
        const packages = this._customPackages().map(cloneJSON);
        packages.push(packageDescriptor);
        await this._commitCustomPackages(packages.map(descriptor => normalizePackage(descriptor)));
        return this.getShader(`${packageId}:${blockId}`);
    }

    async updateShader (key, changes = {}) {
        const packages = this._customPackages().map(cloneJSON);
        const location = this._findShaderBlock(packages, key);
        if (!location) throw new Error('Shader not found.');
        const packageDescriptor = packages[location.packageIndex];
        const shaderBlock = packageDescriptor.blocks[location.blockIndex];
        if (shaderBlock.implementation || !shaderBlock.source) throw new Error('This shader cannot be edited.');
        const previousName = shaderBlock.name;
        if (changes.name !== undefined) {
            shaderBlock.name = assertString(changes.name, 'Shader name', 64);
        }
        if (changes.source !== undefined) {
            shaderBlock.source = String(changes.source).replace(/\r\n?/g, '\n');
        }
        if (shaderBlock.autoInputs || changes.autoInputs === true) {
            shaderBlock.inputs = inferShaderInputs(shaderBlock.source, MAX_INPUTS);
            shaderBlock.autoInputs = true;
            shaderBlock.editorManaged = true;
        }
        if (changes.name !== undefined || shaderBlock.autoInputs) delete shaderBlock.text;
        if (packageDescriptor.blocks.length === 1 &&
            (packageDescriptor.name === previousName || shaderBlock.editorManaged)) {
            packageDescriptor.name = shaderBlock.name;
        }
        const normalizedPackage = normalizePackage(packageDescriptor);
        const engine = this.penFX._getEngine();
        this._validatePackageShaders(engine, normalizedPackage);
        packages[location.packageIndex] = normalizedPackage;
        await this._commitCustomPackages(packages.map(descriptor => normalizePackage(descriptor)));
        return this.getShader(key);
    }

    async duplicateShader (key) {
        const shader = this.getShader(key);
        if (!shader) throw new Error('Shader not found.');
        return this.createShader({name: `${shader.name} copy`, source: shader.source});
    }

    async deleteShader (key) {
        const packages = this._customPackages().map(cloneJSON);
        const location = this._findShaderBlock(packages, key);
        if (!location) return false;
        const packageDescriptor = packages[location.packageIndex];
        if (packageDescriptor.blocks.length === 1) {
            packages.splice(location.packageIndex, 1);
        } else {
            packageDescriptor.blocks.splice(location.blockIndex, 1);
        }
        await this._commitCustomPackages(packages.map(descriptor => normalizePackage(descriptor)));
        return true;
    }

    async importFile (file) {
        const fileName = String(file && file.name || 'shader.glsl');
        if (/\.zip$/i.test(fileName)) {
            return this.importZip(await readBlobAsArrayBuffer(file), fileName);
        }
        if (!/\.glsl$/i.test(fileName)) throw new Error('Choose a .glsl file or a shader package .zip.');
        if (file && Number.isFinite(file.size) && file.size > MAX_SHADER_CHARACTERS * 4) {
            throw new Error('Shader file is too large.');
        }
        const source = await readBlobAsText(file);
        if (source.length > MAX_SHADER_CHARACTERS) throw new Error('Shader file is too large.');
        return this.createShader({
            name: humanize(fileName) || 'Shader',
            source
        });
    }

    _packageToolboxBlocks (packageDescriptor, locale) {
        const blocks = [];
        const namespace = packageDescriptor.menuNamespace || packageDescriptor.id;
        for (const shaderBlock of packageDescriptor.blocks) {
            const displayBlock = localizeShaderBlock(packageDescriptor, shaderBlock, locale);
            if (displayBlock.separatorBefore) blocks.push('---');
            const argumentsInfo = {};
            for (const input of displayBlock.inputs) {
                argumentsInfo[input.id] = {
                    type: argumentTypeForInput(input),
                    defaultValue: input.defaultValue
                };
                if (input.menu) argumentsInfo[input.id].menu = input.menu;
                if (input.type === 'menu') {
                    argumentsInfo[input.id].menu = menuNameFor(namespace, displayBlock.id, input.id);
                }
            }
            const opcode = opcodeFor(packageDescriptor.id, displayBlock.id, displayBlock.opcode);
            blocks.push({
                opcode,
                func: opcode,
                blockType: displayBlock.blockType === 'reporter' ? BlockType.REPORTER : BlockType.COMMAND,
                text: displayBlock.text,
                arguments: argumentsInfo
            });
        }
        return blocks;
    }

    getToolboxBlocks () {
        const locale = resolveLocale(null, this.vm);
        const blocks = [];
        const sections = [];
        for (const packageDescriptor of this.pluginPackages.values()) {
            if (!packageDescriptor.isCore) sections.push({id: packageDescriptor.id, order: packageDescriptor.order, packageDescriptor});
        }
        for (const contribution of this.contributions.values()) {
            sections.push({id: contribution.id, order: contribution.order, contribution});
        }
        sections.sort(compareSections);
        for (const section of sections) {
            const source = section.packageDescriptor || section.contribution;
            blocks.push('---');
            blocks.push({blockType: BlockType.LABEL, text: resolveLabel(source.label, locale, source.name || source.id)});
            try {
                if (section.packageDescriptor) {
                    blocks.push(...callWithLocale(source.before, locale, []));
                    blocks.push(...this._packageToolboxBlocks(source, locale));
                    blocks.push(...callWithLocale(source.after, locale, []));
                } else {
                    blocks.push(...callWithLocale(source.blocks, locale, []));
                }
            } catch (error) {
                console.error(`[Pen FX] Could not build toolbox section ${section.id}:`, error);
            }
        }
        blocks.push('---');
        blocks.push({blockType: BlockType.LABEL, text: 'Custom Shaders'});
        blocks.push({blockType: BlockType.BUTTON, text: 'Import shader', func: 'importShaderPackage'});
        for (const packageDescriptor of this._customPackages()) {
            blocks.push('---');
            blocks.push({blockType: BlockType.LABEL, text: packageDescriptor.name});
            blocks.push({
                blockType: BlockType.BUTTON,
                text: 'Delete shader package',
                func: deleteFunctionFor(packageDescriptor.id)
            });
            blocks.push(...this._packageToolboxBlocks(packageDescriptor, locale));
        }
        const corePackage = this.pluginPackages.get(CORE_PACKAGE_ID);
        if (corePackage) {
            blocks.push('---');
            blocks.push(...this._packageToolboxBlocks(corePackage, locale));
        }
        blocks.push('---');
        return blocks;
    }

    getMenus () {
        const locale = resolveLocale(null, this.vm);
        const menus = {};
        const addStatic = (name, items) => {
            menus[name] = {acceptReporters: true, items: items.slice()};
        };
        for (const name of Object.keys(CORE_LEGACY_MENUS)) addStatic(name, CORE_LEGACY_MENUS[name]);
        const addMenus = (source, label) => {
            try {
                Object.assign(menus, callWithLocale(source, locale, {}));
            } catch (error) {
                console.error(`[Pen FX] Could not build menus for ${label}:`, error);
            }
        };
        for (const packageDescriptor of this.pluginPackages.values()) {
            for (const name of Object.keys(packageDescriptor.legacyMenus || {})) {
                addStatic(name, packageDescriptor.legacyMenus[name]);
            }
            if (packageDescriptor.menus) addMenus(packageDescriptor.menus, packageDescriptor.id);
        }
        for (const contribution of this.contributions.values()) {
            if (contribution.menus) addMenus(contribution.menus, contribution.id);
        }
        for (const packageDescriptor of this.packages.values()) {
            const namespace = packageDescriptor.menuNamespace || packageDescriptor.id;
            for (const shaderBlock of packageDescriptor.blocks) {
                for (const input of shaderBlock.inputs) {
                    if (input.type !== 'menu') continue;
                    menus[menuNameFor(namespace, shaderBlock.id, input.id)] = {
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
            for (const program of packageDescriptor.programs) {
                engine.registerCustomShader(programNameForDescriptor(packageDescriptor, program), program.source);
            }
            for (const shaderBlock of packageDescriptor.blocks) {
                if (!shaderBlock.source) continue;
                engine.registerCustomShader(
                    programNameFor(packageDescriptor.id, shaderBlock.id),
                    shaderBlock.source
                );
            }
        }
    }

    _bindPackage (packageDescriptor) {
        if (!packageDescriptor.isPlugin) {
            const deleteFunction = deleteFunctionFor(packageDescriptor.id);
            this.deleteFunctionNames.add(deleteFunction);
            // Extension buttons do not receive arguments, so expose a package-specific
            // callback while keeping the actual deletion logic on the manager.
            this.penFX[deleteFunction] = () => {
                this.deleteShaderPackage(packageDescriptor.id);
            };
        }
        const programOverrides = {};
        for (const program of packageDescriptor.programs) {
            if (program.bind) {
                programOverrides[program.bind] = programNameForDescriptor(packageDescriptor, program);
            }
        }
        const hasProgramOverrides = Object.keys(programOverrides).length > 0;
        let programOverrideState = this.programOverrideStates.get(packageDescriptor.id);
        if (!programOverrideState) {
            programOverrideState = {overrides: null};
            this.programOverrideStates.set(packageDescriptor.id, programOverrideState);
        }
        programOverrideState.overrides = hasProgramOverrides ? programOverrides : null;
        for (const shaderBlock of packageDescriptor.blocks) {
            const opcode = opcodeFor(packageDescriptor.id, shaderBlock.id, shaderBlock.opcode);
            const programName = programNameFor(packageDescriptor.id, shaderBlock.id);
            this.knownOpcodes.add(opcode);
            let wrapper;
            if (shaderBlock.implementation) {
                const implementationOpcode = shaderBlock.implementation.opcode;
                const implementation = this._implementationFor(implementationOpcode);
                if (!implementation) throw new Error(`PenFX implementation not found: ${implementationOpcode}.`);
                wrapper = (args, util) => {
                    const runImplementation = () => implementation.call(this.penFX, args || {}, util);
                    const invoke = () => {
                        if (shaderBlock.groupEffectScope === 'expanded' &&
                            typeof this.penFX.withGroupEffectScope === 'function') {
                            return this.penFX.withGroupEffectScope('expanded', runImplementation);
                        }
                        return runImplementation();
                    };
                    if (programOverrideState.overrides &&
                        typeof this.penFX.withShaderProgramOverrides === 'function') {
                        return this.penFX.withShaderProgramOverrides(programOverrideState.overrides, invoke);
                    }
                    return invoke();
                };
            } else {
                wrapper = args => {
                    const uniforms = {
                        u_resolution: [0, 0],
                        u_time: this._timelineTime(),
                        u_frame: this._timelineFrame()
                    };
                    const integerUniforms = new Set(['u_frame']);
                    for (const input of shaderBlock.inputs) {
                        const value = args && args[input.id] === undefined ? input.defaultValue : args[input.id];
                        let uniformValue;
                        if (input.type === 'color') {
                            uniformValue = color(value);
                        } else if (input.type === 'boolean') {
                            uniformValue = boolean(value) ? 1 : 0;
                            integerUniforms.add(input.uniform);
                        } else if (input.type === 'menu') {
                            uniformValue = Math.max(0, input.items.indexOf(String(value)));
                            integerUniforms.add(input.uniform);
                        } else {
                            uniformValue = (number(value) * input.scale) + input.offset;
                            if (input.type === 'integer') {
                                uniformValue = Math.round(uniformValue);
                                integerUniforms.add(input.uniform);
                            }
                        }
                        if (input.component !== undefined) {
                            if (!uniforms[input.uniform]) uniforms[input.uniform] = new Array(input.vectorSize).fill(0);
                            uniforms[input.uniform][input.component] = uniformValue;
                        } else {
                            uniforms[input.uniform] = uniformValue;
                        }
                    }
                    this.penFX._safe(engine => engine.customShader(
                        programName,
                        uniforms,
                        Array.from(integerUniforms),
                        this.penFX.blendMode
                    ), {groupEffectScope: shaderBlock.groupEffectScope});
                };
            }
            this.opcodeWrappers.add(wrapper);
            this.penFX[opcode] = wrapper;
            if (this.penFX.engine && shaderBlock.source) {
                this.penFX.engine.registerCustomShader(programName, shaderBlock.source);
            }
        }
        if (this.penFX.engine) {
            for (const program of packageDescriptor.programs) {
                this.penFX.engine.registerCustomShader(programNameForDescriptor(packageDescriptor, program), program.source);
            }
        }
    }

    _replacePackages (packages) {
        if (this.penFX.engine) {
            for (const packageDescriptor of this.packages.values()) {
                for (const program of packageDescriptor.programs) {
                    this.penFX.engine.unregisterCustomShader(programNameForDescriptor(packageDescriptor, program));
                }
                for (const shaderBlock of packageDescriptor.blocks) {
                    if (!shaderBlock.source) continue;
                    this.penFX.engine.unregisterCustomShader(programNameFor(packageDescriptor.id, shaderBlock.id));
                }
            }
        }
        // Opcodes of removed packages stay callable as no-ops: scripts that still contain them keep running.
        for (const opcode of this.knownOpcodes) {
            const noop = () => undefined;
            this.opcodeWrappers.add(noop);
            this.penFX[opcode] = noop;
        }
        for (const deleteFunction of this.deleteFunctionNames) this.penFX[deleteFunction] = () => undefined;
        this.deleteFunctionNames.clear();
        this.packages.clear();
        const packageIds = new Set(packages.map(packageDescriptor => packageDescriptor.id));
        for (const packageId of this.programOverrideStates.keys()) {
            if (!packageIds.has(packageId)) this.programOverrideStates.delete(packageId);
        }
        packages.forEach(packageDescriptor => {
            try {
                this._bindPackage(packageDescriptor);
                this.packages.set(packageDescriptor.id, packageDescriptor);
            } catch (error) {
                console.error(`[Pen FX] Could not bind package ${packageDescriptor.id}:`, error);
            }
        });
        this.emit('shadersChanged');
    }

    _validatePackageShaders (engine, packageDescriptor) {
        for (const program of packageDescriptor.programs) {
            try {
                engine.validateCustomShader(program.source);
            } catch (error) {
                throw new Error(`${program.file}: ${error.message}`);
            }
        }
        for (const shaderBlock of packageDescriptor.blocks) {
            if (!shaderBlock.source) continue;
            try {
                engine.validateCustomShader(shaderBlock.source);
            } catch (error) {
                throw new Error(`${shaderBlock.file}: ${error.message}`);
            }
        }
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

    // Plugins register several packages while they activate; rebuild the toolbox once afterwards.
    _scheduleRefresh () {
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = Promise.resolve()
            .then(() => {
                this.refreshPromise = null;
                return this._refreshBlocks();
            })
            .catch(error => {
                this.refreshPromise = null;
                console.error('[Pen FX] Could not refresh blocks:', error);
            });
        return this.refreshPromise;
    }

    async restorePackages (serializedPackages) {
        const packages = [];
        this.unavailablePackages = [];
        if (Array.isArray(serializedPackages)) {
            for (const descriptor of serializedPackages) {
                try {
                    const normalized = normalizePackage(descriptor);
                    if (this.pluginPackages.has(normalized.id)) {
                        throw new Error(`Package id ${normalized.id} is used by an installed plugin.`);
                    }
                    packages.push(normalized);
                } catch (error) {
                    console.error('[Pen FX] Could not restore custom shader package:', error);
                }
            }
        }
        this._rebind(packages);
        if (this.unavailablePackages.length) {
            console.warn('[Pen FX] Some custom shader packages need a plugin that is not installed:',
                this.unavailablePackages.map(descriptor => descriptor.id).join(', '));
        }
        await this._refreshBlocks();
    }

    async importZip (data, archiveName) {
        const packageDescriptor = await parseShaderZip(data, archiveName);
        if (this.pluginPackages.has(packageDescriptor.id)) {
            throw new Error(`${packageDescriptor.id} is used by an installed plugin.`);
        }
        this._assertImplementations(packageDescriptor);
        const engine = this.penFX._getEngine();
        this._validatePackageShaders(engine, packageDescriptor);
        const packages = this._customPackages().filter(existing => existing.id !== packageDescriptor.id);
        packages.push(packageDescriptor);
        this._rebind(packages);
        await this._refreshBlocks();
        if (this.vm && this.vm.runtime && typeof this.vm.runtime.emitProjectChanged === 'function') {
            this.vm.runtime.emitProjectChanged();
        }
        return packageDescriptor;
    }

    deleteShaderPackage (packageId) {
        const packageDescriptor = this.packages.get(packageId);
        if (!packageDescriptor || packageDescriptor.isPlugin) return Promise.resolve(false);
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' &&
            !window.confirm(`Delete custom shader package "${packageDescriptor.name}"?`)) {
            return Promise.resolve(false);
        }

        this._rebind(this._customPackages().filter(existing => existing.id !== packageDescriptor.id));
        const pendingRefresh = this._refreshBlocks()
            .then(() => {
                if (this.vm && this.vm.runtime && typeof this.vm.runtime.emitProjectChanged === 'function') {
                    this.vm.runtime.emitProjectChanged();
                }
                return true;
            })
            .catch(error => {
                console.error('[Pen FX] Could not delete custom shader package:', error);
                return false;
            });
        const movieAssetManager = this.vm && this.vm.runtime && this.vm.runtime.movieAssetManager;
        if (movieAssetManager && typeof movieAssetManager.runWithoutWaiting === 'function') {
            movieAssetManager.runWithoutWaiting(pendingRefresh);
        }
        return pendingRefresh;
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
    DEFAULT_SHADER_SOURCE,
    CORE_PACKAGE_ID,
    DEFAULT_SHADER_PACKAGE_ID,
    PenFXCustomShaderManager,
    menuNameFor,
    normalizePackage,
    opcodeFor,
    parseShaderZip,
    programNameFor
};
export default PenFXCustomShaderManager;
