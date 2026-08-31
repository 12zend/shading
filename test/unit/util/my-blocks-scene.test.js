import installMyBlocksScene, {MyBlocksSceneManager} from '../../../src/lib/my-blocks-scene';
import {prepareSceneMutation, stripSceneCoordinates} from '../../../src/lib/my-blocks-scene-blocks';

const valueInput = block => ({name: '', block, shadow: block});

const makeTarget = () => {
    const blocks = {
        definition: {
            id: 'definition',
            opcode: 'procedures_definition',
            inputs: {custom_block: {block: 'prototype'}},
            next: 'return'
        },
        prototype: {
            id: 'prototype',
            opcode: 'procedures_prototype',
            parent: 'definition',
            mutation: {
                myblocksscene: 'true',
                sceneid: 'scene-id',
                sceneuserproccode: 'box',
                sceneuserargumentnames: '[]',
                sceneuserargumentids: '[]',
                sceneuserargumentdefaults: '[]',
                scenecoordinateids: '["px-id", "py-id", "pz-id"]'
            }
        },
        return: {
            id: 'return',
            opcode: 'myblocksscene_return',
            inputs: {
                CONDITION: valueInput('inside-x-y-z'),
                R: valueInput('red'),
                G: valueInput('green'),
                B: valueInput('blue')
            },
            next: null
        },
        'inside-x-y-z': {
            opcode: 'operator_and',
            inputs: {
                OPERAND1: valueInput('inside-x'),
                OPERAND2: valueInput('inside-y-z')
            }
        },
        'inside-y-z': {
            opcode: 'operator_and',
            inputs: {
                OPERAND1: valueInput('inside-y'),
                OPERAND2: valueInput('inside-z')
            }
        },
        'inside-x': {
            opcode: 'operator_lt',
            inputs: {OPERAND1: valueInput('abs-x'), OPERAND2: valueInput('size')}
        },
        'inside-y': {
            opcode: 'operator_lt',
            inputs: {OPERAND1: valueInput('abs-y'), OPERAND2: valueInput('size')}
        },
        'inside-z': {
            opcode: 'operator_lt',
            inputs: {OPERAND1: valueInput('abs-z'), OPERAND2: valueInput('size')}
        },
        'abs-x': {
            opcode: 'operator_mathop',
            fields: {OPERATOR: {value: 'abs'}},
            inputs: {NUM: valueInput('p-x')}
        },
        'abs-y': {
            opcode: 'operator_mathop',
            fields: {OPERATOR: {value: 'abs'}},
            inputs: {NUM: valueInput('p-y')}
        },
        'abs-z': {
            opcode: 'operator_mathop',
            fields: {OPERATOR: {value: 'abs'}},
            inputs: {NUM: valueInput('p-z')}
        },
        'p-x': {opcode: 'myblocksscene_get_x'},
        'p-y': {opcode: 'myblocksscene_get_y'},
        'p-z': {opcode: 'myblocksscene_get_z'},
        size: {opcode: 'math_number', fields: {NUM: {value: '0.65'}}},
        red: {opcode: 'math_number', fields: {NUM: {value: '0.95'}}},
        green: {opcode: 'math_number', fields: {NUM: {value: '0.18'}}},
        blue: {opcode: 'math_number', fields: {NUM: {value: '0.06'}}}
    };
    return {blocks: {_blocks: blocks}};
};

const makeVM = (target, engine) => ({
    runtime: {
        _primitives: {},
        getAddonBlock: jest.fn(() => null),
        movieAssetManager: {
            camera: {
                position: {x: 1, y: 2, z: 3},
                rotation: {x: 10, y: 20, z: 30}
            },
            timeline: {currentTime: 1.5, framerate: 24}
        },
        penFX: {
            _getEngine: () => engine,
            _safe: callback => callback(engine),
            blendMode: 'normal'
        },
        targets: [target]
    }
});

