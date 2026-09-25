/* global Buffer */
import JSZip from '@turbowarp/jszip';

// A plugin is a zip with shading-plugin.json at its root, or inside one top-level folder
// (`zip -r blur.zip blur/` and `cd blur && zip -r ../blur.zip .` both work).

const PLUGIN_FORMAT = 'shading.app/plugin';
const PLUGIN_FORMAT_VERSION = 1;
const MANIFEST_NAME = 'shading-plugin.json';
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 768 * 1024 * 1024;
const MAX_FILES = 8000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const PERMISSIONS = [
    'network', 'storage', 'dynamic-code', 'wasm', 'workers', 'dom', 'navigation', 'clipboard', 'media',
    'desktop'
];
const IGNORED_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

const textDecoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');
const decodeText = bytes => {
    if (textDecoder) return textDecoder.decode(bytes);
    // Node test environments without TextDecoder.
    return Buffer.from(bytes).toString('utf8');
};

const byteLengthOf = data => {
    if (!data) return 0;
    if (typeof data.byteLength === 'number') return data.byteLength;
    if (typeof data.size === 'number') return data.size;
    return 0;
};

const normalizeEntryPath = name => {
    const path = String(name).replace(/\\/g, '/');
    if (path.indexOf('\0') !== -1) throw new Error(`Zip entry has an invalid name: ${JSON.stringify(name)}`);
    if (/^\/|^[A-Za-z]:\//.test(path)) throw new Error(`Zip entry uses an absolute path: ${path}`);
    const parts = path.split('/').filter(part => part !== '' && part !== '.');
    if (parts.some(part => part === '..')) throw new Error(`Zip entry escapes the plugin folder: ${path}`);
    return parts.join('/');
};

const optionalString = (manifest, key, maximum) => {
    const value = manifest[key];
    if (typeof value === 'undefined' || value === null || value === '') return '';
    if (typeof value !== 'string') throw new Error(`${MANIFEST_NAME}: ${key} must be a string.`);
    if (value.length > maximum) throw new Error(`${MANIFEST_NAME}: ${key} must be ${maximum} characters or fewer.`);
    return value.trim();
};

const idList = (manifest, key) => {
    const value = manifest[key];
    if (typeof value === 'undefined') return [];
    if (!Array.isArray(value) || value.length > 64 ||
        value.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) {
        throw new Error(`${MANIFEST_NAME}: ${key} must be a list of plugin ids.`);
    }
    return Array.from(new Set(value));
};

/**
 * Validate a plugin manifest.
 * @param {object} raw Parsed shading-plugin.json.
 * @returns {object} Normalized manifest.
 */
const normalizeManifest = raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${MANIFEST_NAME} must contain a JSON object.`);
    }
    if (raw.format !== PLUGIN_FORMAT) throw new Error(`${MANIFEST_NAME}: format must be "${PLUGIN_FORMAT}".`);
    const formatVersion = typeof raw.formatVersion === 'undefined' ? 1 : Number(raw.formatVersion);
    if (formatVersion !== PLUGIN_FORMAT_VERSION) {
        throw new Error(`${MANIFEST_NAME}: formatVersion ${raw.formatVersion} is not supported.`);
    }
    const id = String(raw.id || '');
    if (!ID_PATTERN.test(id)) {
        throw new Error(`${MANIFEST_NAME}: id must use lowercase letters, numbers and hyphens (max 48).`);
    }
    const name = optionalString(raw, 'name', 64) || id;
    const main = normalizeEntryPath(optionalString(raw, 'main', 240) || 'main.js');
    if (!/\.(c?js)$/i.test(main)) throw new Error(`${MANIFEST_NAME}: main must be a .js file.`);
    const permissions = typeof raw.permissions === 'undefined' ? [] : raw.permissions;
    if (!Array.isArray(permissions) || permissions.some(permission => !PERMISSIONS.includes(permission))) {
        throw new Error(`${MANIFEST_NAME}: permissions may only contain ${PERMISSIONS.join(', ')}.`);
    }
    const locales = {};
    if (typeof raw.locales !== 'undefined') {
        if (!raw.locales || typeof raw.locales !== 'object' || Array.isArray(raw.locales)) {
            throw new Error(`${MANIFEST_NAME}: locales must be an object.`);
        }
        for (const locale of Object.keys(raw.locales).slice(0, 32)) {
            const entry = raw.locales[locale];
            if (!entry || typeof entry !== 'object') continue;
            locales[locale] = {
                name: optionalString(entry, 'name', 64),
                description: optionalString(entry, 'description', 500)
            };
        }
    }
    return {
        format: PLUGIN_FORMAT,
        formatVersion,
        id,
        name,
        version: optionalString(raw, 'version', 32) || '0.0.0',
        description: optionalString(raw, 'description', 500),
        author: optionalString(raw, 'author', 100),
        license: optionalString(raw, 'license', 64),
        homepage: optionalString(raw, 'homepage', 300),
        main,
        permissions: Array.from(new Set(permissions)),
        dependencies: idList(raw, 'dependencies'),
        recommends: idList(raw, 'recommends'),
        locales
    };
};

const toHex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

// SHA-256 identifies the exact archive the user reviewed; environments without WebCrypto fall back to FNV-1a.
const hashArchive = async bytes => {
    const subtle = typeof crypto !== 'undefined' && crypto.subtle;
    if (subtle && typeof subtle.digest === 'function') {
        try {
            return `sha256-${toHex(await subtle.digest('SHA-256', bytes))}`;
        } catch (error) {
            // Fall through (e.g. insecure contexts).
        }
    }
    let first = 0x811c9dc5;
    let second = 0x01000193;
    for (let index = 0; index < bytes.length; index++) {
        /* eslint-disable no-bitwise */
        first = Math.imul(first ^ bytes[index], 0x01000193);
        second = Math.imul(second ^ bytes[index] ^ (index & 0xff), 0x5bd1e995);
        /* eslint-enable no-bitwise */
    }
    // eslint-disable-next-line no-bitwise
    const hex = value => (value >>> 0).toString(16).padStart(8, '0');
    return `fnv1a-${hex(first)}${hex(second)}`;
};

const toUint8Array = async data => {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    throw new Error('Choose a plugin .zip file.');
};

const isSymlink = entry => {
    const mode = entry.unixPermissions;
    // eslint-disable-next-line no-bitwise
    return typeof mode === 'number' && (mode & 0o170000) === 0o120000;
};

/**
 * Read and validate a plugin zip. Nothing inside is executed.
 * @param {ArrayBuffer|Uint8Array|Blob} data Archive bytes.
 * @param {string} [fileName] Original file name, for messages.
 * @returns {Promise<object>} {manifest, files: Map<path, Uint8Array>, hash, size, expandedSize, fileName, symlinks}
 */
const readPluginArchive = async (data, fileName = 'plugin.zip') => {
    if (byteLengthOf(data) > MAX_ARCHIVE_BYTES) throw new Error('Plugin zip must be 256 MB or smaller.');
    const bytes = await toUint8Array(data);
    let zip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (error) {
        throw new Error(`${fileName} is not a valid zip file.`);
    }
    const entries = Object.values(zip.files).filter(entry => !entry.dir && !IGNORED_ENTRY.test(entry.name));
    if (entries.length > MAX_FILES) throw new Error(`Plugin zip contains more than ${MAX_FILES} files.`);
    // Check the declared sizes before inflating anything, so a zip bomb is rejected cheaply.
    const declaredSize = entries.reduce((total, entry) => {
        const size = entry._data && entry._data.uncompressedSize;
        return total + (Number.isFinite(size) ? size : 0);
    }, 0);
    if (declaredSize > MAX_EXPANDED_BYTES) throw new Error('Plugin zip expands to more than 768 MB.');

    const paths = entries.map(entry => normalizeEntryPath(entry.name));
    const manifestPaths = paths.filter(path => path === MANIFEST_NAME || path.endsWith(`/${MANIFEST_NAME}`));
    if (!manifestPaths.length) throw new Error(`${fileName} does not contain ${MANIFEST_NAME}.`);
    const depth = path => path.split('/').length;
    manifestPaths.sort((a, b) => depth(a) - depth(b));
    const manifestPath = manifestPaths[0];
    if (depth(manifestPath) > 2) throw new Error(`${MANIFEST_NAME} must be at the top of the zip or in one folder.`);
    const prefix = manifestPath.slice(0, manifestPath.length - MANIFEST_NAME.length);

    const files = new Map();
    const symlinks = [];
    let expandedSize = 0;
    for (let index = 0; index < entries.length; index++) {
        const path = paths[index];
        if (prefix && !path.startsWith(prefix)) continue;
        const relative = path.slice(prefix.length);
        if (!relative) continue;
        if (isSymlink(entries[index])) {
            symlinks.push(relative);
            continue;
        }
        const content = await entries[index].async('uint8array');
        expandedSize += content.length;
        if (expandedSize > MAX_EXPANDED_BYTES) throw new Error('Plugin zip expands to more than 768 MB.');
        if (files.has(relative)) throw new Error(`Plugin zip contains ${relative} twice.`);
        files.set(relative, content);
    }
    const manifestBytes = files.get(MANIFEST_NAME);
    if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error(`${MANIFEST_NAME} is too large.`);
    let rawManifest;
    try {
        rawManifest = JSON.parse(decodeText(manifestBytes));
    } catch (error) {
        throw new Error(`Could not parse ${MANIFEST_NAME}: ${error.message}`);
    }
    const manifest = normalizeManifest(rawManifest);
    if (!files.has(manifest.main)) throw new Error(`The plugin's main file ${manifest.main} is missing.`);
    return {
        manifest,
        files,
        hash: await hashArchive(bytes),
        size: bytes.length,
        expandedSize,
        fileName,
        symlinks,
        bytes
    };
};

export {
    MANIFEST_NAME,
    PERMISSIONS,
    PLUGIN_FORMAT,
    decodeText,
    hashArchive,
    normalizeEntryPath,
    normalizeManifest,
    readPluginArchive
};
