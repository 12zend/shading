import JSZip from '@turbowarp/jszip';
import brotliWasmPath from 'brotli-wasm/pkg.web/brotli_wasm_bg.wasm';
import log from '../log';
import {buildShareURL} from './share-link-url';

let worker = null;
let workerFailed = false;
let nextRequestId = 1;
const requests = new Map();

const getWasmURL = () => new URL(brotliWasmPath, document.baseURI).href;

const rejectAll = error => {
    for (const request of requests.values()) request.reject(error);
    requests.clear();
};

const getWorker = () => {
    if (worker || workerFailed || typeof Worker === 'undefined') return worker;
    try {
        const ShareLinkWorker = require('worker-loader?name=js/share-link-worker.[hash].js!./share-link-worker');
        worker = new ShareLinkWorker();
        worker.onmessage = event => {
            const {id, kind} = event.data;
            const request = requests.get(id);
            if (!request) return;
            if (kind === 'progress') {
                if (request.onProgress) request.onProgress(event.data.progress);
            } else if (kind === 'result') {
                requests.delete(id);
                request.resolve(event.data.result);
            } else {
                requests.delete(id);
                request.reject(new Error(event.data.message));
            }
        };
        worker.onerror = event => {
            log.error('Share link worker failed', event);
            worker.terminate();
            worker = null;
            workerFailed = true;
            rejectAll(new Error('The share link worker stopped unexpectedly.'));
        };
    } catch (error) {
        log.error('Could not start share link worker', error);
        worker = null;
        workerFailed = true;
    }
    return worker;
};

const runTask = (type, data, onProgress) => {
    const payload = Object.assign({wasmURL: getWasmURL()}, data);
    const activeWorker = getWorker();
    if (!activeWorker) {
        return import(/* webpackChunkName: "share-link" */ './share-link-tasks')
            .then(module => module.default(type, payload, onProgress));
    }
    return new Promise((resolve, reject) => {
        const id = nextRequestId++;
        requests.set(id, {resolve, reject, onProgress});
        activeWorker.postMessage({id, type, data: payload});
    });
};

// Plugin files travel next to the project files under this prefix. Project assets are always flat
// "<md5>.<ext>" names, so the prefix cannot collide with them.
const PLUGIN_PREFIX = 'plugins/';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PLUGIN_MANIFEST = 'shading-plugin.json';
const textDecoder = new TextDecoder();

const readProjectPluginIds = projectJSONBytes => {
    try {
        const project = JSON.parse(textDecoder.decode(projectJSONBytes));
        return Array.isArray(project.shadingPlugins) ?
            project.shadingPlugins.map(reference => reference && reference.id).filter(id => typeof id === 'string') :
            [];
    } catch (error) {
        return [];
    }
};

/**
 * Installed plugins the project uses, with the plugins they depend on.
 * @param {VirtualMachine} vm The VM.
 * @param {Uint8Array} projectJSONBytes Saved project.json.
 * @returns {Array<{id: string, name: string, version: string, files: Map<string, Uint8Array>}>} Plugins.
 */
const getSharablePlugins = (vm, projectJSONBytes) => {
    const manager = vm.shadingPlugins;
    if (!manager || !manager.records) return [];
    const result = [];
    const seen = new Set();
    const visit = id => {
        if (seen.has(id)) return;
        seen.add(id);
        const record = manager.records.get(id);
        if (!record || !record.files || !record.files.has(PLUGIN_MANIFEST) || !PLUGIN_ID_PATTERN.test(id)) return;
        for (const dependency of record.manifest.dependencies || []) visit(dependency);
        result.push({
            id,
            name: record.manifest.name || id,
            version: record.manifest.version || '',
            files: record.files
        });
    };
    readProjectPluginIds(projectJSONBytes).forEach(visit);
    return result;
};

