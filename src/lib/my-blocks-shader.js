// My Blocks Shader compiles a deliberately small, numeric subset of Scratch
// reporter blocks to GLSL and applies it to the pen framebuffer in one pass.
// The source is copied before drawing so every get r/g/b sample observes the
// image as it was before this block started.

/* eslint-disable no-console */

const SHADER_MARKER = 'myblocksshader';
const SHADER_CALL_OPCODE = 'procedures_call';
const SHADER_RETURN_OPCODE = 'myblocksshader_return';
const SHADER_GET_OPCODES = {
    myblocksshader_get_r: 'r',
    myblocksshader_get_g: 'g',
    myblocksshader_get_b: 'b'
};

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const numberLiteral = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0.0';
    if (Object.is(number, -0)) return '0.0';
    const text = String(number);
    return /[.eE]/.test(text) ? text : `${text}.0`;
};

const parseJSON = (value, fallback = []) => {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
};

const safeIdentifier = value => {
    const sanitized = String(value)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `u_arg_${sanitized || 'value'}`;
};

const blockField = (block, name, fallback = '') => {
    const field = block && block.fields && block.fields[name];
    return field && field.value !== undefined ? field.value : fallback;
};

class ShaderExpressionCompiler {
    constructor (blocks, argumentNames, argumentIds) {
        this.blocks = blocks;
        this.argumentUniforms = new Map();
        for (let i = 0; i < argumentIds.length; i++) {
            this.argumentUniforms.set(argumentNames[i], safeIdentifier(argumentIds[i]));
        }
    }

    input (block, name, fallback = '0.0') {
        if (!block || !block.inputs || !block.inputs[name]) return fallback;
        const input = block.inputs[name];
        return this.expression(input.block || input.shadow, fallback);
    }

    binary (block, left, operator, right, fallback) {
        return `((${this.input(block, left, fallback)}) ${operator} (${this.input(block, right, fallback)}))`;
    }

    expression (blockId, fallback = '0.0') {
        const block = blockId && this.blocks[blockId];
        if (!block) return fallback;

        switch (block.opcode) {
        case 'math_number':
        case 'math_integer':
        case 'math_whole_number':
        case 'math_positive_number':
        case 'math_angle':
            return numberLiteral(blockField(block, 'NUM', 0));
        case 'text':
            return numberLiteral(blockField(block, 'TEXT', 0));
        case 'argument_reporter_string_number':
        case 'argument_reporter_boolean': {
            const name = String(blockField(block, 'VALUE'));
            if (name === 'cx') return 'cx';
            if (name === 'cy') return 'cy';
            return this.argumentUniforms.get(name) || '0.0';
        }
        case 'operator_add':
            return this.binary(block, 'NUM1', '+', 'NUM2', '0.0');
        case 'operator_subtract':
            return this.binary(block, 'NUM1', '-', 'NUM2', '0.0');
        case 'operator_multiply':
            return this.binary(block, 'NUM1', '*', 'NUM2', '0.0');
        case 'operator_divide':
            return `((${this.input(block, 'NUM1')}) / shaderSafeDivisor(${this.input(block, 'NUM2')}))`;
        case 'operator_mod':
            return `mod((${this.input(block, 'NUM1')}), shaderSafeDivisor(${this.input(block, 'NUM2')}))`;
        case 'operator_round':
            return `floor((${this.input(block, 'NUM')}) + 0.5)`;
        case 'operator_lt':
            return `((${this.input(block, 'OPERAND1')}) < (${this.input(block, 'OPERAND2')}) ? 1.0 : 0.0)`;
        case 'operator_gt':
            return `((${this.input(block, 'OPERAND1')}) > (${this.input(block, 'OPERAND2')}) ? 1.0 : 0.0)`;
        case 'operator_equals':
            return `(abs((${this.input(block, 'OPERAND1')}) - (${this.input(block, 'OPERAND2')})) < 0.000001 ? 1.0 : 0.0)`;
        case 'operator_and':
            return `(((${this.input(block, 'OPERAND1')}) != 0.0 && (${this.input(block, 'OPERAND2')}) != 0.0) ? 1.0 : 0.0)`;
        case 'operator_or':
            return `(((${this.input(block, 'OPERAND1')}) != 0.0 || (${this.input(block, 'OPERAND2')}) != 0.0) ? 1.0 : 0.0)`;
        case 'operator_not':
            return `((${this.input(block, 'OPERAND')}) == 0.0 ? 1.0 : 0.0)`;
        case 'operator_mathop':
            return this.mathOperation(block);
        case 'operator_random': {
            const from = this.input(block, 'FROM');
            const to = this.input(block, 'TO');
            return `mix((${from}), (${to}), shaderHash(vec2(cx, cy)))`;
        }
        default:
            if (Object.prototype.hasOwnProperty.call(SHADER_GET_OPCODES, block.opcode)) {
                const channel = SHADER_GET_OPCODES[block.opcode];
                return `shaderSample(${this.input(block, 'X')}, ${this.input(block, 'Y')}).${channel}`;
            }
            throw new Error(`Unsupported block in shader expression: ${block.opcode}`);
        }
    }

