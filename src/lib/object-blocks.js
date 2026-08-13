import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';

const EXTENSION_ID = 'objects';
const PRIMARY = '#4968D4';
const SECONDARY = '#3E59B8';
const TERTIARY = '#334A99';

const trackPendingDraw = (pendingDraw, util, manager) => {
    if (!pendingDraw || typeof pendingDraw.then !== 'function') return;
    if (!Array.isArray(util.thread.objectPendingDraws)) util.thread.objectPendingDraws = [];
    util.thread.objectPendingDraws.push(pendingDraw);
    const removePending = () => {
        const index = util.thread.objectPendingDraws.indexOf(pendingDraw);
        if (index >= 0) util.thread.objectPendingDraws.splice(index, 1);
    };
    pendingDraw.then(removePending, removePending);
    manager.runWithoutWaiting(pendingDraw);
};

const createObjectBlocksClass = vm => class ObjectBlocks {
    constructor () {
        this.runtime = vm.runtime;
        this.runtime.objectBlocks = this;
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
                    text: 'draw [SOURCE] [ASSET]',
                    arguments: {
                        SOURCE: {type: ArgumentType.STRING, defaultValue: 'costume'},
                        ASSET: {type: ArgumentType.STRING, defaultValue: ''},
                        TEXT: {type: ArgumentType.STRING, defaultValue: 'Hello!'},
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
                        HEIGHT: numberArgument(100)
                    }
                },
                {
                    opcode: 'grouping',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 2,
                    text: ['grouping', 'effects']
                }
            ]
        };
    }

    draw (args, util) {
        const context = {
            asset: args.ASSET,
            height: args.HEIGHT,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            size: args.SIZE,
            source: String(args.SOURCE || 'costume').toLowerCase(),
            text: args.TEXT,
            width: args.WIDTH
        };
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawObject === 'function') {
            trackPendingDraw(manager.drawObject(util.target, context), util, manager);
        }
    }

    grouping (args, util) {
        const penFX = this.runtime.penFX;
        if (!util.stackFrame.objectGroupingPhase) {
            util.stackFrame.objectGroupingPhase = 1;
            const pendingDraws = util.thread.objectPendingDraws;
            util.stackFrame.objectGroupingPendingStart = Array.isArray(pendingDraws) ? pendingDraws.length : 0;
            if (penFX && typeof penFX.beginGroup === 'function') penFX.beginGroup();
            util.startBranch(1, true);
            return;
        }
        if (util.stackFrame.objectGroupingPhase === 1) {
            util.stackFrame.objectGroupingPhase = 2;
            const pendingDraws = util.thread.objectPendingDraws;
            util.stackFrame.objectGroupingPending = Array.isArray(pendingDraws) ? pendingDraws.slice(
                util.stackFrame.objectGroupingPendingStart
            ) : [];
            if (util.stackFrame.objectGroupingPending.length && penFX &&
                typeof penFX.beginEffectCapture === 'function') {
                penFX.beginEffectCapture();
            }
            util.startBranch(2, true);
            return;
        }
        const pendingDraws = util.stackFrame.objectGroupingPending || [];
        if (pendingDraws.length && penFX && typeof penFX.endEffectCapture === 'function') {
            const effects = penFX.endEffectCapture();
            const finishGroup = Promise.all(pendingDraws)
                .then(() => {
                    if (typeof penFX.applyCapturedEffects === 'function') penFX.applyCapturedEffects(effects);
                })
                .finally(() => penFX.endGroup());
            const manager = this.runtime.movieAssetManager;
            if (manager && typeof manager.runWithoutWaiting === 'function') manager.runWithoutWaiting(finishGroup);
            return;
        }
        if (penFX && typeof penFX.endGroup === 'function') penFX.endGroup();
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
    createObjectBlocksClass,
    installObjectBlocks as default
};
