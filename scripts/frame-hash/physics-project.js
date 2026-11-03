// The project of the physics benchmark (scripts/frame-hash/physics-benchmark.js), also usable from jest.
import {buildProject} from '../../test/helpers/project-builder';

const BODIES = 100;

const reporter = (opcode, inputs = {}, fields = {}) => ({opcode, inputs, fields});
const variable = name => reporter('data_variable', {}, {VARIABLE: name});
const bodyName = reporter('operator_join', {STRING1: 'b', STRING2: variable('i')});

// 100 boxes in a 10 x 10 grid above a floor; the render frame draws a polygon at each body.
const physicsProject = ({costume, motionBlur}) => {
    const shape = {
        opcode: 'objects_shape',
        inputs: {
            SHAPE: 'polygon',
            N: 4,
            RATIO: 0.5,
            PX: 0,
            PY: 0,
            PZ: 0,
            RX: 0,
            RY: 0,
            RZ: 45,
            SX: 1,
            SY: 1,
            SZ: 1,
            INNER: 0,
            OUTER: 14,
            WIDTH: 100,
            HEIGHT: 100,
            T1: 0,
            T2: 1000,
            COLOR: '#40c0ff',
            OPACITY: 100
        }
    };
    // The loop runs inside an (identity) transform block, whose substack runs without yielding, so a frame is one
    // VM tick; a bare repeat in a render-frame script yields after every iteration.
    const drawBodies = [{
        opcode: 'objects_transform',
        inputs: {PX: 0, PY: 0, PZ: 0, AX: 0, AY: 0, AZ: 0, RX: 0, RY: 0, RZ: 0, SX: 1, SY: 1, SZ: 1},
        substack: [
            {opcode: 'data_setvariableto', fields: {VARIABLE: 'i'}, inputs: {VALUE: 0}},
            {
                opcode: 'control_repeat',
                inputs: {TIMES: BODIES},
                substack: [
                    {opcode: 'simulation_physicsAtBody', inputs: {NAME: bodyName}, substack: [shape]},
                    {opcode: 'data_changevariableby', fields: {VARIABLE: 'i'}, inputs: {VALUE: 1}}
                ]
            }
        ]
    }];
    return buildProject({
        costume,
        variables: {i: 0},
        scripts: [{
            hat: {opcode: 'simulation_whenInitialized', inputs: {NAME: 'boxes', START: 0, RATE: 120}},
            body: [
                {opcode: 'simulation_physicsCreateWorld', inputs: {GX: 0, GY: -980, GZ: 0}},
                {
                    opcode: 'simulation_physicsAddBody',
                    inputs: {NAME: 'floor',
                        SHAPE: 'plane',
                        PX: 0,
                        PY: -160,
                        PZ: 480,
                        RX: 0,
                        RY: 0,
                        RZ: 0,
                        SX: 1,
                        SY: 1,
                        SZ: 1,
                        TYPE: 'fixed',
                        MASS: 1,
                        RESTITUTION: 0.2,
                        FRICTION: 0.6}
                },
                {opcode: 'data_setvariableto', fields: {VARIABLE: 'i'}, inputs: {VALUE: 0}},
                {
                    opcode: 'control_repeat',
                    inputs: {TIMES: BODIES},
                    substack: [{
                        opcode: 'simulation_physicsAddBody',
                        inputs: {
                            NAME: bodyName,
                            SHAPE: 'box',
                            PX: reporter('operator_subtract', {
                                NUM1: reporter('operator_multiply', {
                                    NUM1: reporter('operator_mod', {NUM1: variable('i'), NUM2: 10}), NUM2: 36
                                }),
                                NUM2: 162
                            }),
                            PY: reporter('operator_add', {
                                NUM1: 40, NUM2: reporter('operator_multiply', {NUM1: variable('i'), NUM2: 3.7})
                            }),
                            PZ: 480,
                            RX: 0,
                            RY: 0,
                            RZ: reporter('operator_multiply', {NUM1: variable('i'), NUM2: 9}),
                            SX: 20,
                            SY: 20,
                            SZ: 20,
                            TYPE: 'dynamic',
                            MASS: 1,
                            RESTITUTION: 0.3,
                            FRICTION: 0.5
                        }
                    }, {opcode: 'data_changevariableby', fields: {VARIABLE: 'i'}, inputs: {VALUE: 1}}]
                }
            ]
        }, {
            hat: {opcode: 'simulation_whenStepped', inputs: {NAME: 'boxes'}},
            body: []
        }, {
            hat: 'event_renderframe',
            body: [{opcode: 'objects_clear'}, ...(motionBlur ? [{
                opcode: 'objects_motionBlur', inputs: {ANGLE: 180, PHASE: -90, SAMPLES: 8}, substack: drawBodies
            }] : drawBodies)]
        }]
    });
};

export {BODIES, physicsProject};