    mathOperation (block) {
        const value = this.input(block, 'NUM');
        switch (String(blockField(block, 'OPERATOR')).toLowerCase()) {
        case 'abs': return `abs(${value})`;
        case 'floor': return `floor(${value})`;
        case 'ceiling': return `ceil(${value})`;
        case 'sqrt': return `sqrt(max(${value}, 0.0))`;
        case 'sin': return `sin(radians(${value}))`;
        case 'cos': return `cos(radians(${value}))`;
        case 'tan': return `tan(radians(${value}))`;
        case 'asin': return `degrees(asin(clamp(${value}, -1.0, 1.0)))`;
        case 'acos': return `degrees(acos(clamp(${value}, -1.0, 1.0)))`;
        case 'atan': return `degrees(atan(${value}))`;
        case 'ln': return `log(max(${value}, 0.000001))`;
        case 'log': return `(log(max(${value}, 0.000001)) / log(10.0))`;
        case 'e ^': return `exp(${value})`;
        case '10 ^': return `pow(10.0, ${value})`;
        default: return value;
        }
    }
}

class MyBlocksShaderEngine {
    constructor (renderer) {
        this.renderer = renderer;
        this.gl = renderer && (renderer._gl || renderer.gl);
        this.vertexShader = null;
        this.quad = null;
        this.width = 0;
        this.height = 0;
        this.sourceTexture = null;
        this.sourceFramebuffer = null;
        this.programs = new Map();
        this.locations = new WeakMap();
        this.positions = new WeakMap();
    }

