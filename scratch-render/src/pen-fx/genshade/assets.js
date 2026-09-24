// Decoded source assets are shared independently of per-engine render targets.
// Loading belongs to project setup; command primitives only use ready resources.
/* global process */
let pending;
let resources;
let loadError;
// The editor also runs at routes such as /editor/ and /<project-id>/.
// Resolve these shared assets from the app root, not the current route.
const genshadeBaseURL = (root = process.env.ROOT || '/', pageURL = document.baseURI) =>
    new URL('genshade/', new URL(root, pageURL)).href;
// Shaders disagree on letter case (Cursor.png / cursor.png) and the production host is case-sensitive,
// so map each `source` annotation onto the file name listed in textures.json.
const resolveGenshadeTexture = (files, name) => {
    const path = name.split(/[\\/]/).join('/');
    if (files.includes(path)) return path;
    const folded = path.toLowerCase();
    return files.find(file => file.toLowerCase() === folded) || path;
};
const genshadeTextureURL = (base, file) => `${base}Textures/${file.split('/')
    .map(encodeURIComponent)
    .join('/')}`;
const loadGenshade = () => {
    if (pending) return pending;
    if (typeof document === 'undefined' || typeof fetch !== 'function') return Promise.resolve(null);
    pending = (async () => {
        const base = genshadeBaseURL();
        const readJSON = async name => {
            const response = await fetch(base + name);
            if (!response.ok) throw new Error(`Could not load Genshade ${name}: ${response.status}`);
            return response.json();
        };
        const [modules, sources, textureFiles] = await Promise.all([
            readJSON('modules.json'), readJSON('sources.json'), readJSON('textures.json')
        ]);
        const compilerFactory = await new Promise((resolve, reject) => {
            if (window.createGenshadeCompiler) return resolve(window.createGenshadeCompiler);
            const script = document.createElement('script');
            script.src = `${base}compiler.js`;
            script.onload = () => resolve(window.createGenshadeCompiler);
            script.onerror = () => reject(new Error('Could not load the Genshade compiler.'));
            document.head.appendChild(script);
        });
        let diagnostics = [];
        const compiler = await compilerFactory({
            locateFile: name => base + name,
            printErr: message => diagnostics.push(message),
            noInitialRun: true
        });
        compiler.FS.mkdir('/shaders');
        Object.entries(sources).forEach(([name, source]) => {
            const parts = name.split('/');
            let directory = '/shaders';
            parts.slice(0, -1).forEach(part => {
                directory += `/${part}`;
                try {
                    compiler.FS.mkdir(directory);
                } catch (error) {
                    // Shared directory already exists.
                }
            });
            compiler.FS.writeFile(`/shaders/${name}`, source);
        });
        const images = new Map();
        // A missing texture only disables the effects that sample it, not the whole catalog.
        const imageErrors = new Map();
        const names = new Set(Object.values(modules).flatMap(module => module.textures
            .map(texture => texture.annotations.source).filter(Boolean)));
        await Promise.all(Array.from(names, async name => {
            const image = new Image();
            try {
                await new Promise((resolve, reject) => {
                    image.onload = resolve;
                    image.onerror = () => reject(new Error(`Could not load Genshade texture: ${name}`));
                    image.src = genshadeTextureURL(base, resolveGenshadeTexture(textureFiles, name));
                });
                images.set(name, image);
            } catch (error) {
                imageErrors.set(name, error);
                console.error('[Genshade]', error.message);
            }
        }));
        resources = {
            modules,
            images,
            imageErrors,
            compile (file, width, height) {
                diagnostics = [];
                const result = compiler.callMain([`/shaders/${file}`, '/shaders', '/effect.json',
                    String(width), String(height)]);
                if (result) throw new Error(diagnostics.join('\n') || `Could not compile ${file}`);
                return JSON.parse(compiler.FS.readFile('/effect.json', {encoding: 'utf8'}));
            }
        };
        return resources;
    })().catch(error => {
        loadError = error;
        pending = null; // Permit an explicit retry after a transient asset failure.
        throw error;
    });
    return pending;
};
const getGenshade = () => {
    if (!resources) throw loadError || new Error('Genshade assets are still loading.');
    return resources;
};
export {loadGenshade, getGenshade, genshadeBaseURL, genshadeTextureURL, resolveGenshadeTexture};
