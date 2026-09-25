/* eslint-disable import/no-commonjs */
import {decodeText} from './archive';

// Plugins are CommonJS modules evaluated from the archive in memory, so a plugin folder can be zipped as-is without
// a build step. `require('shading')` returns the plugin's API; relative requires resolve inside the plugin. Nothing
// is fetched from the network and no <script> element is used, which also keeps the page's CSP intact.

const dirname = path => {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
};

const resolvePath = (from, request) => {
    const parts = (request.startsWith('/') ? [] : dirname(from).split('/')).filter(Boolean);
    for (const part of request.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) throw new Error(`Cannot require ${request}: it is outside the plugin.`);
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join('/');
};

/**
 * @param {object} options Options.
 * @param {string} options.pluginId Plugin id, used for stack traces.
 * @param {Map<string, Uint8Array>} options.files Plugin files.
 * @param {object} options.api The object returned by require('shading').
 * @returns {{require: Function}} Module system.
 */
const createModuleSystem = ({pluginId, files, api}) => {
    const cache = new Map();
    const candidates = path => [path, `${path}.js`, `${path}.json`, `${path}/index.js`];

    const load = (from, request) => {
        if (typeof request !== 'string' || !request) throw new TypeError('require() needs a module name.');
        if (request === 'shading') return api;
        if (!request.startsWith('.') && !request.startsWith('/')) {
            throw new Error(`Cannot require "${request}": plugins can only require their own files and "shading".`);
        }
        const base = resolvePath(from, request);
        const path = candidates(base).find(candidate => files.has(candidate));
        if (!path) throw new Error(`Cannot find ${request} from ${from || 'the plugin'}.`);
        if (cache.has(path)) return cache.get(path).exports;
        const text = decodeText(files.get(path));
        if (/\.json$/i.test(path)) {
            const module = {exports: JSON.parse(text)};
            cache.set(path, module);
            return module.exports;
        }
        if (!/\.c?js$/i.test(path)) throw new Error(`Cannot require ${path}: only .js and .json files are modules.`);
        const module = {exports: {}, id: path, filename: path, loaded: false};
        cache.set(path, module);
        const localRequire = next => load(path, next);
        // eslint-disable-next-line no-new-func
        // `shading` is not a wrapper parameter so modules can declare `const shading = require('shading')`.
        const factory = new Function('module', 'exports', 'require', '__filename', '__dirname',
            `${text}\n//# sourceURL=shading-plugin://${pluginId}/${path}`);
        try {
            factory.call(module.exports, module, module.exports, localRequire, path, dirname(path));
        } catch (error) {
            cache.delete(path);
            throw error;
        }
        module.loaded = true;
        return module.exports;
    };

    return {require: request => load('', request)};
};

export {createModuleSystem, resolvePath};
