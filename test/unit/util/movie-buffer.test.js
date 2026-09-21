import MovieBuffer from 'scratch-render/src/MovieBuffer';
import * as twgl from 'twgl.js';

jest.mock('twgl.js', () => ({
    ...jest.requireActual('twgl.js'),
    createTexture: jest.fn(() => ({})),
    createFramebufferInfo: jest.fn((gl, attachments, width, height) => ({framebuffer: {}, attachments, width, height})),
    bindFramebufferInfo: jest.fn(), setUniforms: jest.fn(), setTextureParameters: jest.fn(),
    setBuffersAndAttributes: jest.fn(), drawBufferInfo: jest.fn()
}));

const make = () => {
    const gl = {RGBA: 1, NEAREST: 2, CLAMP_TO_EDGE: 3, COLOR_BUFFER_BIT: 4, TRIANGLES: 5,
        clearColor: jest.fn(), clear: jest.fn(), deleteTexture: jest.fn(), deleteFramebuffer: jest.fn(),
        viewport: jest.fn(), useProgram: jest.fn()};
    let region;
    const renderer = {
        gl, getNativeSize: () => [480, 360], on: jest.fn(), removeListener: jest.fn(),
        _shaderManager: {getShader: () => ({program: {}})}, _bufferInfo: {},
        _doExitDrawRegion: () => { if (region) region.exit(); region = null; },
        enterDrawRegion: next => {
            if (region === next) return;
            renderer._doExitDrawRegion();
            region = next;
            next.enter();
        }
    };
    return {gl, renderer, surface: new MovieBuffer(0, renderer)};
};

const originalImageData = global.ImageData;
beforeAll(() => {
    global.ImageData = class {
        constructor (width, height) {
            this.width = width;
            this.height = height;
            this.data = new Uint8ClampedArray(width * height * 4);
        }
    };
});
afterAll(() => { global.ImageData = originalImageData; });

beforeEach(() => jest.clearAllMocks());

test('Movie surface reallocates only on resize, preserves pixels and releases previous GPU resources', () => {
    const {gl, surface} = make();
    const oldTexture = surface._texture;
    const oldFramebuffer = surface._framebuffer.framebuffer;
    surface.setRenderQuality(1);
    expect(twgl.createTexture).toHaveBeenCalledTimes(1);
    surface.setRenderQuality(2);
    expect(surface._size).toEqual([960, 720]);
    expect(surface.size).toEqual([480, 360]);
    expect(twgl.drawBufferInfo).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(oldTexture);
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(oldFramebuffer);
    const finalTexture = surface._texture;
    const finalFramebuffer = surface._framebuffer.framebuffer;
    surface.dispose();
    expect(gl.deleteTexture).toHaveBeenLastCalledWith(finalTexture);
    expect(gl.deleteFramebuffer).toHaveBeenLastCalledWith(finalFramebuffer);
});

test('clearing the current group attachment does not select or publish another framebuffer', () => {
    const {gl, surface, renderer} = make();
    const baseline = surface._framebuffer;
    const group = {framebuffer: {}};
    renderer._doExitDrawRegion();
    surface._framebuffer = group;
    surface.clear();
    expect(twgl.bindFramebufferInfo).toHaveBeenLastCalledWith(gl, group);
    expect(surface._framebuffer).not.toBe(baseline);
    expect(surface._silhouetteDirty).toBe(true);
});
