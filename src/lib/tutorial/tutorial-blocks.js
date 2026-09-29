import uid from 'scratch-vm/src/util/uid';

// Scripts the first-run tutorial places in the project, one cumulative stage per tutorial milestone.
// Every block the tutorial owns has an id starting with TUTORIAL_BLOCK_PREFIX, so a stage can be
// re-applied at any time (moving back and forth, or resuming after a reload) without touching the
// user's own scripts. When the tutorial ends, releaseTutorialBlocks hands the script over to the user.

const TUTORIAL_BLOCK_PREFIX = 'shadingTutorial_';

const HELLO_TEXT = 'Hello Shading!';
const TEXT_FONT_ASSET = 'sans-serif';
const RED = '#ff0000';

// The order matters: a later stage contains everything the earlier ones demonstrated.
const TUTORIAL_STAGES = Object.freeze([
    'none',
    'hat',
    'draw',
    'camera',
    'cameraEasing',
    'xEasing',
    'tmp',
    'grouping',
    'example'
]);

// Variables each stage needs; they are created on the tutorial sprite when missing.
const STAGE_VARIABLES = Object.freeze({
    tmp: ['tmp'],
    grouping: ['tmp'],
    example: ['tmp', 'i', 'angle']
});

const tutorialBlockId = key => `${TUTORIAL_BLOCK_PREFIX}${key}`;
const isTutorialBlockId = id => typeof id === 'string' && id.startsWith(TUTORIAL_BLOCK_PREFIX);

const stageIndex = stage => {
    const index = TUTORIAL_STAGES.indexOf(stage);
    if (index < 0) throw new Error(`Unknown tutorial stage: ${stage}`);
    return index;
};

// ---------------------------------------------------------------------------------------------
// A tiny description language for scripts. A node is {key, opcode, inputs, fields, mutation, next}.
// Input values are either a shadow ({shadow, field, value}), a shadow with a reporter on top of it
// ({shadow, field, value, block: node}) or a bare node (statement inputs and boolean slots).

const shadow = (opcode, field) => (value, block = null) => ({shadow: opcode, field, value: String(value), block});
const num = shadow('math_number', 'NUM');
const whole = shadow('math_whole_number', 'NUM');
const text = shadow('text', 'TEXT');
const color = shadow('colour_picker', 'COLOUR');
const timeRange = (start, end) => shadow('math_time_range', 'RANGE')(`${start}~${end}`);

const node = (key, opcode, spec = {}) => Object.assign({key, opcode}, spec);

// Link statement nodes into a stack and return the first one.
const stack = (...nodes) => {
    const list = nodes.filter(Boolean);
    for (let index = 0; index < list.length - 1; index++) list[index].next = list[index + 1];
    return list[0] || null;
};

const variableField = (variables, name) => ({value: name, id: variables[name], variableType: ''});

const flatten = (script, parentId, out) => {
    const id = tutorialBlockId(script.key);
    const block = {
        id,
        opcode: script.opcode,
        inputs: {},
        fields: {},
        next: null,
        parent: parentId,
        shadow: false,
        topLevel: !parentId
    };
    if (!parentId) {
        block.x = script.x || 0;
        block.y = script.y || 0;
    }
    if (script.mutation) {
        block.mutation = Object.assign({tagName: 'mutation', children: []}, script.mutation);
    }
    for (const [name, value] of Object.entries(script.fields || {})) {
        block.fields[name] = value && typeof value === 'object' ?
            Object.assign({name}, value) :
            {name, value: String(value)};
    }
    out.push(block);
    for (const [name, value] of Object.entries(script.inputs || {})) {
        if (!value) continue;
        let shadowId = null;
        let blockId = null;
        if (value.shadow) {
            shadowId = `${id}.${name}`;
            out.push({
                id: shadowId,
                opcode: value.shadow,
                inputs: {},
                fields: {[value.field]: {name: value.field, value: value.value}},
                next: null,
                parent: id,
                shadow: true,
                topLevel: false
            });
            blockId = value.block ? flatten(value.block, id, out) : shadowId;
        } else {
            blockId = flatten(value, id, out);
        }
        block.inputs[name] = {name, block: blockId, shadow: shadowId};
    }
    if (script.next) block.next = flatten(script.next, id, out);
    return id;
};

// ---------------------------------------------------------------------------------------------
// Blocks used by the stages.

