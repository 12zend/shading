/* eslint-env jest */
import VM from 'scratch-vm';
import JSZip from '@turbowarp/jszip';
import {installShadingTimeline} from '../../../src/lib/shading/runtime/timeline';
import {ShadingScene} from '../../../src/lib/shading/runtime/scene';
import {definitions, registerShadingBlocks} from '../../../src/lib/shading/blocks';
import {gradePixels, blurPixels, autoGradePixels, edgeIndex} from '../../../src/lib/shading/effects';
import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

const addComposition = (scene, NAME = 'Main') => scene.addComposition({NAME, WIDTH: 320, HEIGHT: 180,
    FRAMERATE: 24, COLOR: '#000000'});
const makeVM = () => new VM();

const blockChain = () => {
    const blocks = {};
    const selected = definitions.filter(block => block.shape !== 'reporter' &&
        !['shade_deleteComposition', 'shade_deleteLayer', 'shade_selectComposition',
            'shade_initComposition', 'shade_initLayer'].includes(block.opcode));
    blocks.hat = {opcode: 'event_renderframe', topLevel: true, parent: null,
        next: 'block0', fields: {}, inputs: {}, x: 0, y: 0, shadow: false};
    selected.forEach((definition, index) => {
        const id = `block${index}`;
        const inputs = {};
        definition.args.forEach(arg => {
            inputs[arg.name] = [1, [arg.type === 'number' ? 4 : (arg.type === 'color' ? 9 : 10), String(arg.value)]];
        });
        if (definition.opcode === 'shade_setPosition') {
            inputs.X = [2, 'time'];
            blocks.time = {opcode: 'shade_time', inputs: {}, fields: {}, parent: id, next: null,
                shadow: false, topLevel: false};
        }
        blocks[id] = {opcode: definition.opcode, fields: {}, inputs, topLevel: false,
            parent: index === 0 ? 'hat' : `block${index - 1}`,
            next: index === selected.length - 1 ? null : `block${index + 1}`, shadow: false};
    });
    return {targets: [{isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks,
        costumes: [{assetId: "00000000000000000000000000000000", dataFormat: "svg",
            md5ext: "00000000000000000000000000000000.svg", name: "backdrop1", bitmapResolution: 1,
            rotationCenterX: 240, rotationCenterY: 180}], sounds: [], currentCostume: 0, volume: 100}], monitors: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: 'Shading test'}};
};

describe('Shading scene', () => {
    let vm;
    let scene;
    beforeEach(() => { vm = makeVM(); scene = new ShadingScene(vm); });
    afterEach(() => vm.runtime.dispose());

    test('layer creation snapshots the last setters and updates by name', () => {
        addComposition(scene);
        scene.setPosition({X: 10, Y: 20});
        scene.setScale({SCALE: 200});
        scene.addShape({NAME: 'shape', TYPE: 'star'});
        const original = scene.composition.layers.get('shape');
        scene.setPosition({X: 30, Y: 40});
        expect(original.transform.position).toEqual([10, 20]);
        scene.addShape({NAME: 'shape', TYPE: 'flower'});
        expect(scene.composition.layers.size).toBe(1);
        expect(scene.composition.layers.get('shape').transform).toMatchObject({position: [30, 40], scale: 200});
    });
    test('init layer clears every composition, keeps compositions and last setters', () => {
        addComposition(scene, 'One'); scene.addNull({NAME: 'parent'});
        addComposition(scene, 'Two'); scene.addShape({NAME: 'child'});
        scene.setRotation({DEGREES: 45});
        scene.initLayer();
        expect(scene.compositions.size).toBe(2);
        expect(Array.from(scene.compositions.values()).every(c => c.layers.size === 0)).toBe(true);
        expect(scene.settings.rotation).toBe(45);
        scene.initComposition();
        expect(scene.compositions.size).toBe(0);
        expect(scene.active).toBe('');
    });
    test('rejects parent cycles including forward references', () => {
        addComposition(scene);
        scene.addNull({NAME: 'A', PARENT: 'B'});
        expect(() => scene.addNull({NAME: 'B', PARENT: 'A'})).toThrow('cycle');
        expect(scene.composition.layers.has('B')).toBe(false);
    });
    test('each layer has its own ordered effects and updates avoid accumulation', () => {
        addComposition(scene);
        scene.addShape({NAME: 'A'});
        scene.blur({LAYER: 'A', RADIUS: 5});
        scene.blur({LAYER: 'A', RADIUS: 10});
        scene.addShape({NAME: 'A'});
        const effects = scene.composition.layers.get('A').effects;
        expect(effects.size).toBe(1);
        expect(effects.get('blur').RADIUS).toBe(10);
    });
});

