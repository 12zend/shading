/* eslint-disable */
import GenshadeCompute from './compute';
import webglSource from './webgl-source';
import {getGenshade} from './assets';

const glName = name => name.replace(/__/g, '_x').replace(/_$/, '_x');
const floatFormats = new Set([2, 10, 11, 16, 34, 41, 54, 56]);
const wrap = (gl, mode) => mode === 1 ? gl.REPEAT : mode === 2 ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;

class GenshadeRenderer {
    constructor(engine) {
        this.engine = engine;
        this.gl = engine.gl;
        this.effects = new Map();
        this.images = new Map();
        this.gl.getExtension('EXT_color_buffer_float');
        this.gl.getExtension('OES_texture_float_linear');
    }
    createTarget(width, height, format = 28, levels = 1) {
        const gl = this.gl;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // WebGL renderable counterparts. Normalized 16-bit formats use float textures.
        const internal = ({61:gl.R8, 54:gl.R16F, 56:gl.R16F, 41:gl.R32F,
            49:gl.RG8, 34:gl.RG16F, 35:gl.RG16F, 16:gl.RG32F, 24:gl.RGB10_A2,
            2:gl.RGBA32F, 10:gl.RGBA16F, 11:gl.RGBA16F})[format] || gl.RGBA8;
        gl.texStorage2D(gl.TEXTURE_2D, Math.min(levels, 1 + Math.floor(Math.log2(Math.max(width, height)))), internal, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture);
            throw new Error('This GPU cannot render the texture format required by Genshade.');
        }
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        return {texture, framebuffer, width, height, levels, format};
    }
    destroy(effect) {
        const gl = this.gl;
        for (const target of effect.targets.values()) {
            gl.deleteFramebuffer(target.framebuffer); gl.deleteTexture(target.texture);
        }
        for (const program of effect.programs.values()) gl.deleteProgram(program);
        if (effect.stencils) effect.stencils.forEach(buffer => gl.deleteRenderbuffer(buffer));
        effect.samplers.forEach(sampler => gl.deleteSampler(sampler));
        gl.deleteBuffer(effect.ubo);
    }
    clear() {
        this.effects.forEach(effect => this.destroy(effect));
        this.effects.clear();
    }
    image(name, srgb) {
        const key = `${name}:${srgb}`;
        if (this.images.has(key)) return this.images.get(key);
        const image = getGenshade().images.get(name);
        if (!image) throw new Error(`Missing Genshade image: ${name}`);
        const gl = this.gl;
        const texture = gl.createTexture();
        const flags = [gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_COLORSPACE_CONVERSION_WEBGL];
        const saved = flags.map(flag => gl.getParameter(flag));
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
            gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.generateMipmap(gl.TEXTURE_2D);
        } finally { flags.forEach((flag, i) => gl.pixelStorei(flag, saved[i])); }
        this.images.set(key, texture);
        return texture;
    }
    effect(file, width, height) {
        let effect = this.effects.get(file);
        if (effect && effect.width === width && effect.height === height) return effect;
        if (effect) this.destroy(effect);
        const assets = getGenshade();
        const module = width === 480 && height === 360 ? assets.modules[file] : assets.compile(file, width, height);
        effect = {module, width, height, targets: new Map(), programs: new Map(), samplers: [],
            stencils: new Map(), ubo: this.gl.createBuffer(), values: new ArrayBuffer(Math.max(16, module.uniformSize)), lastFrame: null};
        this.effects.set(file, effect);
        for (const texture of module.textures) {
            if (!texture.semantic && !texture.annotations.source) {
                effect.targets.set(texture.name, this.createTarget(texture.width, texture.height, texture.format, texture.levels));
            }
        }
        effect.targets.set('$front', this.createTarget(width, height));
        effect.targets.set('$back', this.createTarget(width, height));
        effect.targets.set('$depth', this.createTarget(width, height, 41));
        const gl = this.gl;
        effect.samplers = module.samplers.map(info => {
            const sampler = gl.createSampler();
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrap(gl, info.wrapU));
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrap(gl, info.wrapV));
            const texture = module.textures.find(t => t.name === info.texture);
            const mipmaps = texture.annotations.source || texture.levels > 1;
            const minLinear = (info.filter & 16) !== 0;
            const magLinear = (info.filter & 4) !== 0;
            const mipLinear = (info.filter & 1) !== 0;
            const filter = mipmaps ? (minLinear ? (mipLinear ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_NEAREST) :
                (mipLinear ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST)) : minLinear ? gl.LINEAR : gl.NEAREST;
            gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, filter);
            gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, magLinear ? gl.LINEAR : gl.NEAREST);
            return sampler;
        });
        return effect;
    }
    program(effect, pass) {
        const key = `${pass.vertex}:${pass.fragment}`;
        if (effect.programs.has(key)) return effect.programs.get(key);
        const gl = this.gl;
        const vertex = this.engine._compileShader(gl.VERTEX_SHADER, webglSource(effect.module.entries[pass.vertex], 'vertex'));
        let fragment, program;
        try {
            fragment = this.engine._compileShader(gl.FRAGMENT_SHADER, webglSource(effect.module.entries[pass.fragment], 'fragment'));
            program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            const block = gl.getUniformBlockIndex(program, '_Globals');
            if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
            effect.programs.set(key, program);
            return program;
        } catch (error) {
            if (program) gl.deleteProgram(program);
            throw error;
        } finally {
            gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment);
        }
    }
    uniforms(effect, settings, context) {
        const data = new DataView(effect.values);
        const frame = context.frame || 0;
        for (const uniform of effect.module.uniforms) {
            let value = settings[uniform.name];
            if (value === undefined) value = uniform.value;
            const source = uniform.annotations.source;
            if (source === 'timer') value = [context.time * 1000];
            else if (source === 'framecount') value = [frame];
            else if (source === 'frametime') value = [1000 / context.fps];
            else if (source === 'pingpong') {
                const min = (uniform.annotations.min || [0])[0], max = (uniform.annotations.max || [1])[0];
                const speed = (uniform.annotations.step || [1])[0];
                const phase = (context.time * speed) % (2 * (max - min || 1));
                value = [min + (phase < max - min ? phase : 2 * (max - min) - phase), phase < max - min ? 1 : -1];
            } else if (source === 'random') {
                const min = (uniform.annotations.min || [0])[0], max = (uniform.annotations.max || [1])[0];
                const random = Math.sin(frame * 12.9898 + uniform.offset * 78.233) * 43758.5453;
                value = [min + Math.floor((random - Math.floor(random)) * (max - min + 1))];
            } else if (source === 'mousepoint') value = context.mouse || [0, 0];
            else if (source === 'bufready_depth') value = [context.depth ? 1 : 0];
            else if (source === 'key' || source === 'mousebutton') {
                value = [context.key ? context.key(uniform.annotations) : 0];
            }
            if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
                value = [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
            }
            if (!Array.isArray(value)) value = [value];
            for (let i = 0; i < uniform.rows * uniform.cols; i++) {
                const n = Number(value[i] === undefined ? value[0] : value[i]);
                const offset = uniform.offset + (uniform.cols > 1 ? Math.floor(i / uniform.rows) * 16 + (i % uniform.rows) * 4 : i * 4);
                if (offset + 4 > data.byteLength) continue;
                const set = uniform.type === 'float' ? 'setFloat32' : uniform.type === 'uint' ? 'setUint32' : 'setInt32';
                data[set](offset, Number.isFinite(n) ? n : 0, true);
            }
        }
        const gl = this.gl;
        gl.bindBuffer(gl.UNIFORM_BUFFER, effect.ubo);
        gl.bufferData(gl.UNIFORM_BUFFER, new Uint8Array(effect.values), gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, effect.ubo);
        effect.lastFrame = frame;
    }
    render(descriptor, settings, context, mix, blendMode) {
        const engine = this.engine, gl = this.gl;
        if (!gl.createVertexArray) throw new Error('Genshade effects require WebGL 2.');
        if (engine._isNoOp(mix, blendMode)) return;
        const skin = engine._prepare();
        if (!skin) return;
        const savedVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        const savedUBO = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0);
        const boundSamplers = [];
        try {
            gl.bindVertexArray(null);
            for (let unit=0;unit<2;unit++) {
                gl.activeTexture(gl.TEXTURE0+unit);
                boundSamplers[unit]={saved:gl.getParameter(gl.SAMPLER_BINDING)};
                gl.bindSampler(unit,null);
            }
            const effect = this.effect(descriptor.file, engine.width, engine.height);
            const technique = effect.module.techniques.find(t => t.name === descriptor.technique);
            if (!technique) throw new Error(`Technique not found: ${descriptor.technique}`);
            this.uniforms(effect, settings, context);
            let front = effect.targets.get('$front'), back = effect.targets.get('$back');
            if (!this.straightProgram) this.straightProgram = engine._createProgram(`
                precision highp float; varying vec2 v_uv; uniform sampler2D u_image;
                void main() { vec4 p = texture2D(u_image, v_uv); gl_FragColor = vec4(p.a > 0.00001 ? p.rgb / p.a : vec3(0.0), p.a); }
            `);
            engine._render(this.straightProgram, front.framebuffer, [{name:'u_image',texture:engine.textures[0]}], {}, []);
            const depth = effect.targets.get('$depth');
            this.prepareDepth(depth, context.depth);
            for (const pass of technique.passes) {
                if (pass.compute) {
                    if (!this.compute) this.compute=new GenshadeCompute(this);
                    this.compute.render(effect,pass,front);
                    continue;
                }
                const program = this.program(effect, pass);
                const readTargets = new Map(effect.targets);
                const targets = pass.targets.length ? pass.targets.map(name => {
                    const old=readTargets.get(name);
                    const feedback=effect.module.samplers.some(info => info.texture===name &&
                        gl.getUniformLocation(program,glName(info.name))!==null);
                    if (!feedback) return old;
                    const spareName=`$spare:${name}`;
                    const spare=effect.targets.get(spareName)||this.createTarget(old.width,old.height,old.format,old.levels);
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old.framebuffer);
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,spare.framebuffer);
                    gl.blitFramebuffer(0,0,old.width,old.height,0,0,old.width,old.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
                    effect.targets.set(name,spare);effect.targets.set(spareName,old);
                    return spare;
                }) : [back];
                // A backbuffer pass may discard pixels or blend with the prior screen.
                if (!pass.targets.length) {
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,front.framebuffer);
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,back.framebuffer);
                    gl.blitFramebuffer(0,0,front.width,front.height,0,0,back.width,back.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
                }
                if (targets.some(target => !target)) throw new Error('Missing Genshade render target.');
                const target = targets[0];
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
                const attachments = targets.map((buffer, i) => {
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, gl.TEXTURE_2D, buffer.texture, 0);
                    return gl.COLOR_ATTACHMENT0+i;
                });
                gl.drawBuffers(attachments);
                gl.viewport(0,0,pass.width || target.width,pass.height || target.height);
                gl.useProgram(program);
                gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
                const factors = [gl.ZERO,gl.ONE,gl.SRC_COLOR,gl.ONE_MINUS_SRC_COLOR,gl.DST_COLOR,
                    gl.ONE_MINUS_DST_COLOR,gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.DST_ALPHA,gl.ONE_MINUS_DST_ALPHA];
                const operations = [gl.FUNC_ADD,gl.FUNC_ADD,gl.FUNC_SUBTRACT,gl.FUNC_REVERSE_SUBTRACT,gl.MIN,gl.MAX];
                if (pass.blend) {
                    gl.enable(gl.BLEND);
                    gl.blendFuncSeparate(factors[pass.srcRGB],factors[pass.dstRGB],factors[pass.srcAlpha],factors[pass.dstAlpha]);
                    gl.blendEquationSeparate(operations[pass.opRGB],operations[pass.opAlpha]);
                }
                const mask = pass.writeMask === undefined ? 15 : pass.writeMask;
                gl.colorMask(!!(mask&1),!!(mask&2),!!(mask&4),!!(mask&8));
                if (pass.stencil) {
                    const key = `${target.width}:${target.height}`;
                    let stencil=effect.stencils.get(key);
                    if (!stencil) {
                        stencil=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,stencil);
                        gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH24_STENCIL8,target.width,target.height);
                        effect.stencils.set(key,stencil);
                    }
                    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,stencil);
                    gl.enable(gl.STENCIL_TEST);
                    const funcs=[gl.NEVER,gl.LESS,gl.EQUAL,gl.LEQUAL,gl.GREATER,gl.NOTEQUAL,gl.GEQUAL,gl.ALWAYS];
                    const ops=[gl.ZERO,gl.KEEP,gl.REPLACE,gl.INCR,gl.DECR,gl.INVERT,gl.INCR_WRAP,gl.DECR_WRAP];
                    gl.stencilMask(pass.stencilWriteMask);
                    gl.stencilFunc(funcs[pass.stencilFunc],pass.stencilRef,pass.stencilReadMask);
                    gl.stencilOp(ops[pass.stencilFail],ops[pass.stencilDepthFail],ops[pass.stencilPass]);
                }
                if (pass.clear) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
                let unit=0;
                effect.module.samplers.forEach((info,index) => {
                    const location = gl.getUniformLocation(program, glName(info.name));
                    if (location === null) return;
                    const texture = effect.module.textures.find(t => t.name === info.texture);
                    const resource = texture.semantic === 'COLOR' ? front.texture : texture.semantic === 'DEPTH' ? depth.texture :
                        texture.annotations.source ? this.image(texture.annotations.source, info.srgb) : readTargets.get(texture.name).texture;
                    gl.activeTexture(gl.TEXTURE0+unit);
                    if (!boundSamplers[unit]) boundSamplers[unit] = {saved:gl.getParameter(gl.SAMPLER_BINDING)};
                    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,resource);
                    gl.bindSampler(unit,effect.samplers[index]); gl.uniform1i(location,unit++);
                });
                const topologies=[gl.TRIANGLES,gl.POINTS,gl.LINES,gl.LINE_STRIP,gl.TRIANGLES,gl.TRIANGLE_STRIP];
                gl.drawArrays(topologies[pass.topology || 4],0,pass.vertices);
                targets.forEach((buffer,i) => {
                    if (buffer.levels>1 && pass.mipmaps) { gl.bindTexture(gl.TEXTURE_2D,buffer.texture); gl.generateMipmap(gl.TEXTURE_2D); }
                    if (i) gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,null,0);
                });
                gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
                if (!pass.targets.length) { const previous=front; front=back; back=previous; }
            }
            gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.colorMask(true,true,true,true);
            boundSamplers.forEach((binding,unit)=>gl.bindSampler(unit,null));
            if (!this.outputProgram) this.outputProgram = engine._createProgram(`
                precision highp float; varying vec2 v_uv;
                uniform sampler2D u_image; uniform sampler2D u_original; uniform float u_mix;
                void main() { vec4 base=texture2D(u_original,v_uv); vec4 result=texture2D(u_image,v_uv);
                    gl_FragColor=mix(base,vec4(result.rgb*base.a,base.a),u_mix); }
            `);
            engine._renderEffect(skin,this.outputProgram,[{name:'u_image',texture:front.texture},
                {name:'u_original',texture:engine.textures[0]}],{u_mix:mix},[],blendMode);
        } finally {
            boundSamplers.forEach((binding,unit)=>gl.bindSampler(unit,binding.saved));
            gl.bindBufferBase(gl.UNIFORM_BUFFER,0,savedUBO);
            gl.bindVertexArray(savedVAO);
        }
    }
    prepareDepth(target, depth) {
        const gl=this.gl, engine=this.engine;
        if (!depth || !depth.canvas) {
            gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
            gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); return;
        }
        if (!this.depthProgram) this.depthProgram=engine._createProgram(`
            precision highp float; varying vec2 v_uv; uniform sampler2D u_image; uniform vec2 u_planes;
            void main() { vec3 rgb=texture2D(u_image,v_uv).rgb;
                float raw=all(greaterThan(rgb,vec3(0.999))) ? 1.0 : dot(rgb,vec3(1.0,1.0/255.0,1.0/65025.0));
                float linearDepth=u_planes.x/max(u_planes.y-raw*(u_planes.y-u_planes.x),0.000001);
                float compatible=1.0-(1000.0*linearDepth)/(1.0+999.0*linearDepth);
                gl_FragColor=vec4(vec3(compatible),1.0); }
        `);
        engine._render(this.depthProgram,target.framebuffer,[{name:'u_image',texture:engine._uploadDepthBuffer(depth)}],
            {u_planes:[Math.max(0.0001,depth.near||0.1),depth.far||1000]},[]);
    }
}
export default GenshadeRenderer;