const drawText = (key, options = {}) => node(key, 'objects_draw', {
    fields: {
        ASSET: `text:${TEXT_FONT_ASSET}`,
        SOURCE: 'text',
        VIDEO_MODE: 'sequence'
    },
    mutation: {'source': 'text', 'asset': TEXT_FONT_ASSET, 'video-mode': 'sequence'},
    inputs: {
        TEXT: options.text || text(HELLO_TEXT),
        ITALIC: num(0),
        FRAME: num(1),
        SPEED: num(1),
        VOLUME: num(100),
        PX: options.px || num(0),
        PY: options.py || num(0),
        PZ: num(480),
        RX: num(0),
        RY: num(0),
        RZ: options.rz || num(0),
        SX: num(1),
        SY: num(1),
        SZ: num(1),
        SIZE: num(options.size || 50),
        WIDTH: num(100),
        HEIGHT: num(100),
        TIME_RANGE: timeRange(0, 'Infinity')
    }
});

const easing = (key, type, v0, v1, t0, t1, power) => node(key, 'operator_easing', {
    fields: {TYPE: type, TYPE2: 'Elastic'},
    inputs: {
        V0: num(v0),
        V1: num(v1),
        TIME_RANGE: timeRange(t0, t1),
        POWER: num(power),
        SPEED: num(0),
        STRENGTH: num(1)
    }
});

const binary = (key, opcode, left, right) => node(key, opcode, {
    inputs: {NUM1: left, NUM2: right}
});

const variableReporter = (key, variables, name) => node(key, 'data_variable', {
    fields: {VARIABLE: variableField(variables, name)}
});

const setVariable = (key, variables, name, value) => node(key, 'data_setvariableto', {
    fields: {VARIABLE: variableField(variables, name)},
    inputs: {VALUE: value}
});

const changeVariable = (key, variables, name, value) => node(key, 'data_changevariableby', {
    fields: {VARIABLE: variableField(variables, name)},
    inputs: {VALUE: value}
});

const cameraEasing = () => easing('cameraEasing', 'PowerOut', 480, 0, 0, 1.5, 3);

const camera = stage => node('camera', 'motion_setcamerato', {
    inputs: {
        X: num(0),
        Y: num(0),
        Z: stageIndex(stage) >= stageIndex('cameraEasing') ? num(0, cameraEasing()) : num(0)
    }
});

// (easing In 0 → 100 over 0–1 s) + (easing Out 0 → 100 over 1–2 s)
const xMotion = () => binary(
    'xSum',
    'operator_add',
    num('', easing('xEasingIn', 'PowerIn', 0, 100, 0, 1, 2)),
    num('', easing('xEasingOut', 'PowerOut', 0, 100, 1, 2, 2))
);

const colorOverlay = (key, mix = num(100)) => node(key, 'penfx_colorOverlay', {
    inputs: {COLOR: color(RED), MIX: mix}
});

const letterCount = key => node(key, 'operator_length', {inputs: {STRING: text(HELLO_TEXT)}});

// The finished animation: every letter of "Hello Shading!" orbits the centre on a circle whose radius
// eases open, the ring turns red inside its own group, and a caption appears after 1.5 seconds.
const exampleScript = variables => stack(
    node('hat', 'event_renderframe'),
    camera('example'),
    setVariable('setRadius', variables, 'tmp', text('', easing('radiusEasing', 'PowerOut', 0, 120, 0, 2, 3))),
    setVariable('setIndex', variables, 'i', text(1)),
    setVariable('setAngle', variables, 'angle', text('', binary(
        'angleSpeed', 'operator_multiply', num('', node('timer', 'sensing_timer')), num(30)
    ))),
    node('grouping', 'objects_grouping', {
        inputs: {
            SUBSTACK: node('repeat', 'control_repeat', {
                inputs: {
                    TIMES: whole(14, letterCount('letterCount')),
                    SUBSTACK: stack(
                        drawText('draw', {
                            text: text('', node('letter', 'operator_letter_of', {
                                inputs: {
                                    LETTER: whole(1, variableReporter('letterIndex', variables, 'i')),
                                    STRING: text(HELLO_TEXT)
                                }
                            })),
                            px: num('', binary(
                                'circleX',
                                'operator_multiply',
                                num('', node('sin', 'operator_mathop', {
                                    fields: {OPERATOR: 'sin'},
                                    inputs: {NUM: num('', variableReporter('sinAngle', variables, 'angle'))}
                                })),
                                num('', variableReporter('radiusX', variables, 'tmp'))
                            )),
                            py: num('', binary(
                                'circleY',
                                'operator_multiply',
                                num('', node('cos', 'operator_mathop', {
                                    fields: {OPERATOR: 'cos'},
                                    inputs: {NUM: num('', variableReporter('cosAngle', variables, 'angle'))}
                                })),
                                num('', variableReporter('radiusY', variables, 'tmp'))
                            )),
                            rz: num('', variableReporter('letterAngle', variables, 'angle'))
                        }),
                        changeVariable('nextIndex', variables, 'i', num(1)),
                        changeVariable('nextAngle', variables, 'angle', num('', binary(
                            'angleStep', 'operator_divide', num(360), num('', letterCount('angleStepCount'))
                        )))
                    )
                }
            }),
            SUBSTACK2: colorOverlay('colorOverlay', num('', easing('overlayEasing', 'PowerInOut', 0, 100, 2, 3, 2)))
        }
    }),
    node('ifCaption', 'control_if', {
        inputs: {
            // 10 s is the length of a new project's timeline.
            CONDITION: node('captionTime', 'objects_timeWithin', {
                inputs: {TIME_RANGE: timeRange(1.5, 10)}
            }),
            SUBSTACK: drawText('caption', {text: text('Shading'), size: 30})
        }
    })
);

