// Decoded source assets are shared independently of per-engine render targets.
// Loading belongs to project setup; command primitives only use ready resources.
let pending;
let resources;
let loadError;
const baseURL = () => new URL('genshade/', document.baseURI).href;
const loadGenshade = () => {
    if (pending) return pending;
    if (typeof document === 'undefined' || typeof fetch !== 'function') return Promise.resolve(null);
    pending = (async () => {
        const base = baseURL();
        const readJSON = async name => {
            const response = await fetch(base + name);
            if (!response.ok) throw new Error(`Could not load Genshade ${name}: ${response.status}`);
            return response.json();
        };
        const [modules, sources] = await Promise.all([readJSON('modules.json'), readJSON('sources.json')]);
        const compilerFactory = await new Promise((resolve, reject) => {
            if (window.createGenshadeCompiler) return resolve(window.createGenshadeCompiler);
            const script = document.createElement('script');
            script.src = `${base}compiler.js`;
            script.onload = () => resolve(window.createGenshadeCompiler);
            script.onerror = () => reject(new Error('Could not load the Genshade compiler.'));
            document.head.appendChild(script);
        });
        let diagnostics = [];
        const compiler = await compilerFactory({locateFile: name => base + name,
            printErr: message => diagnostics.push(message), noInitialRun: true});
        compiler.FS.mkdir('/shaders');
        Object.entries(sources).forEach(([name, source]) => {
            const parts = name.split('/');
            let directory = '/shaders';
            parts.slice(0, -1).forEach(part => {
                directory += `/${part}`;
                try { compiler.FS.mkdir(directory); } catch (error) { /* shared directory already exists */ }
            });
            compiler.FS.writeFile(`/shaders/${name}`, source);
        });
        const images = new Map();
        const names = new Set(Object.values(modules).flatMap(module => module.textures
            .map(texture => texture.annotations.source).filter(Boolean)));
        await Promise.all(Array.from(names, async name => {
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error(`Could not load Genshade texture: ${name}`));
                image.src = `${base}Textures/${name.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
            });
            images.set(name, image);
        }));
        resources = {modules, images, compile (file, width, height) {
            diagnostics = [];
            const result = compiler.callMain([`/shaders/${file}`, '/shaders', '/effect.json',
                String(width), String(height)]);
            if (result) throw new Error(diagnostics.join('\n') || `Could not compile ${file}`);
            return JSON.parse(compiler.FS.readFile('/effect.json', {encoding: 'utf8'}));
        }};
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
export {loadGenshade, getGenshade};
