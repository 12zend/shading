// Package the external repository into build output only; never vendor plugin sources or zips.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {execFileSync} = require('child_process');
const {createHash} = require('crypto');
const JSZip = require('@turbowarp/jszip');

async function build (source, output) {
    const catalog = [];
    await fs.rm(output, {recursive: true, force: true});
    await fs.mkdir(output, {recursive: true});
    for (const folder of (await fs.readdir(source)).sort()) {
        const directory = path.join(source, folder);
        let manifest;
        try {
            manifest = JSON.parse(await fs.readFile(path.join(directory, 'shading-plugin.json'), 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
            throw error;
        }
        if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(manifest.id) ||
            catalog.some(entry => entry.id === manifest.id)) throw new Error(`Invalid or duplicate id: ${manifest.id}`);
        // The /install page only accepts signed plugins, so fail the build instead of shipping a page that cannot.
        try {
            await fs.access(path.join(directory, 'shading-plugin.sig'));
        } catch (error) {
            throw new Error(`${manifest.id} is not signed. Run \`node scripts/sign.mjs\` in shading-plugins.`);
        }
        const zip = new JSZip();
        async function add (relative = '') {
            for (const entry of await fs.readdir(path.join(directory, relative), {withFileTypes: true})) {
                if (entry.name === '.DS_Store' || entry.name === '__MACOSX') continue;
                const name = path.posix.join(relative, entry.name);
                if (entry.isSymbolicLink()) throw new Error(`Symlink in plugin: ${name}`);
                if (entry.isDirectory()) await add(name);
                else zip.file(name, await fs.readFile(path.join(directory, name)), {date: new Date('2000-01-01')});
            }
        }
        await add();
        const data = await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
        const hash = `sha256-${createHash('sha256').update(data).digest('hex')}`;
        const fileName = `${manifest.id}.zip`;
        // Cloudflare static assets have a per-file limit; keep each part below 20 MiB.
        const parts = [];
        const partSize = 20 * 1024 * 1024;
        for (let offset = 0; offset < data.length; offset += partSize) {
            const part = `${fileName}.part${parts.length}`;
            await fs.writeFile(path.join(output, part), data.subarray(offset, offset + partSize));
            parts.push(part);
        }
        catalog.push({id: manifest.id, name: manifest.name, version: manifest.version, fileName, hash, parts});
    }
    if (!catalog.length) throw new Error('No official plugins found.');
    await fs.writeFile(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2));
    return catalog;
}

async function main () {
    let temporary;
    try {
        let source = process.env.SHADING_PLUGINS_DIR;
        if (!source) {
            temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'shading-plugins-'));
            source = path.join(temporary, 'source');
            execFileSync('git', ['clone', '--depth', '1', 'https://github.com/12zend/shading-plugins.git', source],
                {stdio: 'inherit'});
        }
        const plugins = await build(source, path.resolve(__dirname, '../build/official-plugins'));
        console.log(`Prepared ${plugins.length} official plugins.`);
    } finally {
        if (temporary) await fs.rm(temporary, {recursive: true, force: true});
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {build};
