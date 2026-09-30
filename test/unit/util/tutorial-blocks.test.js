jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import VM from 'scratch-vm';

import {
    TUTORIAL_STAGES,
    applyTutorialStage,
    buildStageBlocks,
    getTutorialTarget,
    isTutorialBlockId,
    releaseTutorialBlocks,
    tutorialBlockId
} from '../../../src/lib/tutorial/tutorial-blocks';

const sprite = (name, blocks = {}) => ({
    isStage: false,
    name,
    variables: {},
    lists: {},
    broadcasts: {},
    blocks,
    comments: {},
    currentCostume: 0,
    costumes: [],
    sounds: [],
    volume: 100,
    visible: false,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around'
});

const projectJSON = userBlocks => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100
    }, sprite('main', userBlocks)],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const loadVM = async (userBlocks = {}) => {
    const vm = new VM();
    await vm.loadProject(JSON.stringify(projectJSON(userBlocks)));
    vm.setEditingTarget(vm.runtime.targets.find(target => !target.isStage).id);
    return vm;
};

const tutorialBlocksOf = target => Object.values(target.blocks._blocks).filter(block => isTutorialBlockId(block.id));

const inputBlock = (target, blockId, inputName) => {
    const input = target.blocks.getBlock(blockId).inputs[inputName];
    return input ? target.blocks.getBlock(input.block) : null;
};

const shadowValue = (target, blockId, inputName) => {
    const block = inputBlock(target, blockId, inputName);
    return block && block.shadow ? Object.values(block.fields)[0].value : null;
};

const easingValues = (target, easingId) => ({
    type: target.blocks.getBlock(easingId).fields.TYPE.value,
    values: ['V0', 'V1', 'T0', 'T1', 'POWER'].map(name => Number(shadowValue(target, easingId, name)))
});