const pluginSummary = (id, files) => {
    let manifest = {};
    try {
        manifest = JSON.parse(textDecoder.decode(files.get(PLUGIN_MANIFEST)));
    } catch (error) {
        // The install review reports the broken manifest.
    }
    const locales = manifest.locales && typeof manifest.locales === 'object' ? manifest.locales : {};
    return {
        id,
        name: typeof manifest.name === 'string' && manifest.name ? manifest.name : id,
        localizedNames: Object.keys(locales).reduce((names, locale) => {
            if (locales[locale] && typeof locales[locale].name === 'string') names[locale] = locales[locale].name;
            return names;
        }, {}),
        version: typeof manifest.version === 'string' ? manifest.version : '',
        description: typeof manifest.description === 'string' ? manifest.description : ''
    };
};

/**
 * Encodes the whole project (project.json and every asset) into a share link.
 * @param {VirtualMachine} vm The VM holding the project.
 * @param {string} title Project title.
 * @param {object} [options] Options.
 * @param {boolean} [options.includePlugins] Embed the plugins the project uses (default true).
 * @param {function({stage: string, done: number, total: number})} [options.onProgress] Progress callback.
 * @returns {Promise<{url: string, payload: string, originalBytes: number, encodedBytes: number,
 *   fileCount: number, plugins: Array<object>, availablePlugins: Array<object>}>} The link and its statistics.
 */
const createShareLink = async (vm, title, options = {}) => {
    const projectFiles = vm.saveProjectSb3DontZip();
    // The VM hands out its own asset buffers; posting copies them, so the project is never detached.
    const files = Object.keys(projectFiles).map(name => ({name, data: projectFiles[name]}));
    const availablePlugins = getSharablePlugins(vm, projectFiles['project.json']);
    const plugins = options.includePlugins === false ? [] : availablePlugins;
    for (const plugin of plugins) {
        for (const [path, data] of plugin.files) files.push({name: `${PLUGIN_PREFIX}${plugin.id}/${path}`, data});
    }
    const originalBytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
    const describe = plugin => ({id: plugin.id, name: plugin.name, version: plugin.version});
    const onProgress = options.onProgress;
    const {payload, encodedBytes} = await runTask('encode', {files, title}, onProgress);
    return {
        url: buildShareURL(payload),
        payload,
        originalBytes,
        encodedBytes,
        fileCount: files.length,
        plugins: plugins.map(describe),
        availablePlugins: availablePlugins.map(describe)
    };
};

/**
 * Decodes a share payload into project data that vm.loadProject() accepts.
 * @param {string} payload Share payload.
 * @returns {Promise<{title: string, projectData: ArrayBuffer, plugins: Array<object>}>} Project title, project
 *   archive and the embedded plugins ({id, name, localizedNames, version, description, file}); each file is a
 *   plugin zip that still has to go through the plugin install review.
 */
const decodeShareLink = async payload => {
    const {title, files} = await runTask('decode', {payload});
    const zip = new JSZip();
    const pluginFiles = new Map();
    for (const file of files) {
        if (!file.name.startsWith(PLUGIN_PREFIX)) {
            zip.file(file.name, file.data);
            continue;
        }
        const rest = file.name.slice(PLUGIN_PREFIX.length);
        const slash = rest.indexOf('/');
        const id = rest.slice(0, slash);
        if (slash < 1 || !PLUGIN_ID_PATTERN.test(id)) continue;
        if (!pluginFiles.has(id)) pluginFiles.set(id, new Map());
        pluginFiles.get(id).set(rest.slice(slash + 1), file.data);
    }
    const projectData = await zip.generateAsync({type: 'arraybuffer', compression: 'STORE'});
    const plugins = [];
    for (const [id, pluginFileMap] of pluginFiles) {
        if (!pluginFileMap.has(PLUGIN_MANIFEST)) continue;
        const pluginZip = new JSZip();
        for (const [path, data] of pluginFileMap) pluginZip.file(`${id}/${path}`, data);
        const bytes = await pluginZip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
        plugins.push(Object.assign(pluginSummary(id, pluginFileMap), {
            file: typeof File === 'function' ?
                new File([bytes], `${id}.zip`, {type: 'application/zip'}) :
                Object.assign(new Blob([bytes], {type: 'application/zip'}), {name: `${id}.zip`})
        }));
    }
    return {title, projectData, plugins};
};

export {
    createShareLink,
    decodeShareLink,
    getSharablePlugins
};
