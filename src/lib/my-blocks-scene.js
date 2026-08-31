// My Blocks Scene compiles a scene definition into the scene() function of
// the built-in ray-marching fragment shader and renders it through PenFX's
// existing custom shader engine.

/* eslint-disable no-console */

import {Color} from 'three';

import {
    DEFAULT_DEPTH,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    ROTATION_ORDERS,
    STUDIO_LIGHTING,
    normalizeLight
} from './model-runtime';
import {
    SCENE_MARKER,
    SHADER_COMPILER_HELPERS,
    ShaderExpressionCompiler,
    parseJSON,
    safeIdentifier
} from './my-blocks-shader';
import sceneFragmentShader, {SCENE_MAX_LIGHTS} from './my-blocks-scene-shader';

const SCENE_RETURN_OPCODE = 'myblocksscene_return';
const SCENE_GET_OPCODES = {
    myblocksscene_get_x: 'x',
    myblocksscene_get_y: 'y',
    myblocksscene_get_z: 'z'
};
const SCENE_RETURN_OPCODES = new Set([SCENE_RETURN_OPCODE]);
const SCENE_CATEGORY_CALLBACK = 'MY_BLOCKS_SCENE';
const SCENE_CREATE_CALLBACK = 'CREATE_MY_BLOCKS_SCENE';

class MyBlocksSceneExtension {
    getInfo () {
        return {
            id: SCENE_MARKER,
            name: 'My Blocks Scene',
            blocks: []
        };
    }
}

const sceneFunctionPattern = new RegExp(
    'bool\\s+sceneContains\\s*\\(\\s*vec3\\s+p\\s*\\)\\s*\\{[\\s\\S]*?\\n\\}' +
    '\\s*vec3\\s+scene\\s*\\(\\s*vec3\\s+p\\s*\\)\\s*' +
    '\\{[\\s\\S]*?\\n\\}'
);
// Kept out of the Blockly palette, but understood when loading projects made
// before the block was replaced by ordinary Scratch operators.
const LEGACY_SCENE_INSIDE_BOX_OPCODE = 'myblocksscene_inside_box';
const legacyInsideBoxCondition = (block, compiler) =>
    `all(lessThan(abs(p), vec3(${compiler.input(block, 'SIZE')})))`;
const SCENE_SPECIAL_CONDITIONS = {
    [LEGACY_SCENE_INSIDE_BOX_OPCODE]: legacyInsideBoxCondition
};
const SCENE_SPECIAL_EXPRESSIONS = Object.keys(SCENE_GET_OPCODES).reduce((result, opcode) => {
    result[opcode] = `p.${SCENE_GET_OPCODES[opcode]}`;
    return result;
}, {
    [LEGACY_SCENE_INSIDE_BOX_OPCODE]: (block, compiler) =>
        `(${legacyInsideBoxCondition(block, compiler)} ? 1.0 : 0.0)`
});

const colorToSceneRGB = value => {
    const color = new Color();
    try {
        color.set(value || 0xffffff);
        color.convertLinearToSRGB();
    } catch (error) {
        color.set(0xffffff);
    }
    return [
        Number.isFinite(color.r) ? color.r : 1,
        Number.isFinite(color.g) ? color.g : 1,
        Number.isFinite(color.b) ? color.b : 1
    ];
};

const sceneLightUniformNames = index => ({
    color: `u_scene_light_color_${index}`,
    params: `u_scene_light_params_${index}`,
    position: `u_scene_light_position_${index}`
});

