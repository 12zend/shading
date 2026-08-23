import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';
import Thread from 'scratch-vm/src/engine/thread';

const EXTENSION_ID = 'objects';
const PRIMARY = '#4968D4';
const SECONDARY = '#3E59B8';
const TERTIARY = '#334A99';
const DRAW_SOURCES = ['costume', 'video', 'text', 'model'];
const SHAPE_TYPES = ['polygon', 'star', 'flower'];

const encodeDrawAsset = (source, asset) => `${source}:${asset}`;

const decodeDrawAsset = (value, fallbackSource = 'costume') => {
    const stringValue = String(value || '');
    const separator = stringValue.indexOf(':');
    const source = separator > 0 ? stringValue.slice(0, separator) : '';

    if (DRAW_SOURCES.includes(source)) {
        return {
            asset: stringValue.slice(separator + 1),
            source
        };
    }

    return {
        asset: stringValue,
        source: String(fallbackSource || 'costume').toLowerCase()
    };
};

const normalizeShapeType = value => {
    const shape = String(value || '').toLowerCase();
    return SHAPE_TYPES.includes(shape) ? shape : SHAPE_TYPES[0];
};

const trackPendingDraw = (pendingDraw, util, manager) => {
    if (!pendingDraw || typeof pendingDraw.then !== 'function') return;
    if (!Array.isArray(util.thread.objectPendingDraws)) util.thread.objectPendingDraws = [];
    util.thread.objectPendingDraws.push(pendingDraw);
    const removePending = () => {
        const index = util.thread.objectPendingDraws.indexOf(pendingDraw);
        if (index >= 0) util.thread.objectPendingDraws.splice(index, 1);
    };
    pendingDraw.then(removePending, removePending);
    if (manager && typeof manager.runWithoutWaiting === 'function') manager.runWithoutWaiting(pendingDraw);
};

const getGroupingContext = util => {
    const parentThread = util.thread;
    const target = parentThread && parentThread.target;
    const blocks = parentThread && (parentThread.blockContainer || (target && target.blocks));
    const parentBlockId = parentThread && typeof parentThread.peekStack === 'function' ?
        parentThread.peekStack() : null;
    return {
        blocks,
        objectSceneCapture: parentThread && parentThread.objectSceneCapture,
        parentBlockId,
        target
    };
};

const runGroupingBranch = (runtime, context, branchNumber) => {
    // startBranch(..., true) re-enters a conditional block through the VM's loop path, which yields
    // after every branch in both the interpreter and compiler. Execute the branch as a child warp
    // thread instead so grouping remains atomic without returning a Promise to the parent thread.
    const {blocks, parentBlockId, target} = context;
    const sequencer = runtime && runtime.sequencer;
    const branchId = blocks && typeof blocks.getBranch === 'function' ?
        blocks.getBranch(parentBlockId, branchNumber) : null;
    if (!branchId || !target || !sequencer || typeof sequencer.stepThread !== 'function') return null;

    const branchThread = new Thread(branchId);
    branchThread.target = target;
    branchThread.blockContainer = blocks;
    branchThread.pushStack(branchId);
    branchThread.peekStackFrame().warpMode = true;
    if (context.objectSceneCapture) branchThread.objectSceneCapture = context.objectSceneCapture;

    const activeThread = sequencer.activeThread;
    try {
        sequencer.activeThread = branchThread;
        sequencer.stepThread(branchThread);
    } finally {
        sequencer.activeThread = activeThread;
    }
    return branchThread;
};

