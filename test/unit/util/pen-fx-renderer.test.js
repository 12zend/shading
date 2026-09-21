import createEngine from '../../../scratch-render/src/pen-fx/engine';

const fixture = () => {
    const gl = {};
    for (const name of ['bindTexture', 'texParameteri', 'bindFramebuffer', 'framebufferTexture2D']) {
        gl[name] = jest.fn();
    }
    Object.assign(gl, {LINEAR: 1, NEAREST: 2});
    const engine = Object.create(createEngine(gl, {}).prototype);
    const skin = {_texture: 'pen', _framebuffer: {framebuffer: 'pen-fb', attachments: ['pen']}};
    Object.assign(engine, {
        textures: ['work'], framebuffers: ['work-fb'], groupStack: [], matteStack: [],
        programSources: {copy: 'copy'}, baseProgramSources: {copy: 'copy'}, blendOpacity: 1,
        _prepare: jest.fn(() => skin), _render: jest.fn(), _markSkinChanged: jest.fn()
    });
    return {engine, skin, gl};
};

describe('renderer-owned PenFX attachment exchange', () => {
    test('1000 single-pass commands draw 1000 passes without copying or yielding', () => {
        const {engine, skin} = fixture();
        for (let i = 0; i < 1000; i++) {
            expect(engine._singlePass('gamma', {}, [], 'normal')).toBeUndefined();
        }
        expect(engine._render).toHaveBeenCalledTimes(1000);
        expect(engine._prepare).toHaveBeenCalledWith(false);
        expect(skin._texture).toBe('pen');
        expect(skin._framebuffer.attachments).toEqual(['pen']);
        for (const call of engine._render.mock.calls) expect(call[0]).toBe('gamma');
    });

    test('updates group pool and frame ownership without exposing the baseline', () => {
        const {engine, skin} = fixture();
        const group = {texture: 'pen', buffer: {texture: 'pen'}};
        engine.groupStack.push(group);
        skin.getTexture = () => 'baseline';
        engine._singlePass('gamma', {}, [], 'normal');
        expect(group.texture).toBe('work');
        expect(group.buffer.texture).toBe('work');
        expect(skin.getTexture()).toBe('baseline');
        engine.groupStack.length = 0;
        engine.frameTransaction = {stagingTexture: 'work'};
        engine._singlePass('gamma', {}, [], 'normal');
        expect(engine.frameTransaction.stagingTexture).toBe('pen');
        expect(skin.getTexture()).toBe('baseline');
    });

    test('preserves texture ownership when rendering fails', () => {
        const {engine, skin} = fixture();
        engine._render.mockImplementation(() => { throw new Error('shader failed'); });
        expect(() => engine._singlePass('bad', {}, [], 'normal')).toThrow('shader failed');
        expect(skin._texture).toBe('pen');
        expect(engine.textures).toEqual(['work']);
    });

    test('keeps blending, expanded groups and custom copy shaders on the compatible path', () => {
        const {engine} = fixture();
        expect(engine._directSinglePass('gamma', {}, [], 'mul')).toBe(false);
        engine.groupEffectScope = 'expanded';
        expect(engine._directSinglePass('gamma', {}, [], 'normal')).toBe(false);
        engine.groupEffectScope = null;
        engine.programOverrides = {copy: 'custom'};
        engine.programSources.custom = 'different copy';
        expect(engine._directSinglePass('gamma', {}, [], 'normal')).toBe(false);
        expect(engine._render).not.toHaveBeenCalled();
    });
});

describe('stamp bounds and transparent groups', () => {
    test('skips a blur only for a known empty isolated group', () => {
        const {engine, skin} = fixture();
        engine.programs = {};
        engine.lensKernelProgram = 'lens-kernel';
        const group = {skin, texture: 'pen', buffer: {texture: 'pen'}, bounds: []};
        engine.groupStack.push(group);
        expect(engine._singlePass('lens-kernel', {u_radius: 20}, [], 'normal')).toBeUndefined();
        expect(engine._render).not.toHaveBeenCalled();
        engine.invalidateDrawBounds(skin);
        engine._singlePass('lens-kernel', {u_radius: 20}, [], 'normal');
        expect(engine._render).toHaveBeenCalledTimes(1);
    });

    test('unions stamp bounds and invalidates them for untracked drawing', () => {
        const {engine, skin} = fixture();
        engine.width = 480;
        engine.height = 270;
        const group = {skin, texture: 'pen', bounds: []};
        engine.groupStack.push(group);
        engine.noteDrawBounds(skin, 10, 20, 30, 40);
        engine.noteDrawBounds(skin, 5, 25, 50, 60);
        expect(group.bounds).toEqual([5, 20, 55, 85]);
        engine.invalidateDrawBounds(skin);
        engine.noteDrawBounds(skin, 0, 0, 1, 1);
        expect(group.bounds).toBeNull();
    });
});

describe('renderer frame target pool', () => {
    test('reuses a committed baseline on the next frame and restores cancelled frames', () => {
        const {engine, skin, gl} = fixture();
        Object.assign(gl, {deleteTexture: jest.fn(), deleteFramebuffer: jest.fn()});
        skin._size = [480, 270];
        engine.renderer = {};
        engine.gl = gl;
        engine._drawSurface = () => skin;
        engine._resize = jest.fn();
        engine._createBufferTexture = jest.fn(() => ({texture: 'staging', framebuffer: 'staging-fb'}));
        engine._clearTransparent = jest.fn();
        engine._restoreGLState = jest.fn();
        expect(engine.beginFrame()).toBe(true);
        expect(skin.getTexture()).toBe('pen');
        expect(engine.commitFrame()).toBe(true);
        expect(engine.frameBuffer.texture).toBe('pen');
        expect(engine.beginFrame()).toBe(true);
        expect(engine._createBufferTexture).toHaveBeenCalledTimes(1);
        expect(skin.getTexture()).toBe('staging');
        expect(engine.cancelFrame()).toBe(true);
        expect(skin._texture).toBe('staging');
        expect(engine.frameBuffer.texture).toBe('pen');
        engine.clearFrameBuffer();
        expect(gl.deleteTexture).toHaveBeenCalledWith('pen');
    });
});
