// Projects whose frames scripts/frame-hash/ compares. Each is built with test/helpers/project-builder.js.
import {buildProject} from '../../test/helpers/project-builder';

// A 2x2 SVG stored in the page's asset storage by entry.js; the sprite needs a costume to own a skin.
const COSTUME = {
    name: 'costume1',
    assetId: '00000000000000000000000000f4a3e1',
    md5ext: '00000000000000000000000000f4a3e1.svg',
    dataFormat: 'svg',
    rotationCenterX: 1,
    rotationCenterY: 1
};
const COSTUME_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>';

const shape = inputs => ({
    opcode: 'objects_shape',
    inputs: {
        SHAPE: 'polygon',
        N: 5,
        RATIO: 0.5,
        PX: 0,
        PY: 0,
        PZ: 480,
        RX: 0,
        RY: 0,
        RZ: 0,
        SX: 1,
        SY: 1,
        SZ: 1,
        INNER: 20,
        OUTER: 60,
        WIDTH: 100,
        HEIGHT: 100,
        T1: 0,
        T2: 1000,
        COLOR: '#ff8800',
        OPACITY: 100,
        ...inputs
    }
});

const easing = (v0, v1) => ({
    opcode: 'operator_easing',
    fields: {TYPE: 'PowerInOut'},
    inputs: {V0: v0, V1: v1, T0: 0, T1: 1, POWER: 2, SPEED: 0}
});

// A shape that moves fast enough to blur, drawn inside `wrap` (a C block around the draw, or none).
const movingShape = wrap => {
    const body = [shape({
        PX: {opcode: 'operator_multiply', inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: 600}},
        PY: {opcode: 'operator_multiply', inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: -90}},
        RZ: {opcode: 'operator_multiply', inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: 720}}
    })];
    return buildProject({
        costume: COSTUME,
        scripts: [{
            hat: 'event_renderframe',
            body: [{opcode: 'objects_clear'}, ...(wrap ? [{...wrap, substack: body}] : body)]
        }]
    });
};

const PROJECTS = {
    // The moving shape as is, under a motion blur, or at a local time offset (one sample of the blur).
    moving: () => movingShape(null),
    motionBlur: ({samples = 8, angle = 180, phase = -90} = {}) => movingShape({
        opcode: 'objects_motionBlur', inputs: {ANGLE: angle, PHASE: phase, SAMPLES: samples}
    }),
    atOffset: ({seconds = 0} = {}) => movingShape({
        opcode: 'objects_localTime', fields: {MODE: 'offset'}, inputs: {A: -seconds, B: 0}
    }),
    // Every value is a function of the timeline time.
    stateless: () => buildProject({
        costume: COSTUME,
        scripts: [{
            hat: 'event_renderframe',
            body: [
                {opcode: 'objects_clear'},
                shape({PX: easing(-180, 180),
                    RZ: {
                        opcode: 'operator_multiply',
                        inputs: {NUM1: {opcode: 'objects_timelineTime'}, NUM2: 90}
                    }})
            ]
        }]
    })
};

export {COSTUME, COSTUME_SVG, PROJECTS};