    _initialize () {
        const gl = this.gl;
        if (!gl || this.vertexShader) return Boolean(gl);
        this.vertexShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1
        ]), gl.STATIC_DRAW);
        return true;
    }

    _compileShader (type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || 'Unknown GLSL compile error';
            gl.deleteShader(shader);
            throw new Error(message);
        }
        return shader;
    }

    _program (source) {
        if (this.programs.has(source)) return this.programs.get(source);
        const gl = this.gl;
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, source);
        const program = gl.createProgram();
        try {
            gl.attachShader(program, this.vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
        } finally {
            gl.deleteShader(fragmentShader);
        }
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || 'Unknown GLSL link error';
            gl.deleteProgram(program);
            throw new Error(message);
        }
        this.programs.set(source, program);
        return program;
    }

    _penSkin () {
        const id = this.renderer && this.renderer._penSkinId;
        return id === null || id === undefined ? null : this.renderer._allSkins[id];
    }

    _resize (width, height) {
        if (this.width === width && this.height === height) return;
        const gl = this.gl;
        if (this.sourceFramebuffer) gl.deleteFramebuffer(this.sourceFramebuffer);
        if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
        this.width = width;
        this.height = height;
        this.sourceTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.sourceFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sourceTexture, 0);
    }

    _location (program, name) {
        let map = this.locations.get(program);
        if (!map) {
            map = new Map();
            this.locations.set(program, map);
        }
        if (!map.has(name)) map.set(name, this.gl.getUniformLocation(program, name));
        return map.get(name);
    }

    _position (program) {
        if (!this.positions.has(program)) {
            this.positions.set(program, this.gl.getAttribLocation(program, 'a_position'));
        }
        return this.positions.get(program);
    }

    _draw (program, framebuffer, texture, uniforms) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(program);
        const position = this._position(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this._location(program, 'u_image'), 0);
        const resolution = this._location(program, 'u_resolution');
        gl.uniform2f(resolution, this.width, this.height);
        for (const name of Object.keys(uniforms)) {
            gl.uniform1f(this._location(program, name), uniforms[name]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    apply (source, uniforms) {
        if (!this._initialize()) return;
        const skin = this._penSkin();
        if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return;
        const gl = this.gl;
        if (typeof this.renderer._doExitDrawRegion === 'function') this.renderer._doExitDrawRegion();
        this._resize(skin._size[0], skin._size[1]);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);

        const copyProgram = this._program(`
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
void main() { gl_FragColor = texture2D(u_image, v_uv); }`);
        this._draw(copyProgram, this.sourceFramebuffer, skin._texture, {});
        const target = skin._framebuffer.framebuffer || skin._framebuffer;
        this._draw(this._program(source), target, this.sourceTexture, uniforms);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        skin._silhouetteDirty = true;
        if (typeof skin.emitWasAltered === 'function') skin.emitWasAltered();
        this.renderer.dirty = true;
    }
}