describe('tutorial block stages', () => {
    test('every stage builds a self-contained script owned by the tutorial', () => {
        for (const stage of TUTORIAL_STAGES) {
            const blocks = buildStageBlocks(stage, {variables: {tmp: 'v1', i: 'v2', angle: 'v3'}});
            if (stage === 'none') {
                expect(blocks).toEqual([]);
                continue;
            }
            const ids = new Set(blocks.map(block => block.id));
            expect(ids.size).toBe(blocks.length);
            expect(blocks.every(block => isTutorialBlockId(block.id))).toBe(true);
            expect(blocks.filter(block => block.topLevel).map(block => block.id)).toEqual([tutorialBlockId('hat')]);
            expect(blocks[0].opcode).toBe('event_renderframe');
            for (const block of blocks) {
                if (block.parent) expect(ids.has(block.parent)).toBe(true);
                if (block.next) expect(ids.has(block.next)).toBe(true);
                for (const input of Object.values(block.inputs)) {
                    expect(ids.has(input.block)).toBe(true);
                    if (input.shadow) expect(ids.has(input.shadow)).toBe(true);
                }
            }
        }
    });

    test('builds each milestone the tutorial explains', async () => {
        const vm = await loadVM();
        const target = getTutorialTarget(vm);
        const id = tutorialBlockId;

        applyTutorialStage(vm, 'draw');
        const draw = target.blocks.getBlock(id('draw'));
        expect(draw.opcode).toBe('objects_draw');
        expect(draw.parent).toBe(id('hat'));
        expect(draw.fields.ASSET.value).toBe('text:sans-serif');
        expect(draw.mutation.source).toBe('text');
        expect(shadowValue(target, id('draw'), 'TEXT')).toBe('Hello Shading!');

        applyTutorialStage(vm, 'camera');
        expect(target.blocks.getBlock(id('hat')).next).toBe(id('camera'));
        expect(target.blocks.getBlock(id('camera')).next).toBe(id('draw'));

        applyTutorialStage(vm, 'cameraEasing');
        expect(inputBlock(target, id('camera'), 'Z').id).toBe(id('cameraEasing'));
        expect(easingValues(target, id('cameraEasing'))).toEqual({type: 'PowerOut', values: [480, 0, 0, 1.5, 3]});

        applyTutorialStage(vm, 'xEasing');
        expect(inputBlock(target, id('draw'), 'PX').opcode).toBe('operator_add');
        expect(easingValues(target, id('xEasingIn'))).toEqual({type: 'PowerIn', values: [0, 100, 0, 1, 2]});
        expect(easingValues(target, id('xEasingOut'))).toEqual({type: 'PowerOut', values: [0, 100, 1, 2, 2]});

        applyTutorialStage(vm, 'tmp');
        const tmp = target.lookupVariableByNameAndType('tmp', '');
        expect(tmp).toBeTruthy();
        expect(target.blocks.getBlock(id('setTmp')).fields.VARIABLE.id).toBe(tmp.id);
        expect(inputBlock(target, id('setTmp'), 'VALUE').opcode).toBe('operator_add');
        expect(inputBlock(target, id('draw'), 'PX').opcode).toBe('data_variable');

        applyTutorialStage(vm, 'grouping');
        const grouping = target.blocks.getBlock(id('grouping'));
        expect(grouping.parent).toBe(id('setTmp'));
        expect(grouping.inputs.SUBSTACK.block).toBe(id('draw'));
        expect(grouping.inputs.SUBSTACK2.block).toBe(id('colorOverlay'));
        expect(shadowValue(target, id('colorOverlay'), 'COLOR')).toBe('#ff0000');

        applyTutorialStage(vm, 'example');
        expect(target.lookupVariableByNameAndType('i', '')).toBeTruthy();
        expect(target.lookupVariableByNameAndType('angle', '')).toBeTruthy();
        expect(inputBlock(target, id('ifCaption'), 'CONDITION').opcode).toBe('objects_timeWithin');
        expect(inputBlock(target, id('angleSpeed'), 'NUM1').opcode).toBe('sensing_timer');
    });

    test('re-applying a stage is idempotent and reuses variables', async () => {
        const vm = await loadVM();
        const target = getTutorialTarget(vm);
        applyTutorialStage(vm, 'example');
        const count = tutorialBlocksOf(target).length;
        const variableCount = Object.keys(target.variables).length;
        applyTutorialStage(vm, 'example');
        expect(tutorialBlocksOf(target)).toHaveLength(count);
        expect(Object.keys(target.variables)).toHaveLength(variableCount);
        expect(target.blocks.getScripts().filter(isTutorialBlockId)).toEqual([tutorialBlockId('hat')]);

        applyTutorialStage(vm, 'none');
        expect(tutorialBlocksOf(target)).toHaveLength(0);
        expect(target.blocks.getScripts()).toEqual([]);
    });

    test('keeps the user\'s own blocks, including ones attached to the tutorial script', async () => {
        const vm = await loadVM({
            own: {
                opcode: 'event_whenflagclicked',
                next: null,
                parent: null,
                inputs: {},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 600,
                y: 20
            }
        });
        const target = getTutorialTarget(vm);
        applyTutorialStage(vm, 'draw');
        // The user drags a block of their own under the tutorial's draw block.
        target.blocks.createBlock({
            id: 'attached',
            opcode: 'objects_clear',
            inputs: {},
            fields: {},
            next: null,
            parent: tutorialBlockId('draw'),
            shadow: false,
            topLevel: false
        });
        target.blocks.getBlock(tutorialBlockId('draw')).next = 'attached';
        // …and moves the tutorial script.
        target.blocks.getBlock(tutorialBlockId('hat')).x = 300;

        applyTutorialStage(vm, 'camera');
        expect(target.blocks.getBlock('own').topLevel).toBe(true);
        const attached = target.blocks.getBlock('attached');
        expect(attached.parent).toBeNull();
        expect(attached.topLevel).toBe(true);
        expect(target.blocks.getScripts()).toEqual(expect.arrayContaining(['own', 'attached', tutorialBlockId('hat')]));
        expect(target.blocks.getBlock(tutorialBlockId('hat')).x).toBe(300);
        expect(target.blocks.getBlock(tutorialBlockId('draw')).next).toBeNull();
    });

    test('tutorial scripts serialize into a consistent project.json', async () => {
        const vm = await loadVM();
        applyTutorialStage(vm, 'example');
        const saved = JSON.parse(vm.toJSON());
        const main = saved.targets.find(target => target.name === 'main');
        const savedBlocks = main.blocks;
        expect(saved.extensions).toEqual(expect.arrayContaining(['objects', 'penfx']));
        expect(Object.values(savedBlocks).some(block => block.opcode === 'penfx_colorOverlay')).toBe(true);
        const variableNames = Object.values(main.variables).map(([name]) => name);
        expect(variableNames.sort()).toEqual(['angle', 'i', 'tmp']);
        for (const [id, block] of Object.entries(savedBlocks)) {
            if (Array.isArray(block)) continue; // Compressed variable reporter.
            if (block.parent) expect(savedBlocks[block.parent]).toBeDefined();
            if (block.next) expect(savedBlocks[block.next].parent).toBe(id);
            for (const input of Object.values(block.inputs)) {
                for (const reference of input.slice(1)) {
                    if (typeof reference === 'string') expect(savedBlocks[reference]).toBeDefined();
                }
            }
        }
    });

    test('releasing hands the script over to the user and a new run starts below it', async () => {
        const vm = await loadVM();
        const target = getTutorialTarget(vm);
        applyTutorialStage(vm, 'example');
        const count = Object.keys(target.blocks._blocks).length;
        const hat = target.blocks.getBlock(tutorialBlockId('hat'));
        const hatY = hat.y;

        expect(releaseTutorialBlocks(vm)).toBe(true);
        expect(tutorialBlocksOf(target)).toHaveLength(0);
        expect(Object.keys(target.blocks._blocks)).toHaveLength(count);
        const scripts = target.blocks.getScripts();
        expect(scripts).toHaveLength(1);
        const released = target.blocks.getBlock(scripts[0]);
        expect(released.opcode).toBe('event_renderframe');
        for (const block of Object.values(target.blocks._blocks)) {
            if (block.parent) expect(target.blocks.getBlock(block.parent)).toBeDefined();
            if (block.next) expect(target.blocks.getBlock(block.next).parent).toBe(block.id);
            for (const input of Object.values(block.inputs)) {
                expect(target.blocks.getBlock(input.block)).toBeDefined();
            }
        }
        expect(releaseTutorialBlocks(vm)).toBe(false);

        // Running the tutorial again keeps the released script and starts a new one below it.
        applyTutorialStage(vm, 'none');
        expect(Object.keys(target.blocks._blocks)).toHaveLength(count);
        applyTutorialStage(vm, 'hat');
        expect(target.blocks.getBlock(scripts[0])).toBe(released);
        expect(target.blocks.getBlock(tutorialBlockId('hat')).y).toBeGreaterThan(hatY);
        applyTutorialStage(vm, 'hat', {freePosition: {x: 10, y: 20}});
        // An existing tutorial script keeps its place.
        expect(target.blocks.getBlock(tutorialBlockId('hat')).y).toBeGreaterThan(hatY);
    });
});
