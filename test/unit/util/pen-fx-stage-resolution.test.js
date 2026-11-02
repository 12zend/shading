import createEngine from '../../../scratch-render/src/pen-fx/engine';
import {requirePluginModule} from '../../helpers/official-plugins';

// The Movie surface is the stage size times the display's render quality: smaller in the editor preview, larger in
// full screen or a bigger export. Effects must look the same at each of these sizes.
const STAGE = [480, 270];

const mockGL = () => {
    const calls = {shaderSource: [], uniform2fv: []};
    const gl = new Proxy({
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getUniformLocation: (program, name) => name,
        getAttribLocation: () => 0,
        createShader: () => ({}),
        createProgram: () => ({}),
        shaderSource: (shader, source) => calls.shaderSource.push(source),
        uniform2fv: (location, value) => calls.uniform2fv.push([location, Array.from(value)])
    }, {
        get: (target, name) => {
            if (!(name in target)) target[name] = typeof name === 'string' && /^[A-Z]/.test(name) ? 1 : () => ({});
            return target[name];
        }
    });
    return {gl, calls};
};

const createSurface = quality => ({
    _nativeSize: STAGE.slice(),
    _size: [STAGE[0] * quality, STAGE[1] * quality],
    _texture: {},
    _framebuffer: {framebuffer: {}, attachments: []},
    renderQuality: quality
});

const createTestEngine = quality => {
    const {gl, calls} = mockGL();
    const skin = createSurface(quality);
    const Engine = createEngine(gl, {_allSkins: [skin], getMovieBufferId: () => 0});
    const engine = new Engine();
    return {engine, skin, calls};
};

const installPluginEngineMethods = (engine, pluginId, modulePath) => {
    const methods = {};
    requirePluginModule(pluginId, modulePath)({Engine: {prototype: methods}});
    Object.assign(engine, methods);
};

describe('PenFX effects measure pixels on the stage', () => {
    test.each([0.5, 1, 2])('passes the stage size as u_resolution at render quality %s', quality => {
        const {engine, skin} = createTestEngine(quality);
        expect(engine._prepare()).toBe(skin);
        expect([engine.width, engine.height]).toEqual(skin._size);
        expect(Array.from(engine.resolution)).toEqual(STAGE);
        expect(engine.pixelScale).toBe(quality);
    });

    test.each([0.5, 1, 2])('renders a gaussian blur with the same stage-pixel radius at quality %s', quality => {
        const {engine} = createTestEngine(quality);
        installPluginEngineMethods(engine, 'blur', 'lib/engine.js');
        engine._render = jest.fn();
        expect(engine.gaussian('horizontal', 0, 12, 1, 'normal')).toBeUndefined();
        const uniforms = engine._render.mock.calls.find(call => 'u_radius' in call[3])[3];
        expect(uniforms.u_radius).toBe(12);
        expect(Array.from(uniforms.u_resolution)).toEqual(STAGE);
    });

    test('grows grouped-effect padding with the buffer so the blur is not clipped', () => {
        const {engine} = createTestEngine(2);
        engine._prepare();
        const program = {};
        engine.setProgramBoundsPadding(program, uniforms => Math.ceil(uniforms.u_radius) + 2);
        expect(engine._boundsPaddingFor(program, {u_radius: 10})).toBe(24);
        engine.setProgramBoundsPadding(program, () => null);
        expect(engine._boundsPaddingFor(program, {u_radius: 10})).toBeNull();
    });

    test('converts gl_FragCoord to stage pixels for shaders that read it', () => {
        const {engine, calls} = createTestEngine(2);
        const source = [
            '#extension GL_OES_standard_derivatives : enable',
            '#ifdef GL_ES',
            'precision highp float;',
            '#endif',
            'uniform vec2 u_resolution;',
            'void main() { gl_FragColor = vec4(gl_FragCoord.xy / u_resolution, 0.0, 1.0); }'
        ].join('\n');
        const program = engine._createProgram(source);
        const compiled = calls.shaderSource[calls.shaderSource.length - 1].split('\n');
        // The declaration follows #extension and stays outside the conditional block.
        expect(compiled[0]).toBe(source.split('\n')[0]);
        expect(compiled[1]).toBe('uniform mediump vec2 shading_fragCoordScale;');
        expect(compiled[2]).toContain('#define shading_FragCoord');
        expect(compiled.slice(3, 7)).toEqual(source.split('\n').slice(1, 5));
        expect(compiled[7]).toContain('shading_FragCoord.xy / u_resolution');
        expect(compiled[7]).not.toContain('gl_FragCoord');
        engine._prepare();
        engine._render(program, {}, [], {}, []);
        expect(calls.uniform2fv).toContainEqual(['shading_fragCoordScale', [0.5, 0.5]]);
    });

    test('leaves shaders without gl_FragCoord untouched', () => {
        const {engine, calls} = createTestEngine(2);
        const source = 'precision highp float;\nvoid main() { gl_FragColor = vec4(1.0); }';
        const program = engine._createProgram(source);
        expect(calls.shaderSource[calls.shaderSource.length - 1]).toBe(source);
        engine._render(program, {}, [], {}, []);
        expect(calls.uniform2fv.map(call => call[0])).not.toContain('shading_fragCoordScale');
    });
});