class MyBlocksShaderManager {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.engine = new MyBlocksShaderEngine(this.runtime.renderer);
        this.errors = new Set();
    }

    _findDefinition (target, shaderId, userProcCode) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) return null;
        for (const block of Object.values(blocks)) {
            if (block.opcode !== 'procedures_prototype' || !block.mutation) continue;
            const matchesId = shaderId && block.mutation.shaderid === shaderId;
            const matchesCode = userProcCode && block.mutation.shaderuserproccode === userProcCode;
            if (block.mutation[SHADER_MARKER] === 'true' && (matchesId || matchesCode)) {
                const definition = blocks[block.parent];
                return definition && definition.opcode === 'procedures_definition' ? definition : null;
            }
        }
        return null;
    }

    _findReturn (blocks, definition) {
        let id = definition && definition.next;
        while (id) {
            const block = blocks[id];
            if (!block) return null;
            if (block.opcode === SHADER_RETURN_OPCODE) return block;
            id = block.next;
        }
        return null;
    }

    _source (returnBlock, compiler, uniformNames) {
        const red = compiler.input(returnBlock, 'R');
        const green = compiler.input(returnBlock, 'G');
        const blue = compiler.input(returnBlock, 'B');
        const declarations = uniformNames.map(name => `uniform float ${name};`).join('\n');
        return `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
${declarations}

float shaderSafeDivisor(float value) {
    return abs(value) < 0.000001 ? (value < 0.0 ? -0.000001 : 0.000001) : value;
}

float shaderHash(vec2 value) {
    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 shaderSample(float x, float y) {
    vec2 uv = vec2(x / u_resolution.x + 0.5, y / u_resolution.y + 0.5);
    vec4 pixel = texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
    return pixel.a > 0.00001 ? pixel.rgb * (255.0 / pixel.a) : vec3(0.0);
}

void main() {
    float cx = v_uv.x * u_resolution.x - u_resolution.x * 0.5;
    float cy = v_uv.y * u_resolution.y - u_resolution.y * 0.5;
    vec4 original = texture2D(u_image, v_uv);
    vec3 shaderColor = clamp(vec3(${red}, ${green}, ${blue}), 0.0, 255.0) / 255.0;
    gl_FragColor = vec4(shaderColor * original.a, original.a);
}`;
    }

    _applyDefinition (definition, values, util) {
        try {
            const blocks = util.target.blocks._blocks;
            const prototype = blocks[definition.inputs.custom_block.block];
            const returnBlock = this._findReturn(blocks, definition);
            if (!returnBlock) throw new Error('A shader definition needs a return RGB block.');

            const userNames = parseJSON(prototype.mutation.shaderuserargumentnames);
            const userIds = parseJSON(prototype.mutation.shaderuserargumentids);
            const compiler = new ShaderExpressionCompiler(blocks, userNames, userIds);
            const uniformNames = userIds.map(safeIdentifier);
            const uniforms = {};
            for (let i = 0; i < userIds.length; i++) {
                const value = Number(values[userIds[i]]);
                uniforms[uniformNames[i]] = Number.isFinite(value) ? value : 0;
            }
            this.engine.apply(this._source(returnBlock, compiler, uniformNames), uniforms);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (!this.errors.has(message)) {
                this.errors.add(message);
                console.error('[My Blocks Shader]', error);
            }
        }
        // Command primitives must never return a Promise or yield the VM.
        return undefined;
    }

    call (args, util) {
        const mutation = args && args.mutation;
        const definition = this._findDefinition(util.target, mutation && mutation.shaderid);
        if (!definition) return undefined;
        return this._applyDefinition(definition, args, util);
    }

    callProcedure (procedureCode, params, util) {
        const definition = this._findDefinition(util.target, null, procedureCode);
        if (!definition) return undefined;
        const blocks = util.target.blocks._blocks;
        const prototype = blocks[definition.inputs.custom_block.block];
        const names = parseJSON(prototype.mutation.shaderuserargumentnames);
        const ids = parseJSON(prototype.mutation.shaderuserargumentids);
        const values = {};
        for (let i = 0; i < ids.length; i++) values[ids[i]] = params[names[i]];
        return this._applyDefinition(definition, values, util);
    }

    getAddonBlock (procedureCode) {
        const targets = this.runtime.targets || [];
        for (const target of targets) {
            const definition = this._findDefinition(target, null, procedureCode);
            if (!definition) continue;
            const blocks = target.blocks._blocks;
            const prototype = blocks[definition.inputs.custom_block.block];
            const names = parseJSON(prototype.mutation.shaderuserargumentnames);
            const ids = parseJSON(prototype.mutation.shaderuserargumentids);
            const defaults = parseJSON(prototype.mutation.shaderuserargumentdefaults);
            return {
                namesIdsDefaults: [names, ids, defaults],
                // This uses the addon-procedure compiler path internally, but
                // it is a My Blocks family block and must not receive the
                // generic addon block colour in src/addons/api.js.
                myBlocksShader: true,
                callback: (params, util) => this.callProcedure(procedureCode, params, util)
            };
        }
        return null;
    }

    returnRGB () {
        return undefined;
    }

    getChannel () {
        return 0;
    }
}

const installMyBlocksShader = vm => {
    if (vm.runtime.myBlocksShaderManager) return vm.runtime.myBlocksShaderManager;
    const manager = new MyBlocksShaderManager(vm);
    vm.runtime.myBlocksShaderManager = manager;
    vm.runtime._primitives[SHADER_RETURN_OPCODE] = manager.returnRGB.bind(manager);
    for (const opcode of Object.keys(SHADER_GET_OPCODES)) {
        vm.runtime._primitives[opcode] = manager.getChannel.bind(manager);
    }
    const originalGetAddonBlock = vm.runtime.getAddonBlock.bind(vm.runtime);
    vm.runtime.getAddonBlock = procedureCode => (
        originalGetAddonBlock(procedureCode) || manager.getAddonBlock(procedureCode)
    );
    return manager;
};

export {
    SHADER_CALL_OPCODE,
    SHADER_GET_OPCODES,
    SHADER_MARKER,
    SHADER_RETURN_OPCODE,
    MyBlocksShaderManager,
    ShaderExpressionCompiler,
    installMyBlocksShader as default
};
