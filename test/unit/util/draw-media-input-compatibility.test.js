jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';
import sb3 from 'scratch-vm/src/serialization/sb3';

import installObjectBlocks from '../../../src/lib/object-blocks';
import {
    DRAW_MEDIA_MENU,
    restoreDrawMediaInputs
} from '../../../scratch-vm/src/lib/draw-media-input-compatibility';

const node = (opcode, inputs = {}, fields = {}, parent = null) => ({
    opcode, inputs, fields, parent, next: null, shadow: false, topLevel: parent === null
});
const menu = (parent, value) => ({...node(DRAW_MEDIA_MENU, {}, {ASSET: [value, null]}, parent), shadow: true});
const makeIds = () => {
    let id = 0;
    return () => `restored${id++}`;
};
const menuValue = (blocks, drawId) => {
    const input = blocks[drawId].inputs.ASSET;
    expect(blocks[input.shadow]).toEqual(expect.objectContaining({
        opcode: DRAW_MEDIA_MENU,
        parent: drawId,
        shadow: true
    }));
    return blocks[input.shadow].fields.ASSET.value;
};

describe('restoring the draw media menu input', () => {
    test('moves the retired ASSET field into a menu shadow once', () => {
        const blocks = sb3.deserializeBlocks({
            draw: node('objects_draw', {PX: [1, [4, '7']]}, {
                ASSET: ['text:sans-serif', null],
                SOURCE: ['text', null]
            })
        });
        const px = blocks.draw.inputs.PX;

        expect(restoreDrawMediaInputs(blocks, makeIds())).toBe(true);
        expect(blocks.draw.fields.ASSET).toBeUndefined();
        expect(blocks.draw.fields.SOURCE.value).toBe('text');
        expect(blocks.draw.inputs.ASSET).toEqual({name: 'ASSET', block: 'restored0', shadow: 'restored0'});
        expect(menuValue(blocks, 'draw')).toBe('text:sans-serif');
        expect(blocks.draw.inputs.PX).toBe(px);

        const snapshot = JSON.stringify(blocks);
        expect(restoreDrawMediaInputs(blocks, makeIds())).toBe(false);
        expect(JSON.stringify(blocks)).toBe(snapshot);
    });

    test('keeps unprefixed legacy names for the draw block source to decode', () => {
        const blocks = sb3.deserializeBlocks({
            draw: node('objects_draw', {}, {ASSET: ['costume1', null], SOURCE: ['costume', null]})
        });
        restoreDrawMediaInputs(blocks, makeIds());
        expect(menuValue(blocks, 'draw')).toBe('costume1');
    });

    test('leaves draw blocks that already have a media input unchanged', () => {
        const blocks = sb3.deserializeBlocks({
            draw: node('objects_draw', {ASSET: [3, 'join', 'menu']}, {SOURCE: ['costume', null]}),
            menu: menu('draw', 'costume:Logo'),
            join: node('operator_join', {STRING1: [1, [10, 'costume:']], STRING2: [1, [10, 'Logo']]}, {}, 'draw')
        });
        const snapshot = JSON.stringify(blocks);
        expect(restoreDrawMediaInputs(blocks, makeIds())).toBe(false);
        expect(JSON.stringify(blocks)).toBe(snapshot);
    });

    test('restores shared/backpack blocks', () => {
        const blocks = sb3.deserializeBlocks({
            draw: node('objects_draw', {}, {ASSET: ['video:clip', null], SOURCE: ['video', null]})
        });
        const restored = sb3.deserializeStandaloneBlocks(Object.values(blocks));
        expect(restored.blocks[0].id).toBe('draw');
        expect(menuValue(Object.fromEntries(restored.blocks.map(block => [block.id, block])), 'draw'))
            .toBe('video:clip');
    });
});

const project = blocks => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {media: ['media', 'costume:Logo']},
        lists: {},
        broadcasts: {},
        blocks,
        comments: {},
        costumes: [],
        sounds: [],
        currentCostume: 0,
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: ['objects'],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});
const load = async json => {
    const vm = new VM();
    installObjectBlocks(vm);
    await vm.loadProject(JSON.stringify(json));
    return vm;
};
const runDraw = (vm, compilerEnabled) => {
    vm.setCompilerOptions({enabled: compilerEnabled});
    const runtime = vm.runtime;
    const drawObject = jest.fn();
    runtime.movieAssetManager = {drawObject, runWithoutWaiting: jest.fn()};
    const target = runtime.targets[0];
    const script = Object.values(target.blocks._blocks).find(block => block.opcode === 'objects_draw');
    const thread = runtime._pushThread(script.id, target);
    runtime.sequencer.stepThreads();
    expect(thread.isCompiled).toBe(compilerEnabled);
    expect(drawObject).toHaveBeenCalledTimes(1);
    const context = drawObject.mock.calls[0][1];
    return {asset: context.asset, source: context.source};
};

describe('loading and executing draw media', () => {
    test.each([true, false])('draws legacy field media after load/save/reload (compiler: %s)', async compiler => {
        const vm = await load(project({
            draw: node('objects_draw', {}, {ASSET: ['costume:Logo', null], SOURCE: ['costume', null]})
        }));
        expect(runDraw(vm, compiler)).toEqual({asset: 'Logo', source: 'costume'});

        const saved = JSON.parse(vm.toJSON());
        const savedDraw = Object.values(saved.targets[0].blocks).find(block => block.opcode === 'objects_draw');
        expect(savedDraw.fields.ASSET).toBeUndefined();
        expect(saved.targets[0].blocks[savedDraw.inputs.ASSET[1]].opcode).toBe(DRAW_MEDIA_MENU);

        const reloaded = await load(saved);
        expect(runDraw(reloaded, compiler)).toEqual({asset: 'Logo', source: 'costume'});
    });

    test.each([true, false])('draws media chosen by a reporter (compiler: %s)', async compiler => {
        const vm = await load(project({
            draw: node('objects_draw', {ASSET: [3, 'join', 'menu']}, {SOURCE: ['costume', null]}),
            menu: menu('draw', 'costume:Logo'),
            join: node('operator_join', {STRING1: [1, [10, 'video:']], STRING2: [1, [10, 'clip']]}, {}, 'draw')
        }));
        expect(runDraw(vm, compiler)).toEqual({asset: 'clip', source: 'video'});
    });

    test.each([true, false])('decodes unprefixed reporter names with the menu source (compiler: %s)', async compiler => {
        const vm = await load(project({
            draw: node('objects_draw', {ASSET: [3, [12, 'media', 'media'], 'menu']}, {SOURCE: ['text', null]}),
            menu: menu('draw', 'text:serif')
        }));
        vm.runtime.targets[0].variables.media.value = 'Movie Sans';
        expect(runDraw(vm, compiler)).toEqual({asset: 'Movie Sans', source: 'text'});
    });
});