/**
 * Build the tutorial's script for a stage.
 * @param {string} stage One of TUTORIAL_STAGES.
 * @param {object} [variables] Variable ids by name for the variables the stage uses.
 * @returns {?object} Script description, or null when the stage has no script.
 */
const buildStageScript = (stage, variables = {}) => {
    const index = stageIndex(stage);
    if (index === stageIndex('none')) return null;
    if (stage === 'example') return exampleScript(variables);
    const hat = node('hat', 'event_renderframe');
    if (index === stageIndex('hat')) return hat;

    const px = index >= stageIndex('tmp') ?
        num('', variableReporter('tmpReporter', variables, 'tmp')) :
        (index >= stageIndex('xEasing') ? num('', xMotion()) : num(0));
    const draw = drawText('draw', {px});
    if (index === stageIndex('draw')) return stack(hat, draw);

    const setTmp = index >= stageIndex('tmp') ? setVariable('setTmp', variables, 'tmp', text('', xMotion())) : null;
    const body = index >= stageIndex('grouping') ?
        node('grouping', 'objects_grouping', {
            inputs: {
                SUBSTACK: draw,
                SUBSTACK2: colorOverlay('colorOverlay')
            }
        }) :
        draw;
    return stack(hat, camera(stage), setTmp, body);
};

/**
 * Flatten a stage into Scratch VM blocks (the format of `target.blocks._blocks`).
 * @param {string} stage One of TUTORIAL_STAGES.
 * @param {object} [options] Options.
 * @param {object} [options.variables] Variable ids by name.
 * @param {number} [options.x] Position of the script.
 * @param {number} [options.y] Position of the script.
 * @returns {Array<object>} Blocks; the first one is the top-level block.
 */
const buildStageBlocks = (stage, options = {}) => {
    const script = buildStageScript(stage, options.variables || {});
    if (!script) return [];
    script.x = Number.isFinite(options.x) ? options.x : 48;
    script.y = Number.isFinite(options.y) ? options.y : 48;
    const blocks = [];
    flatten(script, null, blocks);
    return blocks;
};

/**
 * The sprite the tutorial builds in: Shading's `main` sprite, falling back to the editing sprite.
 * @param {object} vm Scratch VM.
 * @returns {?object} Rendered target.
 */
const getTutorialTarget = vm => {
    const targets = (vm && vm.runtime && vm.runtime.targets) || [];
    const sprites = targets.filter(target => target.isOriginal && !target.isStage);
    return sprites.find(sprite => sprite.getName() === 'main') ||
        (vm.editingTarget && !vm.editingTarget.isStage ? vm.editingTarget : null) ||
        sprites[0] ||
        null;
};

const ensureVariables = (target, names) => {
    const variables = {};
    for (const name of names) {
        const existing = target.lookupVariableByNameAndType(name, '');
        if (existing) {
            variables[name] = existing.id;
            continue;
        }
        let id = `${TUTORIAL_BLOCK_PREFIX}var_${name}`;
        // The user may have renamed a variable the tutorial created earlier; keep theirs.
        for (let suffix = 2; target.lookupVariableById(id); suffix++) {
            id = `${TUTORIAL_BLOCK_PREFIX}var_${name}_${suffix}`;
        }
        target.createVariable(id, name, '');
        variables[name] = id;
    }
    return variables;
};

/**
 * Remove every tutorial-owned block from a target. The user's blocks that were attached to the tutorial
 * script stay in the project as their own scripts.
 * @param {object} target Rendered target.
 * @returns {?{x: number, y: number}} Where the tutorial's script was, if it existed.
 */
