// The Simulation category and the VM side of the simulation runtime (lib/simulation/).
//
// A simulation is the scripts under `when simulation [NAME] initializes` (S0) and `when simulation [NAME] steps`
// (S(k) -> S(k + 1)). Their hats are EVENT hats that no ordinary path starts (green flag, render frame,
// broadcasts): only the simulation runtime runs them, each step to completion in one go, with the simulation
// context on the thread. Render-frame scripts read S(t) at their evaluation time and never write it.
import ArgumentType from '../extension-support/argument-type';
import BlockType from '../extension-support/block-type';
import Cast from '../util/cast';
import Thread from '../engine/thread';
import Variable from '../engine/variable';

import {getEvaluationTime} from './object-animation';
import {localize, resolveLocale} from './movie-block-l10n';
import {hashParts, randomInRange, seededRandomValue} from './simulation/seeded-random';
import {hashSimulationDefinition, hashText} from './simulation/simulation-hash';
import {DEFAULT_RATE, SimulationRuntime, clampRate} from './simulation/simulation-runtime';

const EXTENSION_ID = 'simulation';
const PRIMARY = '#2E8B8B';
const SECONDARY = '#277878';
const TERTIARY = '#1F6262';

const INITIALIZE_HAT = 'simulation_whenInitialized';
const STEP_HAT = 'simulation_whenStepped';

// Opcodes a simulation script may run. Everything else (drawing, PenFX, sprites, sound, cameras, broadcasts,
// waits, the local time and time-sampling blocks, wall-clock sensing) would make a step depend on something other
// than the previous state, so a simulation that contains it is not computed and reports an error instead.
const ALLOWED_PREFIXES = ['operator_', 'procedures_', 'argument_', 'math_', 'data_', 'control_', 'simulation_'];
const ALLOWED_OPCODES = new Set([
    'text', 'colour_picker', 'sensing_mousex', 'sensing_mousey', 'sensing_mousedown', 'sensing_keypressed',
    'sensing_keyoptions', 'sensing_timer'
]);
const FORBIDDEN_OPCODES = new Set([
    'control_wait', 'control_wait_until', 'control_create_clone_of', 'control_create_clone_of_menu',
    'control_delete_this_clone', 'control_stop', 'control_start_as_clone', 'data_showvariable',
    'data_hidevariable', 'data_showlist', 'data_hidelist', 'simulation_stateAt', 'simulation_listItemAt'
]);

const isAllowedOpcode = opcode => !FORBIDDEN_OPCODES.has(opcode) && (
    ALLOWED_OPCODES.has(opcode) || ALLOWED_PREFIXES.some(prefix => opcode.startsWith(prefix))
);