class MyBlocksSceneManager {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.errors = new Set();
        this.compiledScenes = new Map();
        this.definitionIndexes = new WeakMap();
        this.registeredPrograms = new Map();
        if (vm && typeof vm.on === 'function') {
            vm.on('project-loaded', () => this.errors.clear());
        }
    }

    _prototypeMatches (prototype, sceneId, userProcCode) {
        const mutation = prototype && prototype.mutation;
        if (!mutation || mutation[SCENE_MARKER] !== 'true') return false;
        return Boolean((sceneId && mutation.sceneid === sceneId) ||
            (userProcCode && mutation.sceneuserproccode === userProcCode));
    }

    _scanForPrototype (blocks, sceneId, userProcCode) {
        for (const block of Object.values(blocks)) {
            if (block.opcode !== 'procedures_prototype' || !block.mutation) continue;
            if (this._prototypeMatches(block, sceneId, userProcCode)) return block;
        }
        return null;
    }

    _definitionFromPrototype (blocks, prototype) {
        if (!prototype) return null;
        const definition = blocks[prototype.parent];
        return definition && definition.opcode === 'procedures_definition' ? definition : null;
    }

    _findDefinition (target, sceneId, userProcCode) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) return null;
        let index = this.definitionIndexes.get(blocks);
        if (!index) {
            index = {byCode: new Map(), byId: null};
            this.definitionIndexes.set(blocks, index);
        }
        let prototype;
        if (sceneId) {
            if (!this._prototypeMatches(index.byId, sceneId, null)) index.byId = null;
            if (!index.byId) index.byId = this._scanForPrototype(blocks, sceneId, null);
            prototype = index.byId;
        } else {
            prototype = index.byCode.get(userProcCode);
            if (!this._prototypeMatches(prototype, null, userProcCode)) {
                prototype = this._scanForPrototype(blocks, null, userProcCode);
                index.byCode.set(userProcCode, prototype);
            }
        }
        return this._definitionFromPrototype(blocks, prototype);
    }

    _findReturn (blocks, definition) {
        let id = definition && definition.next;
        while (id) {
            const block = blocks[id];
            if (!block) return null;
            if (SCENE_RETURN_OPCODES.has(block.opcode)) return {block, id};
            id = block.next;
        }
        return null;
    }

    _definitionSignature (blocks, startId, parts) {
        const block = blocks[startId];
        if (!block) {
            parts.push('<missing>');
            return;
        }
        parts.push(block.opcode || '');
        if (block.mutation) parts.push(JSON.stringify(block.mutation));
        if (block.fields) parts.push(JSON.stringify(block.fields));
        if (block.inputs) {
            for (const name of Object.keys(block.inputs)) {
                const input = block.inputs[name];
                parts.push(name);
                this._definitionSignature(blocks, input && input.block, parts);
                this._definitionSignature(blocks, input && input.shadow, parts);
            }
        }
        if (block.next) {
            parts.push('->');
            this._definitionSignature(blocks, block.next, parts);
        }
    }

    _source (definition, returnInfo, compiler, argumentUniformNames) {
        const returnBlock = returnInfo.block;
        const statements = compiler.statements(definition.next, returnInfo.id);
        const condition = compiler.condition(returnBlock, 'CONDITION');
        const color = `vec3(${compiler.input(returnBlock, 'R')}, ` +
            `${compiler.input(returnBlock, 'G')}, ${compiler.input(returnBlock, 'B')})`;
        const variables = Array.from(compiler.variables.keys())
            .map(name => `float ${name};`)
            .join('\n');
        const variableInitializers = Array.from(compiler.variables.entries())
            .map(([name, uniform]) => `    ${name} = ${uniform};`)
            .join('\n');
        const functions = Array.from(compiler.functions.values()).join('\n\n');
        const evaluation = [
            '    cx = p.x;\n    cy = p.y;',
            variableInitializers,
            statements
        ].filter(Boolean).join('\n');
        const sceneContainsFunction = `bool sceneContains(vec3 p) {\n${evaluation}\n    return ${condition};\n}`;
        const sceneFunction = `vec3 scene(vec3 p) {\n    return sceneContains(p) ? ${color} : vec3(0.0);\n}`;
        if (!sceneFunctionPattern.test(sceneFragmentShader)) {
            throw new Error('The built-in scene shader is missing vec3 scene(vec3 p).');
        }
        const externalUniformNames = Array.from(compiler.externalUniforms.keys());
        const declarations = argumentUniformNames.concat(externalUniformNames)
            .map(name => `uniform float ${name};`)
            .join('\n');
        const compilerPrelude = [variables, SHADER_COMPILER_HELPERS, functions]
            .filter(Boolean).join('\n\n');
        const generatedScene = [compilerPrelude, sceneContainsFunction, sceneFunction]
            .filter(Boolean).join('\n\n');
        return sceneFragmentShader
            .replace(sceneFunctionPattern, generatedScene)
            .replace('uniform vec3 camrot;', `uniform vec3 camrot;\nuniform float u_random_seed;\n` +
                `float cx;\nfloat cy;\n${declarations}`);
    }

    _compileDefinition (blocks, definition) {
        const signatureParts = [];
        const prototypeId = definition.inputs && definition.inputs.custom_block &&
            definition.inputs.custom_block.block;
        this._definitionSignature(blocks, prototypeId, signatureParts);
        this._definitionSignature(blocks, definition.next, signatureParts);
        const signature = signatureParts.join('\u0000');
        let compiled = this.compiledScenes.get(signature);
        if (compiled) return compiled;

        const prototype = blocks[prototypeId];
        if (!prototype || !prototype.mutation || prototype.mutation[SCENE_MARKER] !== 'true') {
            throw new Error('A scene definition needs a My Blocks Scene prototype.');
        }
        const returnInfo = this._findReturn(blocks, definition);
        if (!returnInfo) throw new Error('A scene definition needs a return color block.');

        const userNames = parseJSON(prototype.mutation.sceneuserargumentnames);
        const userIds = parseJSON(prototype.mutation.sceneuserargumentids);
        // Scene and Shader use one expression compiler. The only Scene-specific
        // part is the coordinate reporter mapping into the generated point p.
        const compiler = new ShaderExpressionCompiler(blocks, userNames, userIds, {
            specialArguments: {
                px: 'p.x',
                py: 'p.y',
                pz: 'p.z'
            },
            specialExpressions: SCENE_SPECIAL_EXPRESSIONS,
            specialConditions: SCENE_SPECIAL_CONDITIONS
        });
        const uniformNames = userIds.map(id => safeIdentifier(id));
        const source = this._source(definition, returnInfo, compiler, uniformNames);
        const sceneId = prototype.mutation.sceneid || prototype.mutation.sceneuserproccode || 'scene';
        compiled = {
            externalUniforms: compiler.externalUniforms,
            programName: `custom:myblocksscene:${safeIdentifier(sceneId, 'scene_')}`,
            source,
            uniformNames,
            userIds
        };
        if (this.compiledScenes.size >= 64) this.compiledScenes.clear();
        this.compiledScenes.set(signature, compiled);
        return compiled;
    }

    _findVariable (target, descriptor, type) {
        let variable = null;
        if (target && descriptor.id && typeof target.lookupVariableById === 'function') {
            variable = target.lookupVariableById(descriptor.id);
        }
        if (!variable && target && target.variables && descriptor.id) variable = target.variables[descriptor.id];
        if (!variable && target && typeof target.lookupVariableByNameAndType === 'function') {
            variable = target.lookupVariableByNameAndType(descriptor.scratchName, type);
        }
        if (!variable && this.runtime && typeof this.runtime.getTargetForStage === 'function') {
            const stage = this.runtime.getTargetForStage();
            if (stage && descriptor.id && stage.variables) variable = stage.variables[descriptor.id];
            if (!variable && stage && typeof stage.lookupVariableByNameAndType === 'function') {
                variable = stage.lookupVariableByNameAndType(descriptor.scratchName, type, true);
            }
        }
        return variable;
    }

    _number (value) {
        if (value === true) return 1;
        if (value === false || value === null || value === '') return 0;
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    _listValue (descriptor, target) {
        const variable = this._findVariable(target, descriptor, 'list');
        const list = variable && Array.isArray(variable.value) ? variable.value :
            (Array.isArray(variable) && Array.isArray(variable[1]) ? variable[1] : []);
        switch (descriptor.operation) {
        case 'length':
            return list.length;
        case 'item': {
            const requested = descriptor.extra.index;
            const index = requested === 'last' ? list.length - 1 : Math.floor(Number(requested)) - 1;
            return index >= 0 && index < list.length ? this._number(list[index]) : 0;
        }
        case 'indexOf':
        case 'contains': {
            const expected = descriptor.extra.item;
            const expectedNumber = Number(expected);
            const index = list.findIndex(value => {
                const number = Number(value);
                if (!Number.isNaN(expectedNumber) && !Number.isNaN(number)) return number === expectedNumber;
                return String(value).toLowerCase() === String(expected).toLowerCase();
            });
            return descriptor.operation === 'contains' ? (index === -1 ? 0 : 1) : index + 1;
        }
        default:
            return 0;
        }
    }

    _reporterValue (descriptor, util) {
        const primitive = this.runtime._primitives && this.runtime._primitives[descriptor.opcode];
        if (typeof primitive === 'function') {
            try {
                const result = primitive(Object.assign({}, descriptor.args), util);
                if (!result || typeof result.then !== 'function') return this._number(result);
            } catch (error) {
                // Property fallbacks below cover minimal runtimes and embedders.
            }
        }
        const target = util && util.target;
        const io = this.runtime.ioDevices || {};
        switch (descriptor.opcode) {
        case 'motion_xposition': return this._number(target && target.x);
        case 'motion_yposition': return this._number(target && target.y);
        case 'motion_direction': return this._number(target && target.direction);
        case 'looks_size': return this._number(target && target.size);
        case 'sound_volume': return this._number(target && target.volume);
        case 'sensing_timer':
            return this._number(io.clock && io.clock.projectTimer && io.clock.projectTimer());
        case 'sensing_mousex':
            return this._number(io.mouse && io.mouse.getScratchX && io.mouse.getScratchX());
        case 'sensing_mousey':
            return this._number(io.mouse && io.mouse.getScratchY && io.mouse.getScratchY());
        case 'sensing_mousedown':
            return this._number(io.mouse && io.mouse.getIsDown && io.mouse.getIsDown());
        case 'sensing_keypressed':
            return this._number(io.keyboard && io.keyboard.getKeyIsDown &&
                io.keyboard.getKeyIsDown(descriptor.args.KEY_OPTION));
        case 'sensing_current': {
            const date = new Date();
            const values = {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                date: date.getDate(),
                dayofweek: date.getDay() + 1,
                hour: date.getHours(),
                minute: date.getMinutes(),
                second: date.getSeconds()
            };
            return values[String(descriptor.args.CURRENTMENU).toLowerCase()] || 0;
        }
        case 'sensing_dayssince2000':
            return (Date.now() - new Date(2000, 0, 1).valueOf()) / (24 * 60 * 60 * 1000);
        case 'sensing_online':
            return typeof navigator === 'object' && navigator.onLine ? 1 : 0;
        default:
            return 0;
        }
    }

    _externalUniformValue (descriptor, util) {
        if (descriptor.kind === 'var') {
            const variable = this._findVariable(util.target, descriptor, '');
            const value = variable && Object.prototype.hasOwnProperty.call(variable, 'value') ? variable.value :
                (Array.isArray(variable) ? variable[1] : 0);
            return this._number(value);
        }
        if (descriptor.kind === 'list') return this._listValue(descriptor, util.target);
        if (descriptor.kind === 'reporter') return this._reporterValue(descriptor, util);
        return 0;
    }

    _timelineTime () {
        const timeline = this.runtime && this.runtime.movieAssetManager &&
            this.runtime.movieAssetManager.timeline;
        const currentTime = timeline && Number(timeline.currentTime);
        return Number.isFinite(currentTime) ? currentTime : 0;
    }

    _timelineFrame () {
        const timeline = this.runtime && this.runtime.movieAssetManager &&
            this.runtime.movieAssetManager.timeline;
        const frameRate = timeline && Number(timeline.framerate);
        return Math.round(this._timelineTime() * (Number.isFinite(frameRate) ? frameRate : 30));
    }

    _cameraUniforms () {
        const manager = this.runtime && this.runtime.movieAssetManager;
        const camera = manager && manager.camera;
        const position = (camera && camera.position) || {};
        const rotation = (camera && camera.rotation) || {};
        const rotationOrder = camera && ROTATION_ORDERS.indexOf(camera.rotationOrder);
        return {
            // Scene uses the same -Z-forward basis as the source fragment
            // shader and Three.js. Camera blocks remain Movie +Z-forward, so
            // reflect the position around Z at this boundary.
            campos: [this._number(position.x), this._number(position.y), -this._number(position.z)],
            camrot: [this._number(rotation.x), this._number(rotation.y), this._number(rotation.z)],
            camfocal: this._number(camera && camera.focalLength) || DEFAULT_FOCAL_LENGTH,
            camrotorder: rotationOrder >= 0 ? rotationOrder : 0
        };
    }

    _sceneViewportUniform () {
        const manager = this.runtime && this.runtime.movieAssetManager;
        const stageSize = manager && typeof manager.getStageSize === 'function' ? manager.getStageSize() : null;
        return [
            this._number(stageSize && stageSize[0]) || DEFAULT_STAGE_WIDTH,
            this._number(stageSize && stageSize[1]) || DEFAULT_STAGE_HEIGHT
        ];
    }

    _sceneLightingUniforms () {
        const manager = this.runtime && this.runtime.movieAssetManager;
        const requestedLights = manager && Array.isArray(manager.lights) ? manager.lights : null;
        const lights = [];
        let ambient = null;

        if (requestedLights === null) {
            ambient = STUDIO_LIGHTING.hemisphere;
            STUDIO_LIGHTING.directional.forEach(light => {
                lights.push({
                    color: colorToSceneRGB(light.color),
                    intensity: light.intensity,
                    params: [2, 0, 0, 0],
                    position: [light.position.x, light.position.y, light.position.z],
                    radius: 0
                });
            });
        } else {
            requestedLights.slice(0, SCENE_MAX_LIGHTS).forEach(light => {
                const normalized = normalizeLight(light);
                const position = normalized.position;
                lights.push({
                    color: colorToSceneRGB(normalized.color),
                    intensity: normalized.intensity,
                    params: [normalized.type === 'spot' ? 1 : 0, normalized.angle, normalized.shadow, 0],
                    position: [position.x, position.y, -position.z],
                    radius: normalized.radius
                });
            });
        }

        const ambientSky = ambient ? colorToSceneRGB(ambient.skyColor) : [0, 0, 0];
        const ambientGround = ambient ? colorToSceneRGB(ambient.groundColor) : [0, 0, 0];
        const ambientDirection = ambient ? [
            ambient.direction.x,
            ambient.direction.y,
            -ambient.direction.z
        ] : [0, 1, 0];
        const uniforms = {
            u_scene_ambient_direction: ambientDirection,
            u_scene_ambient_ground: ambientGround,
            u_scene_ambient_intensity: ambient ? ambient.intensity : 0,
            u_scene_ambient_sky: ambientSky,
            u_scene_light_count: lights.length,
            u_scene_spot_target: [0, 0, -DEFAULT_DEPTH]
        };

        for (let index = 0; index < SCENE_MAX_LIGHTS; index++) {
            const names = sceneLightUniformNames(index);
            const light = lights[index];
            uniforms[names.position] = light ? [
                light.position[0], light.position[1], light.position[2], light.radius
            ] : [0, 0, 0, 0];
            uniforms[names.color] = light ? [
                light.color[0], light.color[1], light.color[2], light.intensity
            ] : [0, 0, 0, 0];
            uniforms[names.params] = light ? light.params : [0, 0, 0, 0];
        }
        return uniforms;
    }

    _getPenFXEngine () {
        const penFX = this.runtime && this.runtime.penFX;
        if (!penFX) return null;
        if (typeof penFX._getEngine === 'function') return penFX._getEngine();
        return penFX.engine || null;
    }

    _registerProgram (engine, compiled) {
        if (!engine || typeof engine.registerCustomShader !== 'function') return;
        const registered = this.registeredPrograms.get(compiled.programName);
        if (registered && registered.engine === engine && registered.source === compiled.source) return;
        engine.registerCustomShader(compiled.programName, compiled.source);
        this.registeredPrograms.set(compiled.programName, {engine, source: compiled.source});
    }

    _applyDefinition (definition, values, util) {
        try {
            const blocks = util.target.blocks._blocks;
            const compiled = this._compileDefinition(blocks, definition);
            const uniforms = Object.assign({
                u_resolution: [0, 0],
                u_time: this._timelineTime(),
                u_frame: this._timelineFrame(),
                u_random_seed: this._timelineFrame()
            }, this._cameraUniforms(), {
                u_scene_viewport: this._sceneViewportUniform()
            }, this._sceneLightingUniforms());
            for (let i = 0; i < compiled.userIds.length; i++) {
                const value = Number(values[compiled.userIds[i]]);
                uniforms[compiled.uniformNames[i]] = Number.isFinite(value) ? value : 0;
            }
            for (const [name, descriptor] of compiled.externalUniforms) {
                uniforms[name] = this._externalUniformValue(descriptor, util);
            }

            const engine = this._getPenFXEngine();
            if (!engine) throw new Error('PenFX is not available for My Blocks Scene.');
            this._registerProgram(engine, compiled);
            const penFX = this.runtime.penFX;
            const blendMode = (penFX && penFX.blendMode) || 'normal';
            const render = renderEngine => renderEngine.customShader(
                compiled.programName,
                uniforms,
                ['u_frame', 'camrotorder', 'u_scene_light_count'],
                blendMode
            );
            if (penFX && typeof penFX._safe === 'function') penFX._safe(render);
            else render(engine);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (!this.errors.has(message)) {
                this.errors.add(message);
                console.error('[My Blocks Scene]', error);
            }
        }
        // Scene command calls must never return a Promise or yield the VM.
        return;
    }

    call (args, util) {
        const mutation = args && args.mutation;
        const definition = this._findDefinition(
            util && util.target,
            mutation && mutation.sceneid,
            mutation && mutation.sceneuserproccode
        );
        if (!definition) return;
        return this._applyDefinition(definition, args || {}, util);
    }

    callProcedure (procedureCode, params, util) {
        const definition = this._findDefinition(util && util.target, null, procedureCode);
        if (!definition) return;
        const blocks = util.target.blocks._blocks;
        const prototype = blocks[definition.inputs.custom_block.block];
        const names = parseJSON(prototype.mutation.sceneuserargumentnames);
        const ids = parseJSON(prototype.mutation.sceneuserargumentids);
        const values = {};
        const suppliedParams = params || {};
        for (let i = 0; i < ids.length; i++) values[ids[i]] = suppliedParams[names[i]];
        return this._applyDefinition(definition, values, util);
    }

    getAddonBlock (procedureCode) {
        const targets = this.runtime.targets || [];
        for (const target of targets) {
            const definition = this._findDefinition(target, null, procedureCode);
            if (!definition) continue;
            const blocks = target.blocks._blocks;
            const prototype = blocks[definition.inputs.custom_block.block];
            const names = parseJSON(prototype.mutation.sceneuserargumentnames);
            const ids = parseJSON(prototype.mutation.sceneuserargumentids);
            const defaults = parseJSON(prototype.mutation.sceneuserargumentdefaults);
            return {
                namesIdsDefaults: [names, ids, defaults],
                myBlocksScene: true,
                callback: (params, util) => this.callProcedure(procedureCode, params, util)
            };
        }
        return null;
    }

    returnColor () {
        return;
    }

    getCoordinate () {
        return 0;
    }

    legacyInsideBox () {
        return false;
    }

}