const removeTutorialBlocks = target => {
    const container = target.blocks;
    const blocks = container._blocks;
    const hat = blocks[tutorialBlockId('hat')];
    const position = hat && hat.topLevel ? {x: Number(hat.x) || 0, y: Number(hat.y) || 0} : null;
    let detachedOffset = 0;
    for (const block of Object.values(blocks)) {
        if (isTutorialBlockId(block.id)) continue;
        if (isTutorialBlockId(block.next)) block.next = null;
        for (const input of Object.values(block.inputs || {})) {
            if (isTutorialBlockId(input.shadow)) input.shadow = null;
            if (isTutorialBlockId(input.block)) input.block = input.shadow;
        }
        if (isTutorialBlockId(block.parent)) {
            block.parent = null;
            block.topLevel = true;
            block.x = (position ? position.x : 0) + 520;
            block.y = (position ? position.y : 0) + detachedOffset;
            detachedOffset += 64;
            container._addScript(block.id);
        }
    }
    for (const id of Object.keys(blocks)) {
        if (!isTutorialBlockId(id)) continue;
        container._deleteScript(id);
        delete blocks[id];
    }
    for (const comment of Object.values(target.comments || {})) {
        if (isTutorialBlockId(comment.blockId)) comment.blockId = null;
    }
    container.resetCache();
    return position;
};

// Without layout information, start a new script well below the lowest existing one.
const guessFreePosition = target => {
    const tops = target.blocks.getScripts()
        .map(id => target.blocks.getBlock(id))
        .filter(block => block && !isTutorialBlockId(block.id));
    if (!tops.length) return null;
    return {x: 48, y: Math.max(...tops.map(block => Number(block.y) || 0)) + 720};
};

const refreshEditor = (vm, target) => {
    if (vm.editingTarget === target) {
        vm.emitWorkspaceUpdate();
    } else {
        vm.setEditingTarget(target.id);
    }
};

/**
 * Make the tutorial's script match a stage. Safe to call repeatedly with the same stage.
 * @param {object} vm Scratch VM.
 * @param {string} stage One of TUTORIAL_STAGES.
 * @param {object} [options] Options.
 * @param {{x: number, y: number}} [options.freePosition] Where to start the script when the tutorial has not
 *     placed one yet (for example below the user's scripts). Guessed from the project when omitted.
 * @returns {?object} The target that holds the script, or null when the project has no sprite.
 */
const applyTutorialStage = (vm, stage, options = {}) => {
    stageIndex(stage);
    const target = getTutorialTarget(vm);
    if (!target) return null;
    const hasTutorialBlocks = Object.keys(target.blocks._blocks).some(isTutorialBlockId);
    // Opening the tutorial on a project must not mark it as changed.
    if (stage === 'none' && !hasTutorialBlocks) return target;
    const position = removeTutorialBlocks(target) || options.freePosition || guessFreePosition(target);
    const variables = ensureVariables(target, STAGE_VARIABLES[stage] || []);
    const blocks = buildStageBlocks(stage, Object.assign({variables}, position || {}));
    for (const block of blocks) target.blocks.createBlock(block);
    target.blocks.resetCache();
    if (typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    refreshEditor(vm, target);
    return target;
};

/**
 * Give the tutorial's blocks ordinary ids, so they become the user's own script: a later tutorial run no longer
 * replaces or removes them.
 * @param {object} vm Scratch VM.
 * @returns {boolean} Whether there were tutorial blocks to release.
 */
const releaseTutorialBlocks = vm => {
    const target = getTutorialTarget(vm);
    if (!target) return false;
    const container = target.blocks;
    const blocks = container._blocks;
    const ids = Object.keys(blocks).filter(isTutorialBlockId);
    if (!ids.length) return false;
    const renamed = new Map(ids.map(id => [id, uid()]));
    const rename = id => (renamed.has(id) ? renamed.get(id) : id);
    for (const id of ids) {
        const block = blocks[id];
        delete blocks[id];
        block.id = renamed.get(id);
        blocks[block.id] = block;
    }
    for (const block of Object.values(blocks)) {
        block.parent = rename(block.parent);
        block.next = rename(block.next);
        for (const input of Object.values(block.inputs || {})) {
            input.block = rename(input.block);
            input.shadow = rename(input.shadow);
        }
    }
    container._scripts = container._scripts.map(rename);
    for (const comment of Object.values(target.comments || {})) {
        comment.blockId = rename(comment.blockId);
    }
    container.resetCache();
    if (typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    refreshEditor(vm, target);
    return true;
};

export {
    HELLO_TEXT,
    STAGE_VARIABLES,
    TUTORIAL_BLOCK_PREFIX,
    TUTORIAL_STAGES,
    applyTutorialStage,
    buildStageBlocks,
    getTutorialTarget,
    isTutorialBlockId,
    releaseTutorialBlocks,
    removeTutorialBlocks,
    stageIndex,
    tutorialBlockId
};