const warnings = new WeakMap();
const warnOnce = (runtime, key, message) => {
    if (!warnings.has(runtime)) warnings.set(runtime, new Set());
    const warned = warnings.get(runtime);
    if (warned.has(key)) return;
    warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[Simulation] ${message}`);
};

const getContext = util => (util && util.thread && util.thread.simulationContext) || null;

const toStateValue = value => {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value === null || typeof value === 'undefined' ? '' : value);
    const number = Number(text);
    return text.trim() !== '' && Number.isFinite(number) && String(number) === text.trim() ? number : text;
};

const listIndex = (index, length) => {
    const position = Math.floor(Cast.toNumber(index));
    return position >= 1 && position <= length ? position - 1 : -1;
};

const fieldOrInputText = (blocks, block, name) => {
    if (block.fields && block.fields[name]) return String(block.fields[name].value);
    const input = block.inputs && block.inputs[name];
    const shadow = input && blocks.getBlock(input.shadow || input.block);
    if (!shadow || !shadow.fields) return '';
    const field = shadow.fields.TEXT || shadow.fields.NUM || Object.values(shadow.fields)[0];
    return field ? String(field.value) : '';
};

// Evaluate a reporter block once (for a hat input that holds a reporter).
const evaluateReporter = (runtime, target, blockId) => {
    const thread = new Thread(blockId);
    thread.target = target;
    thread.blockContainer = target.blocks;
    thread.stackClick = true;
    thread.pushStack(blockId);
    thread.peekStackFrame().warpMode = true;
    let reported;
    const visualReport = runtime.visualReport;
    const sequencer = runtime.sequencer;
    const activeThread = sequencer.activeThread;
    runtime.visualReport = (reportTarget, id, value) => {
        reported = value;
    };
    try {
        sequencer.activeThread = thread;
        sequencer.stepThread(thread);
    } finally {
        sequencer.activeThread = activeThread;
        runtime.visualReport = visualReport;
    }
    return reported;
};

const hatInput = (runtime, target, block, name, fallback) => {
    const input = block.inputs && block.inputs[name];
    if (!input) return fallback;
    if (input.block && input.block !== input.shadow) {
        const value = Cast.toNumber(evaluateReporter(runtime, target, input.block));
        return Number.isFinite(value) ? value : fallback;
    }
    const text = fieldOrInputText(target.blocks, block, name);
    const value = Number(text);
    return text.trim() !== '' && Number.isFinite(value) ? value : fallback;
};

const cloneVariables = variables => {
    const copy = {};
    for (const id of Object.keys(variables || {})) {
        const variable = variables[id];
        const clone = new Variable(variable.id, variable.name, variable.type, variable.isCloud);
        clone.value = Array.isArray(variable.value) ? variable.value.slice() : variable.value;
        copy[id] = clone;
    }
    return copy;
};

// Walk a script (and the custom blocks it calls): the opcodes it uses and the variables it refers to.
const scanScript = (blocks, topId) => {
    const opcodes = new Set();
    const variableNames = new Set();
    const procedures = new Set();
    const visit = id => {
        const seen = new Set();
        const stack = [id];
        while (stack.length) {
            const blockId = stack.pop();
            if (!blockId || seen.has(blockId)) continue;
            seen.add(blockId);
            const block = blocks.getBlock(blockId);
            if (!block) continue;
            if (!block.shadow) opcodes.add(block.opcode);
            for (const name of ['VARIABLE', 'LIST']) {
                if (block.fields && block.fields[name]) variableNames.add(String(block.fields[name].value));
            }
            if (block.opcode === 'procedures_call' && block.mutation && block.mutation.proccode &&
                !procedures.has(block.mutation.proccode)) {
                procedures.add(block.mutation.proccode);
                const definition = blocks.getProcedureDefinition(block.mutation.proccode);
                if (definition) stack.push(definition);
            }
            for (const input of Object.values(block.inputs || {})) stack.push(input.block, input.shadow);
            stack.push(block.next);
        }
    };
    visit(topId);
    return {opcodes, procedures, variableNames};
};

/**
 * Collect the simulations of the project.
 * @param {Runtime} runtime The VM runtime.
 * @param {object} variableValues Ordinary variable values by target ID and variable ID (see captureVariables).
 * @returns {object[]} Definitions for SimulationRuntime.syncDefinitions.
 */
const collectSimulationDefinitions = (runtime, variableValues = {}) => {
    const byName = new Map();
    const targets = (runtime.targets || []).filter(target => target.isOriginal);
    for (const target of targets) {
        const blocks = target.blocks;
        for (const blockId of blocks.getScripts()) {
            const block = blocks.getBlock(blockId);
            if (!block || (block.opcode !== INITIALIZE_HAT && block.opcode !== STEP_HAT)) continue;
            const name = fieldOrInputText(blocks, block, 'NAME').trim() || 'simulation';
            if (!byName.has(name)) byName.set(name, {name, initialize: [], step: [], hatTarget: null, hatId: null});
            const definition = byName.get(name);
            const script = {targetId: target.id, hatId: blockId, firstId: block.next};
            if (block.opcode === INITIALIZE_HAT) {
                definition.initialize.push(script);
                if (!definition.hatId) {
                    definition.hatTarget = target;
                    definition.hatId = blockId;
                }
            } else {
                definition.step.push(script);
            }
        }
    }
    const definitions = [];
    for (const definition of byName.values()) {
        const hat = definition.hatTarget ? definition.hatTarget.blocks.getBlock(definition.hatId) : null;
        const start = hat ? hatInput(runtime, definition.hatTarget, hat, 'START', 0) : 0;
        const rate = clampRate(hat ? hatInput(runtime, definition.hatTarget, hat, 'RATE', DEFAULT_RATE) : DEFAULT_RATE);
        const errors = [];
        const scriptHashes = [];
        const variables = {};
        for (const script of definition.initialize.concat(definition.step)) {
            const target = runtime.getTargetById(script.targetId);
            const scan = scanScript(target.blocks, script.firstId);
            for (const opcode of scan.opcodes) {
                if (!isAllowedOpcode(opcode)) errors.push(`${opcode} cannot run in a simulation.`);
            }
            for (const variableName of scan.variableNames) {
                for (const owner of [target, runtime.getTargetForStage()].filter(Boolean)) {
                    const values = variableValues[owner.id] || {};
                    for (const id of Object.keys(values)) {
                        if (values[id].name !== variableName) continue;
                        variables[`${owner.getName()}/${variableName}`] = values[id].value;
                    }
                }
            }
            scriptHashes.push(hashSimulationDefinition({
                getBlock: id => target.blocks.getBlock(id),
                scriptIds: [script.hatId],
                getProcedureDefinition: proccode => target.blocks.getProcedureDefinition(proccode),
                inputs: {},
                assets: [],
                variables: {}
            }));
        }
        definitions.push({
            name: definition.name,
            start,
            rate,
            initialize: definition.initialize,
            step: definition.step,
            variableValues,
            errors: Array.from(new Set(errors)),
            hash: hashText([
                ...scriptHashes,
                JSON.stringify({start, rate}),
                JSON.stringify(Object.keys(variables).sort()
                    .map(key => [key, variables[key]]))
            ].join('\n'))
        });
    }
    return definitions;
};

// Ordinary variable values of every original target: what simulation scripts read (a copy, at every step).
const captureVariables = runtime => {
    const values = {};
    for (const target of (runtime.targets || []).filter(candidate => candidate.isOriginal)) {
        const variables = {};
        for (const id of Object.keys(target.variables || {})) {
            const variable = target.variables[id];
            if (variable.type === Variable.BROADCAST_MESSAGE_TYPE) continue;
            variables[id] = {
                name: variable.name,
                type: variable.type,
                value: Array.isArray(variable.value) ? variable.value.slice() : variable.value
            };
        }
        values[target.id] = variables;
    }
    return values;
};

// Input devices inside a step: fixed, so a step never depends on the mouse, the keyboard or the wall clock.
const FIXED_IO_DEVICES = {
    clock: {projectTimer: () => 0, projectTimerWithoutOffset: () => 0},
    mouse: {
        getScratchX: () => 0,
        getScratchY: () => 0,
        getClientX: () => 0,
        getClientY: () => 0,
        getIsDown: () => false,
        getButtonIsDown: () => false
    },
    keyboard: {getKeyIsDown: () => false},
    mouseWheel: {},
    userData: {getUsername: () => ''},
    video: {}
};

/**
 * Runs the simulation scripts of a VM for the simulation runtime.
 * @param {VirtualMachine} vm The VM.
 * @returns {object} Executor ({initialize, step}).
 */
const createSimulationExecutor = vm => {
    const runtime = vm.runtime;

    const runScripts = (definition, scripts, state, context) => {
        if (definition.errors && definition.errors.length) throw new Error(definition.errors[0]);
        const variableValues = definition.variableValues || {};
        const targets = new Map();
        const ioDevices = runtime.ioDevices;
        const randomPrimitive = runtime._primitives.operator_random;
        const sequencer = runtime.sequencer;
        const activeThread = sequencer.activeThread;
        const simulationContext = {
            ...context,
            definition,
            abort: null
        };
        runtime.ioDevices = FIXED_IO_DEVICES;
        // `pick random` inside a step is seeded by the step like simulation_seededRandom.
        runtime._primitives.operator_random = args => randomInRange(
            context.random('pick random'),
            Cast.toNumber(args.FROM),
            Cast.toNumber(args.TO)
        );
        try {
            for (const script of scripts) {
                const target = runtime.getTargetById(script.targetId);
                if (!target) continue;
                // Variables read inside the step are a copy of their values at initialize; writes stay in the step.
                for (const owner of [target, runtime.getTargetForStage()].filter(Boolean)) {
                    if (targets.has(owner)) continue;
                    targets.set(owner, owner.variables);
                    const captured = variableValues[owner.id];
                    const variables = cloneVariables(owner.variables);
                    for (const id of Object.keys(captured || {})) {
                        if (!variables[id]) continue;
                        const value = captured[id].value;
                        variables[id].value = Array.isArray(value) ? value.slice() : value;
                    }
                    owner.variables = variables;
                }
                if (!script.firstId) continue;
                const thread = new Thread(script.firstId);
                thread.target = target;
                thread.blockContainer = target.blocks;
                thread.simulationContext = simulationContext;
                thread.pushStack(script.firstId);
                thread.peekStackFrame().warpMode = true;
                sequencer.activeThread = thread;
                sequencer.stepThread(thread);
                if (simulationContext.abort) throw new Error(simulationContext.abort);
                if (thread.stack.length > 0 && thread.status !== Thread.STATUS_DONE) {
                    throw new Error(`Simulation ${definition.name} waited inside a step. Steps must run without ` +
                        'waiting (no wait blocks or long loops).');
                }
            }
        } finally {
            sequencer.activeThread = activeThread;
            runtime.ioDevices = ioDevices;
            runtime._primitives.operator_random = randomPrimitive;
            for (const [owner, variables] of targets) owner.variables = variables;
        }
    };

    return {
        initialize: (definition, state, context) => runScripts(definition, definition.initialize, state, context),
        step: (definition, state, context) => runScripts(definition, definition.step, state, context)
    };
};

// Seeded random numbers outside simulations: from the seed, the evaluation time and how many numbers that seed
// gave at that time before, so a render frame (or each motion blur sample) draws the same numbers every time.
const renderRandomCounts = new WeakMap();
const renderRandom = (runtime, util, seed) => {
    const time = getEvaluationTime(runtime, util);
    const manager = runtime.movieAssetManager;
    const frameKey = manager && manager.timeline ? manager.timeline.frameEvaluationId : 0;
    let counts = renderRandomCounts.get(runtime);
    if (!counts || counts.frameKey !== frameKey) {
        counts = {frameKey, calls: new Map()};
        renderRandomCounts.set(runtime, counts);
    }
    const key = `${seed}\u0000${time}`;
    const call = counts.calls.get(key) || 0;
    counts.calls.set(key, call + 1);
    return seededRandomValue('render', seed, hashParts(time), call);
};

// Blocks that plugins add to the Simulation category: {id, blocks, menus, methods}, like registerObjectBlocks.
const getSimulationBlockContributions = runtime => {
    if (!(runtime.simulationBlockContributions instanceof Map)) runtime.simulationBlockContributions = new Map();
    return runtime.simulationBlockContributions;
};

const findSimulationBlockContribution = (runtime, opcode) => {
    for (const contribution of getSimulationBlockContributions(runtime).values()) {
        if (contribution.blocks.some(block => block.opcode === opcode)) return contribution;
    }
    return null;
};

const createSimulationBlocksClass = vm => class SimulationBlocks {
    constructor () {
        this.runtime = vm.runtime;
    }

    getInfo () {
        const locale = resolveLocale(null, vm);
        const translate = (english, japanese, hiragana) => localize(locale, english, japanese, hiragana);
        const name = defaultValue => ({type: ArgumentType.STRING, defaultValue});
        const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        const key = defaultValue => ({type: ArgumentType.STRING, defaultValue});
        const contributed = getSimulationBlockContributions(this.runtime);
        const info = {
            id: EXTENSION_ID,
            name: translate('Simulation', 'シミュレーション', 'しみゅれーしょん'),
            color1: PRIMARY,
            color2: SECONDARY,
            color3: TERTIARY,
            blocks: [
                {
                    opcode: 'whenInitialized',
                    blockType: BlockType.EVENT,
                    isEdgeActivated: false,
                    text: translate(
                        'when simulation [NAME] initializes start [START] sec rate [RATE] Hz',
                        'シミュレーション [NAME] を初期化するとき 開始 [START] 秒 刻み [RATE] Hz',
                        'しみゅれーしょん [NAME] をしょきかするとき かいし [START] びょう きざみ [RATE] Hz'
                    ),
                    arguments: {NAME: name('simulation'), START: number(0), RATE: number(DEFAULT_RATE)}
                },
                {
                    opcode: 'whenStepped',
                    blockType: BlockType.EVENT,
                    isEdgeActivated: false,
                    text: translate(
                        'when simulation [NAME] steps',
                        'シミュレーション [NAME] を 1 ステップ進めるとき',
                        'しみゅれーしょん [NAME] を 1 すてっぷすすめるとき'
                    ),
                    arguments: {NAME: name('simulation')}
                },
                '---',
                {
                    opcode: 'setState',
                    blockType: BlockType.COMMAND,
                    text: translate('set state [KEY] to [VALUE]', '状態 [KEY] を [VALUE] にする',
                        'じょうたい [KEY] を [VALUE] にする'),
                    arguments: {KEY: key('x'), VALUE: number(0)}
                },
                {
                    opcode: 'changeState',
                    blockType: BlockType.COMMAND,
                    text: translate('change state [KEY] by [VALUE]', '状態 [KEY] を [VALUE] ずつ変える',
                        'じょうたい [KEY] を [VALUE] ずつかえる'),
                    arguments: {KEY: key('x'), VALUE: number(1)}
                },
                {
                    opcode: 'state',
                    blockType: BlockType.REPORTER,
                    text: translate('state [KEY]', '状態 [KEY]', 'じょうたい [KEY]'),
                    arguments: {KEY: key('x')}
                },
                '---',
                {
                    opcode: 'addToList',
                    blockType: BlockType.COMMAND,
                    text: translate('add [VALUE] to state list [KEY]', '[VALUE] を状態リスト [KEY] に追加する',
                        '[VALUE] をじょうたいりすと [KEY] についかする'),
                    arguments: {VALUE: number(0), KEY: key('particles')}
                },
                {
                    opcode: 'replaceListItem',
                    blockType: BlockType.COMMAND,
                    text: translate(
                        'replace item [INDEX] of state list [KEY] with [VALUE]',
                        '状態リスト [KEY] の [INDEX] 番目を [VALUE] で置き換える',
                        'じょうたいりすと [KEY] の [INDEX] ばんめを [VALUE] でおきかえる'
                    ),
                    arguments: {INDEX: number(1), KEY: key('particles'), VALUE: number(0)}
                },
                {
                    opcode: 'listItem',
                    blockType: BlockType.REPORTER,
                    text: translate('item [INDEX] of state list [KEY]', '状態リスト [KEY] の [INDEX] 番目',
                        'じょうたいりすと [KEY] の [INDEX] ばんめ'),
                    arguments: {INDEX: number(1), KEY: key('particles')}
                },
                {
                    opcode: 'listLength',
                    blockType: BlockType.REPORTER,
                    text: translate('length of state list [KEY]', '状態リスト [KEY] の長さ',
                        'じょうたいりすと [KEY] のながさ'),
                    arguments: {KEY: key('particles')}
                },
                {
                    opcode: 'clearList',
                    blockType: BlockType.COMMAND,
                    text: translate('delete all of state list [KEY]', '状態リスト [KEY] のすべてを削除する',
                        'じょうたいりすと [KEY] のすべてをさくじょする'),
                    arguments: {KEY: key('particles')}
                },
                '---',
                {
                    opcode: 'time',
                    blockType: BlockType.REPORTER,
                    text: translate('simulation time', 'シミュレーション時間', 'しみゅれーしょんじかん')
                },
                {
                    opcode: 'stepIndex',
                    blockType: BlockType.REPORTER,
                    text: translate('step number', 'ステップ番号', 'すてっぷばんごう')
                },
                {
                    opcode: 'dt',
                    blockType: BlockType.REPORTER,
                    text: 'dt'
                },
                {
                    opcode: 'seededRandom',
                    blockType: BlockType.REPORTER,
                    text: translate('seed [SEED] random [FROM] to [TO]', 'シード [SEED] の乱数 [FROM] から [TO]',
                        'しーど [SEED] のらんすう [FROM] から [TO]'),
                    arguments: {SEED: number(1), FROM: number(1), TO: number(10)}
                },
                '---',
                {
                    opcode: 'stateAt',
                    blockType: BlockType.REPORTER,
                    text: translate(
                        '[KEY] of simulation [NAME] at time [TIME]',
                        'シミュレーション [NAME] の [KEY] 時刻 [TIME]',
                        'しみゅれーしょん [NAME] の [KEY] じこく [TIME]'
                    ),
                    arguments: {
                        NAME: {type: ArgumentType.STRING, menu: 'simulationName', defaultValue: 'simulation'},
                        KEY: key('x'),
                        TIME: {type: ArgumentType.STRING, defaultValue: ''}
                    }
                },
                {
                    opcode: 'listItemAt',
                    blockType: BlockType.REPORTER,
                    text: translate(
                        'item [INDEX] of [KEY] of simulation [NAME] at time [TIME]',
                        'シミュレーション [NAME] の [KEY] の [INDEX] 番目 時刻 [TIME]',
                        'しみゅれーしょん [NAME] の [KEY] の [INDEX] ばんめ じこく [TIME]'
                    ),
                    arguments: {
                        NAME: {type: ArgumentType.STRING, menu: 'simulationName', defaultValue: 'simulation'},
                        KEY: key('particles'),
                        INDEX: number(1),
                        TIME: {type: ArgumentType.STRING, defaultValue: ''}
                    }
                }
            ],
            menus: {
                simulationName: {acceptReporters: true, items: 'getSimulationNames'}
            }
        };
        for (const contribution of contributed.values()) {
            for (const block of contribution.blocks) {
                const func = `contributed_${block.opcode}`;
                if (typeof this[func] !== 'function') {
                    this[func] = (args, util) => {
                        const owner = findSimulationBlockContribution(this.runtime, block.opcode);
                        if (!owner) return;
                        const ownBlock = owner.blocks.find(candidate => candidate.opcode === block.opcode);
                        // Commands must not hand a value (or Promise) back to the VM.
                        if (!ownBlock.blockType || ownBlock.blockType === BlockType.COMMAND ||
                            ownBlock.blockType === BlockType.CONDITIONAL) {
                            owner.methods[block.opcode](args, util);
                            return;
                        }
                        return owner.methods[block.opcode](args, util);
                    };
                }
                info.blocks.push(Object.assign({}, block, {func}));
            }
            for (const menuName of Object.keys(contribution.menus)) {
                if (Object.prototype.hasOwnProperty.call(info.menus, menuName)) continue;
                const menu = contribution.menus[menuName];
                if (menu && typeof menu.items === 'function') {
                    const func = `contributedMenu_${menuName}`;
                    this[func] = (...menuArgs) => menu.items(...menuArgs);
                    info.menus[menuName] = Object.assign({}, menu, {items: func});
                } else {
                    info.menus[menuName] = menu;
                }
            }
        }
        return info;
    }

    getSimulationNames () {
        const names = this.runtime.simulationRuntime ? this.runtime.simulationRuntime.names() : [];
        return names.length ? names : ['simulation'];
    }

    // Writes only happen inside a simulation step; a render-frame script can never change simulation state.
    writableState (util, opcode) {
        const context = getContext(util);
        if (context) return context.state;
        warnOnce(this.runtime, opcode,
            `"${opcode}" only changes simulation state inside a simulation script; it did nothing.`);
        return null;
    }

    setState (args, util) {
        const state = this.writableState(util, 'simulation_setState');
        if (state) state.set(Cast.toString(args.KEY), toStateValue(args.VALUE));
    }

    changeState (args, util) {
        const state = this.writableState(util, 'simulation_changeState');
        if (!state) return;
        const name = Cast.toString(args.KEY);
        state.set(name, Cast.toNumber(state.get(name)) + Cast.toNumber(args.VALUE));
    }

    state (args, util) {
        const context = getContext(util);
        if (!context) return 0;
        const value = context.state.get(Cast.toString(args.KEY));
        if (typeof value === 'undefined') return 0;
        return Array.isArray(value) ? value.join(' ') : value;
    }

    getList (state, key) {
        const value = state.get(key);
        return Array.isArray(value) ? value : [];
    }

    addToList (args, util) {
        const state = this.writableState(util, 'simulation_addToList');
        if (!state) return;
        const name = Cast.toString(args.KEY);
        state.set(name, this.getList(state, name).concat([toStateValue(args.VALUE)]));
    }

    replaceListItem (args, util) {
        const state = this.writableState(util, 'simulation_replaceListItem');
        if (!state) return;
        const name = Cast.toString(args.KEY);
        const list = this.getList(state, name).slice();
        const index = listIndex(args.INDEX, list.length);
        if (index < 0) return;
        list[index] = toStateValue(args.VALUE);
        state.set(name, list);
    }

    listItem (args, util) {
        const context = getContext(util);
        if (!context) return '';
        const list = this.getList(context.state, Cast.toString(args.KEY));
        const index = listIndex(args.INDEX, list.length);
        return index < 0 ? '' : list[index];
    }

    listLength (args, util) {
        const context = getContext(util);
        return context ? this.getList(context.state, Cast.toString(args.KEY)).length : 0;
    }

    clearList (args, util) {
        const state = this.writableState(util, 'simulation_clearList');
        if (state) state.set(Cast.toString(args.KEY), []);
    }

    time (args, util) {
        const context = getContext(util);
        return context ? context.time : 0;
    }

    stepIndex (args, util) {
        const context = getContext(util);
        return context ? context.stepIndex : 0;
    }

    dt (args, util) {
        const context = getContext(util);
        return context ? context.dt : 0;
    }

    seededRandom (args, util) {
        const context = getContext(util);
        const seed = Cast.toString(args.SEED);
        const sample = context ? context.random(seed) : renderRandom(this.runtime, util, seed);
        return randomInRange(sample, Cast.toNumber(args.FROM), Cast.toNumber(args.TO));
    }

    // S(t) at the evaluation time (or TIME when it is given). Not yet computed: the nearest computed value, and the
    // frame is evaluated again once that time is computed.
    readState (name, key, timeInput, util) {
        if (getContext(util)) return;
        const simulationRuntime = this.runtime.simulationRuntime;
        if (!simulationRuntime) return;
        const text = Cast.toString(timeInput).trim();
        const time = text === '' ? getEvaluationTime(this.runtime, util) : Cast.toNumber(text);
        return simulationRuntime.sample(Cast.toString(name), Cast.toString(key), time);
    }

    stateAt (args, util) {
        const value = this.readState(args.NAME, args.KEY, args.TIME, util);
        if (typeof value === 'undefined') return 0;
        return Array.isArray(value) ? value.join(' ') : value;
    }

    listItemAt (args, util) {
        const value = this.readState(args.NAME, args.KEY, args.TIME, util);
        const list = Array.isArray(value) ? value : [];
        const index = listIndex(args.INDEX, list.length);
        return index < 0 ? '' : list[index];
    }
};

const refreshSimulationBlocks = vm => {
    const extensionManager = vm.extensionManager;
    if (!extensionManager || !extensionManager.isExtensionLoaded(EXTENSION_ID)) return Promise.resolve();
    return Promise.resolve(extensionManager.refreshBlocks(EXTENSION_ID)).catch(() => {});
};

const registerSimulationBlocks = (vm, contribution) => {
    if (!contribution || !Array.isArray(contribution.blocks)) {
        throw new TypeError('Simulation blocks need a blocks list.');
    }
    const id = String(contribution.id || '');
    if (!id) throw new TypeError('Simulation blocks need an id.');
    const contributions = getSimulationBlockContributions(vm.runtime);
    if (contributions.has(id)) throw new Error(`Simulation blocks ${id} are already registered.`);
    const blocks = contribution.blocks.filter(block => block && typeof block === 'object');
    const methods = Object.assign({}, contribution.methods);
    for (const block of blocks) {
        if (!/^[a-z0-9_]+$/i.test(String(block.opcode || ''))) {
            throw new Error(`Invalid Simulation block opcode: ${block.opcode}`);
        }
        if (findSimulationBlockContribution(vm.runtime, block.opcode)) {
            throw new Error(`The Simulation block ${block.opcode} is already registered.`);
        }
        if (typeof methods[block.opcode] !== 'function') {
            throw new TypeError(`Simulation block ${block.opcode} needs a method.`);
        }
    }
    const entry = {id, blocks, menus: Object.assign({}, contribution.menus), methods};
    contributions.set(id, entry);
    refreshSimulationBlocks(vm);
    return () => {
        if (contributions.get(id) !== entry) return;
        contributions.delete(id);
        refreshSimulationBlocks(vm);
    };
};

/**
 * Install the Simulation category and the VM's simulation runtime (runtime.simulationRuntime).
 * @param {VirtualMachine} vm The VM.
 * @returns {VirtualMachine} The same VM.
 */
const installSimulationBlocks = vm => {
    const runtime = vm.runtime;
    if (!runtime.simulationRuntime) {
        runtime.simulationRuntime = new SimulationRuntime({
            executor: createSimulationExecutor(vm),
            onChange: ranges => runtime.emit('SIMULATION_CACHE_CHANGED', ranges)
        });
    }
    const extensionManager = vm.extensionManager;
    if (extensionManager.isExtensionLoaded(EXTENSION_ID)) return vm;
    extensionManager.addBuiltinExtension(EXTENSION_ID, createSimulationBlocksClass(vm));
    extensionManager.loadExtensionIdSync(EXTENSION_ID);
    return vm;
};

// Sync the simulation runtime with the project's simulation scripts and the given variable values.
const syncSimulations = (vm, variableValues = captureVariables(vm.runtime)) => {
    const simulationRuntime = vm.runtime.simulationRuntime;
    if (!simulationRuntime) return [];
    return simulationRuntime.syncDefinitions(collectSimulationDefinitions(vm.runtime, variableValues));
};

export {
    EXTENSION_ID,
    INITIALIZE_HAT,
    PRIMARY,
    SECONDARY,
    STEP_HAT,
    TERTIARY,
    captureVariables,
    collectSimulationDefinitions,
    createSimulationBlocksClass,
    createSimulationExecutor,
    getContext as getSimulationContext,
    isAllowedOpcode,
    registerSimulationBlocks,
    syncSimulations,
    installSimulationBlocks as default
};
