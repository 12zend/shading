const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const root = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'production';

for (const directory of ['build', 'dist']) {
    const directoryPath = path.join(root, directory);
    fs.rmSync(directoryPath, {force: true, recursive: true});
    fs.mkdirSync(directoryPath, {recursive: true});
}

const compiler = webpack(require('../webpack.config'));
compiler.run((error, stats) => {
    const finish = closeError => {
        if (error || closeError || !stats || stats.hasErrors()) {
            process.exitCode = 1;
        }
    };
    if (stats) {
        process.stdout.write(`${stats.toString({colors: true, preset: 'normal'})}\n`);
    }
    if (typeof compiler.close === 'function') {
        compiler.close(finish);
    } else {
        finish();
    }
});