const installMyBlocksScene = vm => {
    if (vm.runtime.myBlocksSceneManager) return vm.runtime.myBlocksSceneManager;
    const manager = new MyBlocksSceneManager(vm);
    vm.runtime.myBlocksSceneManager = manager;
    vm.runtime._primitives[SCENE_RETURN_OPCODE] = manager.returnColor.bind(manager);
    // The old block is intentionally not defined in the palette. This
    // primitive only keeps already-saved projects loadable and executable.
    vm.runtime._primitives[LEGACY_SCENE_INSIDE_BOX_OPCODE] = manager.legacyInsideBox.bind(manager);
    for (const opcode of Object.keys(SCENE_GET_OPCODES)) {
        vm.runtime._primitives[opcode] = manager.getCoordinate.bind(manager);
    }

    const originalGetAddonBlock = vm.runtime.getAddonBlock.bind(vm.runtime);
    vm.runtime.getAddonBlock = procedureCode => (
        originalGetAddonBlock(procedureCode) || manager.getAddonBlock(procedureCode)
    );

    const extensionManager = vm.extensionManager;
    if (extensionManager &&
        typeof extensionManager.addBuiltinExtension === 'function' &&
        typeof extensionManager.loadExtensionIdSync === 'function') {
        if (!extensionManager.isBuiltinExtension(SCENE_MARKER)) {
            extensionManager.addBuiltinExtension(SCENE_MARKER, MyBlocksSceneExtension);
        }
        if (!extensionManager.isExtensionLoaded(SCENE_MARKER)) {
            extensionManager.loadExtensionIdSync(SCENE_MARKER);
        }
    }
    return manager;
};

export {
    SCENE_CATEGORY_CALLBACK,
    SCENE_CREATE_CALLBACK,
    SCENE_GET_OPCODES,
    SCENE_MARKER,
    SCENE_RETURN_OPCODE,
    MyBlocksSceneManager,
    installMyBlocksScene as default
};