// Upscale a 1-row-per-stage-row RGBA image by an integer factor, as a higher render quality would draw it.
const upscale = (pixels, width, height, factor) => {
    const output = new Uint8Array(pixels.length * factor * factor);
    for (let y = 0; y < height * factor; y++) {
        for (let x = 0; x < width * factor; x++) {
            const from = ((Math.floor(y / factor) * width) + Math.floor(x / factor)) * 4;
            output.set(pixels.subarray(from, from + 4), ((y * width * factor) + x) * 4);
        }
    }
    return output;
};

describe('CPU effects measure pixels on the stage', () => {
    const runPixelSort = (pixels, width, height, pixelScale, centerX, span = 2) => {
        let output = null;
        const engine = {
            gl: {
                bindFramebuffer: () => {},
                bindTexture: () => {},
                readPixels: (x, y, w, h, format, type, target) => target.set(pixels),
                texSubImage2D: (target, level, x, y, w, h, format, type, data) => {
                    output = new Uint8Array(data);
                }
            },
            width,
            height,
            pixelScale,
            framebuffers: [{}],
            _isNoOp: () => false,
            _prepare: () => ({_texture: {}}),
            _canRenderDirectly: () => true,
            _markSkinChanged: () => {}
        };
        installPluginEngineMethods(engine, 'pixel-sort', 'lib/engine.js');
        const type = centerX === null ? 'x' : 'dir';
        expect(engine.pixelSort(type, span, false, 0, 1, 'luminance', false, 1, centerX || 0, 0, 1, 'normal'))
            .toBeUndefined();
        return output;
    };

    const gradient = (width, height) => {
        const pixels = new Uint8Array(width * height * 4);
        for (let index = 0; index < width * height; index++) {
            const value = 255 - Math.round(index / (width * height) * 255);
            pixels.set([value, value, value, 255], index * 4);
        }
        return pixels;
    };

    test('pixel sort spans cover the same part of the image at every render quality', () => {
        const stage = gradient(8, 2);
        const expected = upscale(runPixelSort(stage, 8, 2, 1, null), 8, 2, 2);
        expect(runPixelSort(upscale(stage, 8, 2, 2), 16, 4, 2, null)).toEqual(expected);
    });

    test('pixel sort centers are stage coordinates', () => {
        const pixels = upscale(gradient(8, 8), 8, 8, 2);
        // Whole-line spans, so only the center depends on the render quality.
        expect(runPixelSort(pixels, 16, 16, 2, 2, 1000)).toEqual(runPixelSort(pixels, 16, 16, 1, 4, 1000));
        expect(runPixelSort(pixels, 16, 16, 2, 2, 1000)).not.toEqual(runPixelSort(pixels, 16, 16, 1, 2, 1000));
    });

    test('blob tracking strokes and blur radii scale with the render quality', () => {
        const {detectMovieBlobs, drawMovieBlobOverlay} =
            requirePluginModule('blob-tracking', 'lib/blob-detection.js');
        const stage = new Uint8Array(12 * 12 * 4);
        for (let y = 3; y < 9; y++) {
            for (let x = 3; x < 9; x++) stage.set([255, 255, 255, 255], ((y * 12) + x) * 4);
        }
        const options = {mode: 'bright', threshold: 128, blurRadius: 1, strokeWidth: 1, strokeOpacity: 1,
            color: [1, 0, 0]};
        const frame = {data: stage, width: 12, height: 12};
        const boxes = detectMovieBlobs(frame, options);
        const expected = upscale(drawMovieBlobOverlay(frame, boxes, options), 12, 12, 2);
        const large = {data: upscale(stage, 12, 12, 2), width: 24, height: 24};
        const largeOptions = Object.assign({}, options, {pixelScale: 2});
        const largeBoxes = detectMovieBlobs(large, largeOptions);
        expect(largeBoxes.map(box => [box.minimumX, box.minimumY, box.maximumX, box.maximumY]))
            .toEqual(boxes.map(box => [box.minimumX * 2, box.minimumY * 2, (box.maximumX * 2) + 1,
                (box.maximumY * 2) + 1]));
        expect(drawMovieBlobOverlay(large, largeBoxes, largeOptions)).toEqual(expected);
    });
});

test('Genshade runs ReShade effects at the stage size', () => {
    const GenshadeRenderer = requirePluginModule('genshade', 'lib/renderer.js');
    const gl = new Proxy({createVertexArray: () => ({})}, {
        get: (target, name) => (name in target ? target[name] : () => null)
    });
    const engine = {
        gl,
        width: 960,
        height: 540,
        resolution: new Float32Array(STAGE),
        _isNoOp: () => false,
        _prepare: () => ({})
    };
    const renderer = new GenshadeRenderer(engine);
    renderer.effect = jest.fn(() => {
        throw new Error('stop after sizing');
    });
    expect(() => renderer.render({file: 'Test.fx', technique: 'Test'}, {}, {}, 1, 'normal'))
        .toThrow('stop after sizing');
    expect(renderer.effect).toHaveBeenCalledWith('Test.fx', 480, 270);
});
