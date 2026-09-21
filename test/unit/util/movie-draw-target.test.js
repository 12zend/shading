import MovieDrawTarget from 'scratch-render/src/MovieDrawTarget';
import MovieTexture from 'scratch-render/src/MovieTexture';
import twgl from 'twgl.js';

jest.mock('twgl.js', () => ({
    createBufferInfoFromArrays: jest.fn(() => ({})), bindFramebufferInfo: jest.fn(), setBuffersAndAttributes: jest.fn(), setTextureParameters: jest.fn(),
    setUniforms: jest.fn(), drawBufferInfo: jest.fn(), createTexture: jest.fn(() => ({})),
    m4: {ortho: jest.fn(() => new Float32Array(16))}
}));

const make = () => {
    const skin = {renderQuality: 2, _framebuffer: {framebuffer: 'frame'}};
    const gl = {TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 4,
        NEAREST: 5, LINEAR: 6, TRIANGLES: 7, viewport: jest.fn(), useProgram: jest.fn(),
        bindTexture: jest.fn(), pixelStorei: jest.fn(), texImage2D: jest.fn(), texSubImage2D: jest.fn(),
        deleteTexture: jest.fn()};
    const renderer = {gl, _allSkins: [skin], _nativeSize: [480, 360],
        _doExitDrawRegion: jest.fn(), _shaderManager: {getShader: () => ({program: {}})},
        _bufferInfo: {}, _penFXEngine: {noteDrawBounds: jest.fn()}, penStamp: jest.fn()};
    const uniforms = {u_modelMatrix: new Float32Array([
        -100, 0, 0, 0, 0, -50, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1
    ])};
    return {renderer, skin, gl, uniforms, target: new MovieDrawTarget(renderer)};
};

beforeEach(() => jest.clearAllMocks());

test('draws into the current frame or group buffer without publishing or stamping', () => {
    const {renderer, skin, gl, uniforms, target} = make();
    const source = {texture: {}, size: [100, 50], nearest: true};
    expect(target.draw(0, source, uniforms)).toBeUndefined();
    expect(twgl.bindFramebufferInfo).toHaveBeenLastCalledWith(gl, skin._framebuffer);
    expect(gl.viewport).toHaveBeenLastCalledWith(400, 270, 200, 100);
    const group = {framebuffer: 'isolated group'};
    skin._framebuffer = group;
    target.draw(0, source, uniforms);
    expect(twgl.bindFramebufferInfo).toHaveBeenLastCalledWith(gl, group);
    expect(renderer.penStamp).not.toHaveBeenCalled();
    expect(renderer._penFXEngine.noteDrawBounds).toHaveBeenLastCalledWith(skin, 400, 270, 200, 100);
    expect(twgl.drawBufferInfo).toHaveBeenCalledTimes(2);
    expect(skin._silhouetteDirty).toBe(true);
});

test('offstage objects produce no GPU draw or effect bounds', () => {
    const {renderer, uniforms, target} = make();
    uniforms.u_modelMatrix[12] = 1000;
    target.draw(0, {texture: {}, size: [100, 50]}, uniforms);
    expect(twgl.drawBufferInfo).not.toHaveBeenCalled();
    expect(renderer._penFXEngine.noteDrawBounds).not.toHaveBeenCalled();
});

test('mutable image resources update storage in place, resize explicitly and release ownership', () => {
    const {renderer, gl} = make();
    const resource = new MovieTexture(renderer);
    const first = {width: 160, height: 90};
    resource.update(first, 2);
    const texture = resource.texture;
    resource.update({width: 160, height: 90}, 2);
    expect(resource.texture).toBe(texture);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(resource.size).toEqual([80, 45]);
    resource.update({width: 320, height: 180}, 2);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    resource.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
});

test('upload failures restore unpack state and retain the last successful dimensions', () => {
    const {renderer, gl} = make();
    const resource = new MovieTexture(renderer);
    resource.update({width: 16, height: 16}, 2);
    gl.texSubImage2D.mockImplementation(() => { throw new Error('upload'); });
    expect(() => resource.update({width: 16, height: 16}, 2)).toThrow('upload');
    expect(gl.pixelStorei).toHaveBeenLastCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    expect(resource.size).toEqual([8, 8]);
});


test('trail batches flush before a source or framebuffer switch and allocate only a small reusable buffer', () => {
    const {renderer, skin, gl, target, uniforms} = make();
    Object.assign(gl, {
        ARRAY_BUFFER: 10, FLOAT: 11, STREAM_DRAW: 12, TRIANGLE_STRIP: 13,
        createBuffer: jest.fn(() => ({})), bindBuffer: jest.fn(), bufferData: jest.fn(), bufferSubData: jest.fn(),
        drawArraysInstanced: jest.fn(), vertexAttribDivisor: jest.fn(), enableVertexAttribArray: jest.fn(),
        vertexAttribPointer: jest.fn(), getAttribLocation: jest.fn((program, name) =>
            ['a_lineColor', 'a_lineThicknessAndLength', 'a_penPoints'].indexOf(name))
    });
    skin._size = [960, 720];
    let region;
    renderer._doExitDrawRegion = jest.fn(() => { if (region) region.exit(); region = null; });
    renderer.enterDrawRegion = next => {
        if (region === next) return;
        renderer._doExitDrawRegion();
        region = next;
        next.enter();
    };
    renderer._penFXEngine.invalidateDrawBounds = jest.fn();
    const attributes = {diameter: 3, color4f: [1, 0, 0, 0.5]};
    for (let index = 0; index < 1000; index++) target.stroke(0, attributes, 0, 0, 10, 20);
    expect(gl.bufferData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, 10240, gl.STREAM_DRAW);
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(3);
    target.draw(0, {texture: {}, size: [100, 50]}, uniforms);
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(4);
    expect(gl.drawArraysInstanced).toHaveBeenLastCalledWith(gl.TRIANGLE_STRIP, 0, 4, 232);
    const group = {framebuffer: 'group'};
    skin._framebuffer = group;
    target.stroke(0, attributes, 0, 0, 20, 30);
    expect(twgl.bindFramebufferInfo).toHaveBeenLastCalledWith(gl, group);
    renderer._doExitDrawRegion();
    expect(gl.drawArraysInstanced).toHaveBeenLastCalledWith(gl.TRIANGLE_STRIP, 0, 4, 1);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
});