const makeMutation = attributes => ({
    attributes: Object.assign({}, attributes),
    cloneNode () {
        return makeMutation(this.attributes);
    },
    getAttribute (name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    setAttribute (name, value) {
        this.attributes[name] = String(value);
    }
});

describe('My Blocks Scene', () => {
    test('keeps the stable scene metadata while editing user-facing arguments', () => {
        const mutation = makeMutation({
            myblocksscene: 'true',
            sceneid: 'scene-id',
            sceneuserproccode: 'box %s',
            sceneuserargumentids: '["old-id"]',
            sceneuserargumentnames: '["size"]',
            sceneuserargumentdefaults: '["0.65"]',
            scenecoordinateids: '["px-id","py-id","pz-id"]',
            proccode: 'box %s %s %s %s',
            argumentids: '["old-id","px-id","py-id","pz-id"]',
            argumentnames: '["size","px","py","pz"]',
            argumentdefaults: '["0.65","0","0","0"]'
        });

        const edited = stripSceneCoordinates(mutation);
        edited.setAttribute('proccode', 'sphere %s %s');
        edited.setAttribute('argumentids', '["radius-id","color-id"]');
        edited.setAttribute('argumentnames', '["radius","color"]');
        edited.setAttribute('argumentdefaults', '["1","0"]');
        const prepared = prepareSceneMutation({
            Msg: {PROCEDURE_DEFAULT_NAME: 'scene'},
            utils: {genUid: jest.fn(() => 'new-id')}
        }, edited);

        expect(prepared.getAttribute('sceneid')).toBe('scene-id');
        expect(prepared.getAttribute('sceneuserproccode')).toBe('sphere %s %s');
        expect(prepared.getAttribute('sceneuserargumentids')).toBe('["radius-id","color-id"]');
        expect(prepared.getAttribute('sceneuserargumentnames')).toBe('["radius","color"]');
        expect(prepared.getAttribute('proccode')).toBe('sphere %s %s %s %s %s');
        expect(prepared.getAttribute('argumentids')).toBe('["radius-id","color-id","px-id","py-id","pz-id"]');
    });

    test('compiles operator-based occupancy into the built-in fragment shader and renders through PenFX', () => {
        const target = makeTarget();
        const engine = {
            customShader: jest.fn(),
            registerCustomShader: jest.fn()
        };
        const manager = new MyBlocksSceneManager(makeVM(target, engine));

        expect(manager.call({mutation: {sceneid: 'scene-id'}}, {target})).toBeUndefined();

        expect(engine.registerCustomShader).toHaveBeenCalledTimes(1);
        const [programName, source] = engine.registerCustomShader.mock.calls[0];
        expect(programName).toBe('custom:myblocksscene:scene_scene_id');
        expect(source).toContain('vec3 scene(vec3 p)');
        expect(source).toContain('bool sceneContains(vec3 p)');
        expect(source).toContain('abs(p.x)');
        expect(source).toContain('abs(p.y)');
        expect(source).toContain('abs(p.z)');
        expect(source).toContain(' ? vec3(0.95, 0.18, 0.06) : vec3(0.0);');
        expect(source).toContain('bool isOccupied(vec3 p)');
        expect(source).toContain('return sceneContains(p);');
        expect(source).toContain('void main()');
        expect(source).toContain('uniform vec3 campos;');
        expect(source).toContain('uniform vec3 camrot;');
        expect(source).toContain('uniform float camfocal;');
        expect(source).toContain('uniform int camrotorder;');
        expect(source).toContain('vec3 rayOrigin = campos;');
        expect(source).toContain('vec3 cameraDirection = vec3(');
        expect(source).toContain('uv.x * viewportHeight * 0.5');
        expect(source).toContain('-focalLength');
        expect(source).toContain('rotateCamera(cameraDirection, camrot, camrotorder)');
        expect(source).toContain("uv.y = -uv.y;");
        expect(source).toContain('const float TRACE_NEAR_DISTANCE = 32.0;');
        expect(source).toContain('const float TRACE_FAR_DISTANCE = 1000000.0;');
        expect(source).toContain('currentT = TRACE_NEAR_DISTANCE * pow(');
        expect(source).not.toContain('const vec3 SCENE_MIN');
        expect(source).not.toContain('const vec3 SCENE_MAX');
        expect(source).toContain('sceneLighting');
        expect(source).not.toContain('vec3(-0.6, 0.8, 1.0)');
        expect(source).not.toContain('shadowVisibility(');
        expect(source).toContain('vec4 scenePixel = hit.found ? vec4(pixel, 1.0) : vec4(0.0);');
        expect(source).toContain('gl_FragColor = scenePixel + original * (1.0 - scenePixel.a);');

        expect(engine.customShader).toHaveBeenCalledTimes(1);
        const [renderedProgram, uniforms, integerUniforms, blendMode] = engine.customShader.mock.calls[0];
        expect(renderedProgram).toBe(programName);
        expect(integerUniforms).toEqual(['u_frame', 'camrotorder', 'u_scene_light_count']);
        expect(blendMode).toBe('normal');
        expect(uniforms).toEqual(expect.objectContaining({
            campos: [1, 2, -3],
            camrot: [10, 20, 30],
            camfocal: 480,
            camrotorder: 0,
            u_scene_light_count: 2,
            u_scene_viewport: [480, 360],
            u_time: 1.5,
            u_frame: 36
        }));
    });

    test('passes authored Objects lights and the configured camera projection to Scene', () => {
        const target = makeTarget();
        const engine = {
            customShader: jest.fn(),
            registerCustomShader: jest.fn()
        };
        const vm = makeVM(target, engine);
        vm.runtime.movieAssetManager.camera.focalLength = 600;
        vm.runtime.movieAssetManager.camera.rotationOrder = 'ZYX';
        vm.runtime.movieAssetManager.getStageSize = () => [800, 600];
        vm.runtime.movieAssetManager.lights = [{
            angle: 35,
            color: '#ffffff',
            intensity: 3,
            position: {x: 10, y: 20, z: 30},
            radius: 800,
            shadow: 0.25,
            type: 'spot'
        }];
        const manager = new MyBlocksSceneManager(vm);

        expect(manager.call({mutation: {sceneid: 'scene-id'}}, {target})).toBeUndefined();

        const uniforms = engine.customShader.mock.calls[0][1];
        expect(uniforms).toEqual(expect.objectContaining({
            camfocal: 600,
            camrotorder: 5,
            u_scene_light_count: 1,
            u_scene_viewport: [800, 600],
            u_scene_ambient_intensity: 0,
            u_scene_light_position_0: [10, 20, -30, 800],
            u_scene_light_params_0: [1, 35, 0.25, 0]
        }));
        expect(uniforms.u_scene_light_color_0.slice(0, 3)).toEqual([
            expect.closeTo(1),
            expect.closeTo(1),
            expect.closeTo(1)
        ]);
        expect(uniforms.u_scene_light_color_0[3]).toBe(3);
    });

    test('maps scene coordinate reporters to the generated point expression', () => {
        const target = makeTarget();
        target.blocks._blocks.red = {opcode: 'myblocksscene_get_x'};
        const engine = {
            customShader: jest.fn(),
            registerCustomShader: jest.fn()
        };
        const manager = new MyBlocksSceneManager(makeVM(target, engine));

        expect(manager.call({mutation: {sceneid: 'scene-id'}}, {target})).toBeUndefined();
        const source = engine.registerCustomShader.mock.calls[0][1];
        expect(source).toContain('vec3(p.x, 0.18, 0.06)');
    });

    test('caches the compiled scene while still applying every call', () => {
        const target = makeTarget();
        const engine = {
            customShader: jest.fn(),
            registerCustomShader: jest.fn()
        };
        const manager = new MyBlocksSceneManager(makeVM(target, engine));
        const util = {target};

        manager.call({mutation: {sceneid: 'scene-id'}}, util);
        manager.call({mutation: {sceneid: 'scene-id'}}, util);

        expect(manager.compiledScenes.size).toBe(1);
        expect(engine.registerCustomShader).toHaveBeenCalledTimes(1);
        expect(engine.customShader).toHaveBeenCalledTimes(2);
    });

    test('registers scene primitives and addon callbacks without yielding', () => {
        const target = makeTarget();
        const engine = {
            customShader: jest.fn(),
            registerCustomShader: jest.fn()
        };
        const vm = makeVM(target, engine);
        const manager = installMyBlocksScene(vm);

        expect(vm.runtime._primitives.myblocksscene_return({}, {})).toBeUndefined();
        expect(vm.runtime._primitives.myblocksscene_inside_box({}, {})).toBe(false);
        expect(vm.runtime._primitives.myblocksscene_get_x({}, {})).toBe(0);
        expect(vm.runtime.getAddonBlock('box').myBlocksScene).toBe(true);
        expect(vm.runtime.getAddonBlock('box').callback({}, {target})).toBeUndefined();
        expect(engine.customShader).toHaveBeenCalledTimes(1);
        expect(manager).toBe(vm.runtime.myBlocksSceneManager);
        expect(vm.runtime.getAddonBlock('box').callback({}, {target})).not.toBeInstanceOf(Promise);
    });
});
