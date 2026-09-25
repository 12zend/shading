import ArgumentType from '../../../scratch-vm/src/extension-support/argument-type';
import BlockType from '../../../scratch-vm/src/extension-support/block-type';
import Cast from '../../../scratch-vm/src/util/cast';
import createPenFXEngine, {
    registerEngineExtension,
    registerEngineProgram
} from 'scratch-render/src/pen-fx/engine';
import vertexShader from 'scratch-render/src/pen-fx/shaders/vertex';
import * as penFXHelpers from '../../../scratch-vm/src/lib/pen-fx/helpers';
import {BLEND_MODES} from 'scratch-render/src/pen-fx/constants';
import {localize, resolveLocale} from '../movie-block-l10n';
import {decodeText} from './archive';
import {createPresetPickerField, definePresetMenuBlock} from './ui/preset-picker';
import {EffectPreviewRenderer} from './ui/preview-renderer';
import {createSampleSnapshot, isBlankSnapshot} from './ui/snapshots';

const API_VERSION = 1;

const MIME_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    json: 'application/json',
    txt: 'text/plain',
    css: 'text/css',
    glsl: 'text/plain',
    wasm: 'application/wasm',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm'
};

// Install-function style: `install({PenFX, vm})` assigns to `PenFX.prototype.name`. The host hands it a recording
// prototype so the methods can be tracked and removed when the plugin is disabled.
const recordMethods = (methodsOrInstall, key, extra) => {
    if (typeof methodsOrInstall === 'function') {
        const methods = {};
        methodsOrInstall(Object.assign({[key]: {prototype: methods}}, extra));
        return methods;
    }
    if (methodsOrInstall && typeof methodsOrInstall === 'object') return Object.assign({}, methodsOrInstall);
    throw new TypeError('Pass an object of methods or an install function.');
};

/**
 * Build the API object a plugin receives from require('shading') and activate(shading).
 * @param {object} manager ShadingPluginManager.
 * @param {object} record Installed plugin record.
 * @returns {{api: object, dispose: Function}} API and the function that undoes every registration.
 */
