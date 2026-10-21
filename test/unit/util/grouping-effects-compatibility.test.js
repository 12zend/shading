jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import sb3 from 'scratch-vm/src/serialization/sb3';

import {mergeGroupingEffects} from '../../../scratch-vm/src/lib/grouping-effects-compatibility';

const node = (opcode, {inputs = {}, next = null, parent = null} = {}) => ({
    opcode, inputs, fields: {}, parent, next, shadow: false, topLevel: parent === null
});
const statement = id => [2, id];

describe('merging the retired grouping effects slot', () => {
    test('appends the effects stack to the end of the objects stack once', () => {
        const blocks = sb3.deserializeBlocks({
            grouping: node('objects_grouping', {
                inputs: {SUBSTACK: statement('draw1'), SUBSTACK2: statement('blur')}
            }),
            draw1: node('objects_draw', {parent: 'grouping', next: 'draw2'}),
            draw2: node('objects_draw', {parent: 'draw1'}),
            blur: node('penfx_blur', {parent: 'grouping', next: 'glow'}),
            glow: node('penfx_glow', {parent: 'blur'})
        });

        expect(mergeGroupingEffects(blocks)).toBe(true);
        expect(blocks.grouping.inputs.SUBSTACK2).toBeUndefined();
        expect(blocks.grouping.inputs.SUBSTACK.block).toBe('draw1');
        expect(blocks.draw2.next).toBe('blur');
        expect(blocks.blur.parent).toBe('draw2');
        expect(blocks.blur.next).toBe('glow');

        const snapshot = JSON.stringify(blocks);
        expect(mergeGroupingEffects(blocks)).toBe(false);
        expect(JSON.stringify(blocks)).toBe(snapshot);
    });

    test('moves effects into an empty objects slot', () => {
        const blocks = sb3.deserializeBlocks({
            grouping: node('objects_grouping', {inputs: {SUBSTACK2: statement('blur')}}),
            blur: node('penfx_blur', {parent: 'grouping'})
        });

        expect(mergeGroupingEffects(blocks)).toBe(true);
        expect(blocks.grouping.inputs.SUBSTACK).toEqual({name: 'SUBSTACK', block: 'blur', shadow: null});
        expect(blocks.blur.parent).toBe('grouping');
    });

    test('drops an empty effects slot and leaves other blocks alone', () => {
        const blocks = sb3.deserializeBlocks({
            grouping: node('objects_grouping', {
                inputs: {SUBSTACK: statement('draw'), SUBSTACK2: [1, null]}
            }),
            draw: node('objects_draw', {parent: 'grouping'}),
            ifElse: node('control_if_else', {
                inputs: {SUBSTACK: statement('a'), SUBSTACK2: statement('b')}
            }),
            a: node('control_incr_counter', {parent: 'ifElse'}),
            b: node('control_incr_counter', {parent: 'ifElse'})
        });

        expect(mergeGroupingEffects(blocks)).toBe(true);
        expect(blocks.grouping.inputs).toEqual({SUBSTACK: {name: 'SUBSTACK', block: 'draw', shadow: null}});
        expect(blocks.draw.next).toBeNull();
        expect(blocks.ifElse.inputs.SUBSTACK2.block).toBe('b');
    });

    test('merges shared/backpack blocks', () => {
        const blocks = sb3.deserializeBlocks({
            grouping: node('objects_grouping', {
                inputs: {SUBSTACK: statement('draw'), SUBSTACK2: statement('blur')}
            }),
            draw: node('objects_draw', {parent: 'grouping'}),
            blur: node('penfx_blur', {parent: 'grouping'})
        });
        const restored = sb3.deserializeStandaloneBlocks(Object.values(blocks));
        const byId = Object.fromEntries(restored.blocks.map(block => [block.id, block]));

        expect(restored.blocks[0].id).toBe('grouping');
        expect(byId.grouping.inputs.SUBSTACK2).toBeUndefined();
        expect(byId.draw.next).toBe('blur');
        expect(byId.blur.parent).toBe('draw');
    });
});
