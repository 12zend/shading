import VM from 'scratch-vm';
import Sprite from 'scratch-vm/src/sprites/sprite';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import installObjectBlocks from '../../../scratch-vm/src/lib/object-blocks';
import installLegacyDrawingBlocks from '../../../src/lib/legacy-drawing-blocks';

const make = enabled => {
    const vm = new VM();
    const runtime = vm.runtime;
    runtime.compilerOptions.enabled = enabled;
    installObjectBlocks(vm);
    const sprite = new Sprite(null, runtime);
    sprite.name = 'Sprite';
    const target = new RenderedTarget(sprite, runtime);
    runtime.targets = [target];
    runtime.renderer = {
        clearMovieBuffer: jest.fn(), drawMovieDrawable: jest.fn(), drawMovieStroke: jest.fn()
    };
    return {vm, runtime, target};
};

test.each([true, false])('clear → draw → next block completes in one VM step (compiler=%s)', enabled => {
    for (const [clear, draw] of [['pen_clear', 'pen_stamp'], ['objects_clear', 'objects_drawSprite']]) {
        const {runtime, target} = make(enabled);
        [clear, draw, 'control_incr_counter'].forEach((opcode, index) => target.blocks.createBlock({
            id: String(index), opcode, inputs: {}, fields: {}, parent: index ? String(index - 1) : null,
            next: index < 2 ? String(index + 1) : null, topLevel: index === 0, shadow: false
        }));
        const thread = runtime._pushThread('0', target);
        expect(thread.isCompiled).toBe(enabled);
        runtime.sequencer.stepThread(thread);
        expect(runtime.ext_pen).toBeUndefined();
        expect(runtime.renderer.clearMovieBuffer).toHaveBeenCalledTimes(1);
        expect(runtime.renderer.drawMovieDrawable).toHaveBeenCalledTimes(1);
        expect(runtime.ext_scratch3_control.getCounter()).toBe(1);
    }
});

test('legacy trail state and cloned colors use direct Movie strokes and synchronous primitives', () => {
    const {runtime, target} = make(false);
    const call = (opcode, args = {}) => {
        expect(runtime._primitives[opcode](args, {target})).toBeUndefined();
    };
    call('pen_setPenColorToColor', {COLOR: '#ff0000'});
    call('pen_setPenSizeTo', {SIZE: 3});
    call('pen_penDown');
    const drawing = runtime.movieDrawing;
    const state = drawing.getState(target);
    expect(runtime.renderer.drawMovieStroke).toHaveBeenLastCalledWith(state.stroke, 0, 0, 0, 0);
    target.x = 10;
    target.y = 20;
    target.onTargetMoved(target, 0, 0, false);
    expect(runtime.renderer.drawMovieStroke).toHaveBeenLastCalledWith(state.stroke, 0, 0, 10, 20);
    const clone = new RenderedTarget(target.sprite, runtime);
    drawing.onTargetCreated(clone, target);
    expect(drawing.getState(clone)).toEqual(state);
    expect(drawing.getState(clone).stroke).not.toBe(state.stroke);
    call('pen_penUp');
    expect(target.onTargetMoved).toBeNull();
    call('pen_clear');
    call('pen_stamp');
});

test('old blocks have editor definitions without installing a Pen extension', () => {
    const blocks = {Blocks: {}};
    installLegacyDrawingBlocks(blocks, text => text);
    const {runtime} = make(false);
    for (const opcode of Object.keys(runtime.movieDrawing.getPrimitives())) {
        const block = {jsonInit: jest.fn()};
        blocks.Blocks[opcode].init.call(block);
        expect(block.jsonInit).toHaveBeenCalledTimes(1);
    }
});