const createPluginAPI = (manager, record) => {
    const vm = manager.vm;
    const disposers = [];
    const objectURLs = new Map();
    let disposed = false;
    const track = disposer => {
        if (disposed) {
            disposer();
            return () => {};
        }
        disposers.push(disposer);
        return disposer;
    };
    const assertActive = () => {
        if (disposed) throw new Error(`Plugin ${record.id} is no longer active.`);
    };
    const penFX = () => {
        const instance = vm.runtime.penFX;
        if (!instance) throw new Error('PenFX is not available.');
        return instance;
    };
    const readBytes = path => {
        const key = String(path).replace(/^\.?\//, '');
        const bytes = record.files.get(key);
        if (!bytes) throw new Error(`${record.id}: file not found: ${key}`);
        return bytes;
    };
    const getLocale = () => resolveLocale(null, vm);
    const displayName = locale => {
        const localized = record.manifest.locales && record.manifest.locales[locale];
        return (localized && localized.name) || record.manifest.name;
    };

    const api = {
        apiVersion: API_VERSION,
        plugin: Object.freeze({
            id: record.id,
            name: record.manifest.name,
            version: record.manifest.version,
            manifest: record.manifest
        }),
        vm,
        runtime: vm.runtime,
        get renderer () {
            return vm.runtime.renderer;
        },
        scratch: Object.freeze({ArgumentType, BlockType, Cast}),
        l10n: Object.freeze({
            getLocale,
            localize
        }),
        log: (...args) => console.log(`[plugin:${record.id}]`, ...args), // eslint-disable-line no-console
        warn: (...args) => console.warn(`[plugin:${record.id}]`, ...args), // eslint-disable-line no-console
        error: (...args) => console.error(`[plugin:${record.id}]`, ...args), // eslint-disable-line no-console

        onDispose: callback => {
            if (typeof callback !== 'function') throw new TypeError('onDispose needs a function.');
            track(() => callback());
        },

        // Start asynchronous work from a block without returning a promise to the VM (see AGENTS.md).
        runWithoutWaiting: promise => {
            const manager2 = vm.runtime.movieAssetManager;
            if (manager2 && typeof manager2.runWithoutWaiting === 'function') manager2.runWithoutWaiting(promise);
            else Promise.resolve(promise).catch(error => api.error(error));
        },

        files: Object.freeze({
            list: () => Array.from(record.files.keys()),
            has: path => record.files.has(String(path).replace(/^\.?\//, '')),
            bytes: path => readBytes(path).slice(),
            text: path => decodeText(readBytes(path)),
            json: path => JSON.parse(decodeText(readBytes(path))),
            // Blob URLs stay valid until the plugin is disabled.
            url: (path, type) => {
                const key = String(path).replace(/^\.?\//, '');
                if (!objectURLs.has(key)) {
                    const extension = key.split('.').pop()
                        .toLowerCase();
                    const blob = new Blob([readBytes(key)], {type: type || MIME_TYPES[extension] || ''});
                    objectURLs.set(key, URL.createObjectURL(blob));
                }
                return objectURLs.get(key);
            }
        }),

        plugins: Object.freeze({
            list: () => manager.getPlugins().map(plugin => ({
                id: plugin.id, name: plugin.name, version: plugin.version, state: plugin.state
            })),
            isActive: id => manager.isActive(id),
            // The module exports of another active plugin (for plugins that build on each other), or null.
            getExports: id => manager.getExports(id),
            // Resolves when that plugin finished activating (including asynchronous loading), or null.
            whenReady: id => manager.whenReady(id)
        }),

        penfx: Object.freeze({
            get instance () {
                return penFX();
            },
            helpers: Object.freeze(Object.assign({}, penFXHelpers)),
            BLEND_MODES: Object.freeze(BLEND_MODES.slice()),
            vertexShader,
            registerProgram: (name, source, options) => {
                assertActive();
                return track(registerEngineProgram(name, source, options));
            },
            extendEngine: (methodsOrInstall, options = {}) => {
                assertActive();
                const methods = recordMethods(methodsOrInstall, 'Engine', {});
                return track(registerEngineExtension({methods, onResize: options.onResize}));
            },
            extendPenFX: methodsOrInstall => {
                assertActive();
                const methods = recordMethods(methodsOrInstall, 'PenFX', {vm});
                return track(manager.extendPenFX(methods, record.id));
            },
            registerBlocks: (packageDescriptor, options = {}) => {
                assertActive();
                const manifest = packageDescriptor && typeof packageDescriptor === 'object' ? packageDescriptor : {};
                const blocks = (manifest.blocks || []).map(block => {
                    if (!block || typeof block.source !== 'undefined' || !block.file || block.implementation) {
                        return block;
                    }
                    return Object.assign({}, block, {source: decodeText(readBytes(block.file))});
                });
                const programs = (manifest.programs || []).map(program => (
                    program && typeof program.source === 'undefined' && program.file ?
                        Object.assign({}, program, {source: decodeText(readBytes(program.file))}) : program
                ));
                return track(penFX().customShaders.registerPluginPackage(Object.assign({}, manifest, {
                    format: manifest.format || 'shading.app/penfx-shader',
                    version: manifest.version || 2,
                    id: manifest.id || record.id,
                    name: manifest.name || record.manifest.name,
                    blocks,
                    programs
                }), Object.assign({
                    label: options.label || displayName
                }, options, {pluginId: record.id})));
            },
            addToolbox: contribution => {
                assertActive();
                return track(penFX().customShaders.addToolboxContribution(Object.assign({
                    label: displayName
                }, contribution)));
            },
            createEngineClass: (gl, rendererLike) => createPenFXEngine(gl, rendererLike),
            createPreviewRenderer: () => {
                const renderer = new EffectPreviewRenderer(penFX());
                track(() => renderer.dispose());
                return renderer;
            },
            refresh: () => penFX().customShaders._scheduleRefresh()
        }),

        extensions: Object.freeze({
            // Register a Scratch extension object ({getInfo(), ...methods}) as its own category.
            register: extensionObject => {
                assertActive();
                return track(manager.registerExtension(record.id, extensionObject));
            },
            refresh: extensionId => manager.refreshExtension(extensionId)
        }),

        blocks: Object.freeze({
            // Run whenever the GUI (re)defines a category's blocks, e.g. to add custom fields.
            define: (categoryId, callback) => {
                assertActive();
                return track(manager.addBlockDefiner(categoryId, callback));
            },
            // Adjust a category's toolbox XML, e.g. to give a block richer default inputs.
            filterToolboxXML: (categoryId, callback) => {
                assertActive();
                return track(manager.addToolboxFilter(categoryId, callback));
            }
        }),

        gui: Object.freeze({
            // A tab next to Code / Costumes / ... . Either `component` (a React component rendered inside the editor
            // with {vm, locale}) or `mount(container, {vm, locale})`, which may return a cleanup function.
            addTab: tab => {
                assertActive();
                return track(manager.addTab(record.id, tab));
            },
            addStyle: cssText => {
                assertActive();
                if (typeof document === 'undefined') return () => {};
                const style = document.createElement('style');
                style.dataset.shadingPlugin = record.id;
                style.textContent = String(cssText);
                document.head.appendChild(style);
                return track(() => style.remove());
            },
            // An entry in the menu bar's Plugins menu.
            addMenuItem: item => {
                assertActive();
                return track(manager.addMenuItem(record.id, item));
            },
            notify: message => manager.notify(record.id, message),
            // The editor's own React and a few of its components ({React, ReactDOM, components: {AssetPanel},
            // icons: {fileUpload}, downloadBlob}), for plugins that build editor UI. Null without the editor.
            get react () {
                return manager.guiContext;
            }
        }),

        ui: Object.freeze({
            createPresetPickerField: (ScratchBlocks, source) => createPresetPickerField(
                ScratchBlocks, vm, getLocale(), source),
            definePresetMenuBlock: (ScratchBlocks, options) => definePresetMenuBlock(
                ScratchBlocks, vm, getLocale(), options),
            createSampleSnapshot,
            isBlankSnapshot
        }),

        project: Object.freeze({
            // serialize() returns JSON data (or undefined to omit it); deserialize(data) may return a promise and
            // is awaited before the project's blocks load. Data is stored in the project under `key`.
            registerData: (key, handlers) => {
                assertActive();
                return track(manager.registerProjectData(record.id, key, handlers));
            },
            // Called (and awaited) before each project's blocks load.
            onLoad: callback => {
                assertActive();
                return track(manager.addLoadListener(callback));
            },
            markChanged: () => {
                if (typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
            }
        })
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const disposer of disposers.splice(0).reverse()) {
            try {
                disposer();
            } catch (error) {
                console.error(`[plugin:${record.id}] Cleanup failed:`, error); // eslint-disable-line no-console
            }
        }
        for (const url of objectURLs.values()) URL.revokeObjectURL(url);
        objectURLs.clear();
    };
    return {api: Object.freeze(api), dispose};
};

export {API_VERSION, createPluginAPI};