describe('Shading native blocks', () => {
    test.each([false, true])('execute and round-trip without loading a shade extension (compiler %s)', async compiled => {
        const vm = makeVM();
        const timeline = installShadingTimeline(vm);
        vm.setCompilerOptions({enabled: compiled});
        await vm.loadProject(blockChain());
        timeline.seek(2.5);
        const scene = vm.runtime.shadingScene;
        expect(scene.composition.name).toBe('Composition 1');
        expect(scene.composition.layers.size).toBe(5);
        expect(scene.settings.position[0]).toBeCloseTo(2.5, 2);
        const zip = await JSZip.loadAsync(await vm.saveProjectSb3());
        const project = JSON.parse(await zip.file('project.json').async('string'));
        expect(project.extensions || []).not.toContain('shade');
        await vm.loadProject(project);
        timeline.seek(1.5);
        expect(scene.composition.layers.size).toBe(5);
        expect(scene.settings.position[0]).toBeCloseTo(1.5, 2);
        vm.runtime.dispose();
    });
    test('reporter uses a registered Scratch shape and palette excludes legacy categories', () => {
        const blocks = {Blocks: {}, OUTPUT_SHAPE_ROUND: 2};
        registerShadingBlocks(blocks, {runtime: {targets: []}});
        const jsonInit = jest.fn();
        blocks.Blocks.shade_time.init.call({jsonInit});
        expect(jsonInit.mock.calls[0][0].extensions).toEqual(['output_number']);
        const toolbox = makeToolboxXML(false);
        for (const definition of definitions) expect(toolbox).toContain(`type="${definition.opcode}"`);
        expect(toolbox).toContain('custom="PROCEDURE"');
        expect(toolbox).toContain('custom="VARIABLE"');
        expect(toolbox).toContain('type="control_repeat"');
        expect(toolbox).toContain('type="operator_add"');
        expect(toolbox).not.toMatch(/id="(motion|looks|sound|sensing)"/);
    });
});

describe('Shading pixel effects', () => {
    test('neutral grading preserves RGB and alpha', () => {
        const pixels = new Uint8ClampedArray([23, 123, 233, 128, 255, 0, 40, 255]);
        expect(Array.from(gradePixels(pixels.slice(), {}))).toEqual(Array.from(pixels));
    });
    test('saturation zero makes a neutral color and preserves alpha', () => {
        const result = gradePixels(new Uint8ClampedArray([255, 0, 0, 100]), {SATURATION: 0});
        expect(result[0]).toBe(result[1]);
        expect(result[1]).toBe(result[2]);
        expect(result[3]).toBe(100);
    });
    test('blur uses premultiplied alpha to avoid dark fringes', () => {
        const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
        const result = blurPixels(pixels, 3, 1, {RADIUS: 1, MODE: 'box', EDGE: 'transparent'});
        expect(result[4]).toBe(255);
        expect(result[7]).toBeGreaterThan(0);
        expect(result[7]).toBeLessThan(255);
    });
    test('edge modes and repeat pixels affect the edge alpha', () => {
        const pixel = new Uint8ClampedArray([255, 255, 255, 255]);
        expect(blurPixels(pixel.slice(), 1, 1, {RADIUS: 1, MODE: 'box', EDGE: 'clamp'})[3]).toBe(255);
        expect(blurPixels(pixel.slice(), 1, 1, {RADIUS: 1, MODE: 'box', EDGE: 'transparent'})[3]).toBeLessThan(255);
        expect(blurPixels(pixel.slice(), 1, 1, {RADIUS: 1, MODE: 'box', EDGE: 'transparent', REPEAT: 'true'})[3])
            .toBe(255);
        expect(edgeIndex(-2, 3, 'mirror')).toBe(1);
        expect(edgeIndex(3, 3, 'mirror')).toBe(2);
    });
    test('auto grading matches the reference average', () => {
        const result = autoGradePixels(new Uint8ClampedArray([50, 60, 70, 255]),
            new Uint8ClampedArray([100, 120, 140, 255]));
        expect(Array.from(result)).toEqual([100, 120, 140, 255]);
    });
});
