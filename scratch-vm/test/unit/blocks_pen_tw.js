const test = require('tap').test;

const Runtime = require('../../src/engine/runtime');
const MovieDrawingCommands = require('../../src/blocks/movie-drawing');

test('clampSize', t => {
    const rt = new Runtime();
    const pen = new MovieDrawingCommands(rt);

    t.equal(pen.clampSize(-1), 1);
    t.equal(pen.clampSize(0), 1);
    t.equal(pen.clampSize(0.25), 1);
    t.equal(pen.clampSize(1), 1);
    t.equal(pen.clampSize(10), 10);
    t.equal(pen.clampSize(1000), 1000);
    t.equal(pen.clampSize(1200), 1200);
    t.equal(pen.clampSize(1201), 1200);

    rt.setRuntimeOptions({
        miscLimits: false
    });
    t.equal(pen.clampSize(-1), 0);
    t.equal(pen.clampSize(0), 0);
    t.equal(pen.clampSize(0.25), 0.25);
    t.equal(pen.clampSize(1), 1);
    t.equal(pen.clampSize(10), 10);
    t.equal(pen.clampSize(1000), 1000);
    t.equal(pen.clampSize(1200), 1200);
    t.equal(pen.clampSize(1201), 1201);

    t.end();
});
