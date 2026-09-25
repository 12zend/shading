/* global __dirname */
// Loads the official plugins from a checkout of shading-plugins (next to this repository by default, or
// SHADING_PLUGINS_DIR) so the effect tests exercise the same code users install.
import fs from 'fs';
import path from 'path';
import {normalizeManifest} from '../../src/lib/plugins/archive';
import {ShadingPluginManager} from '../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../src/lib/plugins/storage';
import installPenFXBase, {createPenFXClass as createPenFXClassBase} from '../../src/lib/pen-fx';

const PLUGINS_DIR = process.env.SHADING_PLUGINS_DIR || path.resolve(__dirname, '../../../shading-plugins');
const hasOfficialPlugins = fs.existsSync(path.join(PLUGINS_DIR, 'blur', 'shading-plugin.json'));

// Genshade's compiler and textures are large and need a real browser; its blocks and settings are still tested.
const SKIPPED_FILES = /^assets\/(Textures\/|compiler\.)/;

const listPluginIds = () => fs.readdirSync(PLUGINS_DIR)
    .filter(name => fs.existsSync(path.join(PLUGINS_DIR, name, 'shading-plugin.json')))
    .sort();

const readPluginDirectory = id => {
    const root = path.join(PLUGINS_DIR, id);
    const files = new Map();
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(root, absolute).split(path.sep).join('/');
            if (entry.isDirectory()) walk(absolute);
            else if (!SKIPPED_FILES.test(relative) && entry.name !== '.DS_Store') {
                files.set(relative, new Uint8Array(fs.readFileSync(absolute)));
            }
        }
    };
    walk(root);
    const manifest = normalizeManifest(JSON.parse(Buffer.from(files.get('shading-plugin.json')).toString('utf8')));
    return {manifest, files, hash: `dir:${id}`, size: 0, fileName: id, symlinks: []};
};

// Activates plugins synchronously on a VM whose PenFX is installed. Returns the manager.
const loadOfficialPlugins = (vm, ids = listPluginIds()) => {
    const manager = vm.shadingPlugins || new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
    vm.shadingPlugins = manager;
    for (const id of ids) {
        const record = manager.loadArchive(readPluginDirectory(id));
        if (record.state === 'error') throw new Error(`${id}: ${record.error}`);
    }
    return manager;
};

// Drop-in replacements for the PenFX entry points that also load the official plugins.
const createPenFXClass = (vm, ids) => {
    const Base = createPenFXClassBase(vm);
    return class PenFXWithPlugins extends Base {
        constructor () {
            super();
            if (!vm.shadingPlugins) loadOfficialPlugins(vm, ids);
        }
    };
};

const installPenFX = (vm, ids) => {
    installPenFXBase(vm);
    if (!vm.shadingPlugins) loadOfficialPlugins(vm, ids);
    return vm;
};

export {
    PLUGINS_DIR,
    createPenFXClass,
    hasOfficialPlugins,
    installPenFX,
    listPluginIds,
    loadOfficialPlugins,
    readPluginDirectory
};

// Evaluate one module of a plugin (e.g. lib/presets.js) outside an editor, for unit tests of plugin internals.
const requirePluginModule = (id, modulePath, apiOverrides = {}) => {
    // Required lazily so this helper does not pull the module loader into every test that imports it.
    const {createModuleSystem} = require('../../src/lib/plugins/module-loader');
    const helpers = require('../../scratch-vm/src/lib/pen-fx/helpers');
    const archive = readPluginDirectory(id);
    const decode = bytes => Buffer.from(bytes).toString('utf8');
    const api = Object.assign({
        penfx: {helpers},
        files: {
            has: path => archive.files.has(path),
            text: path => decode(archive.files.get(path)),
            json: path => JSON.parse(decode(archive.files.get(path))),
            bytes: path => archive.files.get(path),
            url: path => `plugin://${id}/${path}`
        },
        error: () => {}
    }, apiOverrides);
    return createModuleSystem({pluginId: id, files: archive.files, api}).require(`./${modulePath}`);
};

export {requirePluginModule};