const createObjectBlocksClass = vm => class ObjectBlocks {
    constructor () {
        this.runtime = vm.runtime;
        this.groupingGeneration = 0;
        this.pendingGrouping = null;
        this.runtime.objectBlocks = this;
        if (this.runtime && typeof this.runtime.on === 'function') {
            this.runtime.on('PROJECT_STOP_ALL', () => this.cancelPendingGroupings());
        }
    }

    cancelPendingGroupings () {
        this.groupingGeneration++;
        this.pendingGrouping = null;
        const penFX = this.runtime.penFX;
        if (penFX && typeof penFX.cancelGroups === 'function') penFX.cancelGroups();
    }

    getInfo () {
        const numberArgument = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        return {
            id: EXTENSION_ID,
            name: 'Objects',
            color1: PRIMARY,
            color2: SECONDARY,
            color3: TERTIARY,
            blocks: [
                {
                    opcode: 'draw',
                    blockType: BlockType.COMMAND,
                    text: 'draw [ASSET]',
                    arguments: {
                        SOURCE: {type: ArgumentType.STRING, defaultValue: 'costume'},
                        ASSET: {type: ArgumentType.STRING, defaultValue: ''},
                        TEXT: {type: ArgumentType.STRING, defaultValue: 'Hello!'},
                        VIDEO_MODE: {type: ArgumentType.STRING, defaultValue: 'sequence'},
                        FRAME: numberArgument(1),
                        SPEED: numberArgument(1),
                        VOLUME: numberArgument(100),
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        SIZE: numberArgument(100),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'shape',
                    blockType: BlockType.COMMAND,
                    text: 'shape [SHAPE] n: [N] position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'radius: [INNER] [OUTER] width: [WIDTH] height: [HEIGHT] time: [T1] ~ [T2]\n' +
                        'color: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        SHAPE: {type: ArgumentType.STRING, menu: 'shapeType', defaultValue: 'polygon'},
                        N: numberArgument(6),
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        INNER: numberArgument(50),
                        OUTER: numberArgument(100),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'arc',
                    blockType: BlockType.COMMAND,
                    text: 'arc position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'radius: [INNER] [OUTER] angle: [START] [END] width: [WIDTH] height: [HEIGHT] ' +
                        'time: [T1] ~ [T2]\ncolor: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        INNER: numberArgument(50),
                        OUTER: numberArgument(100),
                        START: numberArgument(0),
                        END: numberArgument(360),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'circularSegment',
                    blockType: BlockType.COMMAND,
                    text: 'circular segment position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'size: [OUTER] angle: [START] [END] width: [WIDTH] height: [HEIGHT] ' +
                        'time: [T1] ~ [T2]\ncolor: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        OUTER: numberArgument(100),
                        START: numberArgument(0),
                        END: numberArgument(360),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'line',
                    blockType: BlockType.COMMAND,
                    text: 'line position1 x: [P1X] y: [P1Y] z: [P1Z] ' +
                        'position2 x: [P2X] y: [P2Y] z: [P2Z] thickness: [THICKNESS] ' +
                        'time: [T1] ~ [T2]\ncolor: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        P1X: numberArgument(0),
                        P1Y: numberArgument(0),
                        P1Z: numberArgument(480),
                        P2X: numberArgument(100),
                        P2Y: numberArgument(100),
                        P2Z: numberArgument(480),
                        THICKNESS: numberArgument(5),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'grouping',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 2,
                    text: ['grouping', 'effects']
                },
                {
                    opcode: 'scene',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'scene'
                }
            ],
            menus: {
                shapeType: {
                    acceptReporters: true,
                    items: SHAPE_TYPES
                }
            }
        };
    }

    draw (args, util) {
        const selection = decodeDrawAsset(args.ASSET, args.SOURCE);
        const playbackId = util && util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : '';
        const context = {
            asset: selection.asset,
            frame: args.FRAME,
            height: args.HEIGHT,
            playbackId,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            size: args.SIZE,
            source: selection.source,
            speed: args.SPEED,
            text: args.TEXT,
            videoMode: args.VIDEO_MODE,
            volume: args.VOLUME,
            width: args.WIDTH
        };
        if (util && util.thread && util.thread.objectSceneCapture) {
            context.sceneCapture = util.thread.objectSceneCapture;
        }
        if (Object.prototype.hasOwnProperty.call(args, 'T1') ||
            Object.prototype.hasOwnProperty.call(args, 'T2')) {
            context.time = {start: args.T1, end: args.T2};
        }
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawObject === 'function') {
            trackPendingDraw(manager.drawObject(util.target, context), util, manager);
        }
    }

    shape (args, util) {
        const playbackId = util && util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : '';
        const context = {
            height: args.HEIGHT,
            n: args.N,
            playbackId,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            radius: {inner: args.INNER, outer: args.OUTER},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            shape: normalizeShapeType(args.SHAPE),
            width: args.WIDTH,
            color: args.COLOR,
            opacity: args.OPACITY
        };
        if (Object.prototype.hasOwnProperty.call(args, 'T1') ||
            Object.prototype.hasOwnProperty.call(args, 'T2')) {
            context.time = {start: args.T1, end: args.T2};
        }
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawShape === 'function') {
            trackPendingDraw(manager.drawShape(util.target, context), util, manager);
        }
    }

    drawProceduralShape (shape, args, util, configuration = {}) {
        const playbackId = util && util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : '';
        const context = Object.assign({
            playbackId,
            shape,
            color: args.COLOR,
            opacity: args.OPACITY
        }, configuration);
        if (Object.prototype.hasOwnProperty.call(args, 'T1') ||
            Object.prototype.hasOwnProperty.call(args, 'T2')) {
            context.time = {start: args.T1, end: args.T2};
        }
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawShape === 'function') {
            trackPendingDraw(manager.drawShape(util.target, context), util, manager);
        }
    }

    arc (args, util) {
        this.drawProceduralShape('arc', args, util, {
            height: args.HEIGHT,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            radius: {inner: args.INNER, outer: args.OUTER},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            angle: {start: args.START, end: args.END},
            width: args.WIDTH
        });
    }

    circularSegment (args, util) {
        this.drawProceduralShape('circular segment', args, util, {
            height: args.HEIGHT,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            size: args.OUTER,
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            angle: {start: args.START, end: args.END},
            width: args.WIDTH
        });
    }

    line (args, util) {
        this.drawProceduralShape('line', args, util, {
            position1: {x: args.P1X, y: args.P1Y, z: args.P1Z},
            position2: {x: args.P2X, y: args.P2Y, z: args.P2Z},
            thickness: args.THICKNESS
        });
    }

    grouping (args, util) {
        const context = getGroupingContext(util);
        const generation = this.groupingGeneration;
        const runGrouping = () => {
            if (generation !== this.groupingGeneration) return null;
            const penFX = this.runtime.penFX;
            if (penFX && typeof penFX.beginGroup === 'function') penFX.beginGroup();
            const objectThread = runGroupingBranch(this.runtime, context, 1);
            const pendingDraws = objectThread && Array.isArray(objectThread.objectPendingDraws) ?
                objectThread.objectPendingDraws.slice() : [];
            if (pendingDraws.length && penFX && typeof penFX.beginEffectCapture === 'function') {
                penFX.beginEffectCapture();
            }
            runGroupingBranch(this.runtime, context, 2);
            if (pendingDraws.length && penFX && typeof penFX.endEffectCapture === 'function') {
                const effects = penFX.endEffectCapture();
                return Promise.all(pendingDraws)
                    .then(() => {
                        if (generation !== this.groupingGeneration) return;
                        if (typeof penFX.applyCapturedEffects === 'function') penFX.applyCapturedEffects(effects);
                    })
                    .finally(() => {
                        if (generation === this.groupingGeneration && typeof penFX.endGroup === 'function') {
                            penFX.endGroup();
                        }
                    });
            }
            if (generation === this.groupingGeneration && penFX && typeof penFX.endGroup === 'function') {
                penFX.endGroup();
            }
            return null;
        };
        const pendingGrouping = this.pendingGrouping ?
            this.pendingGrouping.then(runGrouping, runGrouping) : runGrouping();
        if (!pendingGrouping || typeof pendingGrouping.then !== 'function') return;

        this.pendingGrouping = pendingGrouping;
        const clearPendingGrouping = () => {
            if (this.pendingGrouping === pendingGrouping) this.pendingGrouping = null;
        };
        pendingGrouping.then(clearPendingGrouping, clearPendingGrouping);
        // Propagate nested grouping completion to the branch that owns this grouping. Without this, an outer
        // grouping can apply its effects and close the Pen capture before an asynchronous inner video draw is stamped.
        trackPendingDraw(pendingGrouping, util, this.runtime.movieAssetManager);
    }

    scene (args, util) {
        const manager = this.runtime.movieAssetManager;
        if (!manager || typeof manager.createObjectSceneCapture !== 'function' ||
            typeof manager.renderObjectScene !== 'function') return;
        const context = getGroupingContext(util);
        const capture = manager.createObjectSceneCapture(context.target);
        if (!capture) return;
        context.objectSceneCapture = capture;
        runGroupingBranch(this.runtime, context, 1);
        trackPendingDraw(manager.renderObjectScene(context.target, capture), util, manager);
    }
};

const installObjectBlocks = vm => {
    const extensionManager = vm.extensionManager;
    if (extensionManager.isExtensionLoaded(EXTENSION_ID)) return vm;

    const ObjectBlocks = createObjectBlocksClass(vm);
    extensionManager.addBuiltinExtension(EXTENSION_ID, ObjectBlocks);
    extensionManager.loadExtensionIdSync(EXTENSION_ID);
    return vm;
};

export {
    EXTENSION_ID,
    PRIMARY,
    SECONDARY,
    TERTIARY,
    DRAW_SOURCES,
    SHAPE_TYPES,
    encodeDrawAsset,
    decodeDrawAsset,
    normalizeShapeType,
    createObjectBlocksClass,
    installObjectBlocks as default
};
