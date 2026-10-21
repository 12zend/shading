// Runs first in every shading.app page that the TurboWarp extension host (host.js) opens.
// The pages are blob: documents with turbowarp.org's origin, so this script
//  - keeps localStorage, sessionStorage, IndexedDB and BroadcastChannel apart from TurboWarp's own,
//  - serves the build's static files (blocks media, official plugins) from memory, since a blob:
//    URL cannot resolve relative paths, and
//  - turns links between the site's pages into requests to the host.
// build-extension.cjs calls this function with the page's name.
(page => {
    const PREFIX = 'shading.app:';
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    let host = null;
    try {
        host = window.parent.__shadingAppExtension || null;
    } catch (error) {
        // Not opened by the host.
    }
    window.SHADING_EXTENSION_PAGE = page;

    // ---- Storage ----

    const wrapStorage = name => {
        let real;
        try {
            real = window[name];
        } catch (error) {
            return;
        }
        if (!real) return;
        const ownKeys = () => {
            const keys = [];
            for (let i = 0; i < real.length; i++) {
                const key = real.key(i);
                if (key !== null && key.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length));
            }
            return keys;
        };
        const api = {
            getItem: key => real.getItem(PREFIX + key),
            setItem: (key, value) => real.setItem(PREFIX + key, String(value)),
            removeItem: key => real.removeItem(PREFIX + key),
            clear: () => ownKeys().forEach(key => real.removeItem(PREFIX + key)),
            key: index => ownKeys()[index] ?? null
        };
        const proxy = new Proxy(api, {
            get: (target, property) => {
                if (property === 'length') return ownKeys().length;
                if (has(target, property) || typeof property !== 'string') return target[property];
                return real.getItem(PREFIX + property) ?? undefined; // eslint-disable-line no-undefined
            },
            set: (target, property, value) => {
                real.setItem(PREFIX + String(property), String(value));
                return true;
            },
            deleteProperty: (target, property) => {
                real.removeItem(PREFIX + String(property));
                return true;
            },
            has: (target, property) => property in target || real.getItem(PREFIX + String(property)) !== null,
            ownKeys: () => ownKeys(),
            getOwnPropertyDescriptor: (target, property) => {
                const value = real.getItem(PREFIX + String(property));
                if (value === null) return;
                return {value, writable: true, enumerable: true, configurable: true};
            }
        });
        Object.defineProperty(window, name, {configurable: true, enumerable: true, get: () => proxy});
    };
    wrapStorage('localStorage');
    wrapStorage('sessionStorage');

    if (window.IDBFactory) {
        const {open, deleteDatabase, databases} = IDBFactory.prototype;
        IDBFactory.prototype.open = function (name, ...rest) {
            return open.call(this, PREFIX + name, ...rest);
        };
        IDBFactory.prototype.deleteDatabase = function (name) {
            return deleteDatabase.call(this, PREFIX + name);
        };
        if (databases) {
            IDBFactory.prototype.databases = function () {
                return databases.call(this).then(list => list
                    .filter(info => info.name.startsWith(PREFIX))
                    .map(info => ({name: info.name.slice(PREFIX.length), version: info.version})));
            };
        }
    }

    if (window.BroadcastChannel) {
        const RealBroadcastChannel = window.BroadcastChannel;
        window.BroadcastChannel = class BroadcastChannel extends RealBroadcastChannel {
            constructor (name) {
                super(PREFIX + name);
            }
        };
    }

    // ---- Static files ----

    const files = (host && host.files) || {};
    const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
    const resolveFile = url => {
        if (typeof url !== 'string' || ABSOLUTE.test(url)) return null;
        const path = url.split(/[?#]/)[0].replace(/^(?:\.\/|\/)+/, '');
        return has(files, path) ? files[path] : null;
    };
    const rewrite = url => resolveFile(url) || url;
    const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const rewriteCSS = text => {
        if (typeof text !== 'string' || !text.includes('url(')) return text;
        return text.replace(CSS_URL, (match, quote, url) => {
            const file = resolveFile(url);
            return file ? `url("${file}")` : match;
        });
    };

    const realFetch = window.fetch;
    window.fetch = function (input, init) {
        return realFetch.call(this, typeof input === 'string' ? rewrite(input) : input, init);
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        return xhrOpen.call(this, method, rewrite(url), ...rest);
    };

    const URL_ATTRIBUTES = new Set(['src', 'href', 'xlink:href']);
    const {setAttribute, setAttributeNS} = Element.prototype;
    Element.prototype.setAttribute = function (name, value) {
        return setAttribute.call(this, name, URL_ATTRIBUTES.has(String(name).toLowerCase()) ? rewrite(value) : value);
    };
    Element.prototype.setAttributeNS = function (namespace, name, value) {
        return setAttributeNS.call(this, namespace, name,
            URL_ATTRIBUTES.has(String(name).toLowerCase()) ? rewrite(value) : value);
    };
    const wrapSetter = (Constructor, property) => {
        const descriptor = Constructor && Object.getOwnPropertyDescriptor(Constructor.prototype, property);
        if (!descriptor || !descriptor.set) return;
        Object.defineProperty(Constructor.prototype, property, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: descriptor.get,
            set (value) {
                descriptor.set.call(this, rewrite(value));
            }
        });
    };
    wrapSetter(window.HTMLImageElement, 'src');
    wrapSetter(window.HTMLMediaElement, 'src');
    wrapSetter(window.HTMLSourceElement, 'src');
    wrapSetter(window.HTMLLinkElement, 'href');

    if (window.Audio) {
        const RealAudio = window.Audio;
        const Audio = function (...args) {
            return args.length ? new RealAudio(rewrite(args[0])) : new RealAudio();
        };
        Audio.prototype = RealAudio.prototype;
        window.Audio = Audio;
    }

    // Stylesheets that reference media (scratch-blocks' cursors and sprites) are text nodes.
    const createTextNode = Document.prototype.createTextNode;
    Document.prototype.createTextNode = function (text) {
        return createTextNode.call(this, rewriteCSS(text));
    };

    // ---- Pages ----

    const PAGES = {
        '': 'editor',
        'index.html': 'editor',
        'editor.html': 'editor',
        'editor': 'editor',
        'install.html': 'install',
        'install': 'install',
        'addons.html': 'addons',
        'addons': 'addons'
    };
    const pageFor = url => {
        if (typeof url !== 'string' || ABSOLUTE.test(url) || url.startsWith('#')) return null;
        const path = url.split(/[?#]/)[0].replace(/^(?:\.\/|\/)+/, '').replace(/\/$/, '');
        return has(PAGES, path) ? PAGES[path] : null;
    };
    const openPage = (name, url, newWindow) => {
        const hashIndex = url.indexOf('#');
        const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
        if (host) host.openPage(name, {hash, newWindow, from: window});
    };

    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || !event.target.closest) return;
        const link = event.target.closest('a[href]');
        if (!link || link.hasAttribute('download')) return;
        const href = link.getAttribute('href');
        const name = pageFor(href);
        if (name) {
            event.preventDefault();
            openPage(name, href, link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey);
        } else if (!ABSOLUTE.test(href) && !href.startsWith('#')) {
            // Other site-relative pages do not exist here.
            event.preventDefault();
        }
    }, true);

    const realOpen = window.open;
    window.open = function (url, ...rest) {
        const name = pageFor(url);
        if (name) {
            openPage(name, url, true);
            return null;
        }
        return realOpen.call(this, url, ...rest);
    };

    // Mirror the page title onto the TurboWarp tab.
    if (host && page === 'editor') {
        const syncTitle = () => host.setTitle(document.title);
        document.addEventListener('DOMContentLoaded', () => {
            syncTitle();
            const title = document.querySelector('title');
            if (!title) return;
            new MutationObserver(syncTitle).observe(title, {childList: true, characterData: true, subtree: true});
        });
    }
})(__SHADING_PAGE__);
