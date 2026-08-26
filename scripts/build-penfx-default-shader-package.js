#!/usr/bin/env node

const babel = require('@babel/core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const JSZip = require('@turbowarp/jszip');

const root = path.resolve(__dirname, '..');
const shaderSourceDirectory = path.join(root, 'src/lib/pen-fx/shaders');
const packageDirectory = path.join(root, 'src/lib/pen-fx/default-shader-package');
const manifestPath = path.join(packageDirectory, 'shading-shader.json');
const outputPath = path.join(packageDirectory, 'penfx-builtins.zip');
const stableDate = new Date('1980-01-01T00:00:00.000Z');

const compileShaderModules = temporaryDirectory => {
    for (const file of fs.readdirSync(shaderSourceDirectory)) {
        if (!file.endsWith('.js')) continue;
        const sourcePath = path.join(shaderSourceDirectory, file);
        const output = babel.transformFileSync(sourcePath, {
            babelrc: false,
            comments: true,
            presets: ['@babel/preset-env'],
            sourceMaps: false
        });
        fs.writeFileSync(path.join(temporaryDirectory, file), output.code);
    }
    // eslint-disable-next-line global-require
    return require(path.join(temporaryDirectory, 'index.js')).programSources;
};

const build = async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'penfx-shaders-'));
    try {
        const programSources = compileShaderModules(temporaryDirectory);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const zip = new JSZip();
        const zipOptions = {createFolders: false, date: stableDate};
        zip.file('shading-shader.json', `${JSON.stringify(manifest, null, 2)}\n`, zipOptions);
        for (const program of manifest.programs) {
            const source = programSources[program.bind];
            if (typeof source !== 'string') throw new Error(`Unknown PenFX shader program: ${program.bind}`);
            zip.file(program.file, source.replace(/\r\n?/g, '\n'), zipOptions);
        }
        const archive = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: {level: 9},
            platform: 'DOS'
        });
        fs.writeFileSync(outputPath, archive);
        process.stdout.write(`${path.relative(root, outputPath)} (${archive.length} bytes)\n`);
    } finally {
        fs.rmSync(temporaryDirectory, {recursive: true, force: true});
    }
};

build().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
