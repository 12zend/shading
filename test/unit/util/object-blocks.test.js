import VM from 'scratch-vm';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import Sprite from 'scratch-vm/src/sprites/sprite';

import installObjectBlocks, {
    createObjectBlocksClass,
    decodeDrawAsset,
    encodeDrawAsset
} from '../../../src/lib/object-blocks';
import installObjectBlockDefinitions, {
    deleteAsset,
    drawSelectionUsesFrame,
    getDrawInputVisibility,
    getAssetItems,
    getFieldSourceBlock,
    modelHasFrames,
    normalizeVideoMode,
    openImportPicker
} from '../../../src/lib/object-blocks-ui';

const makeUtil = () => ({
    stackFrame: {},
    startBranch: jest.fn(),
    target: {id: 'sprite'},
    thread: {peekStack: jest.fn(() => 'draw-block')}
});

const makeGroupingHarness = onStep => {
    const blocks = {
        getBranch: jest.fn((blockId, branch) => {
            if (blockId !== 'grouping') return null;
            return branch === 1 ? 'objects-branch' : 'effects-branch';
        })
    };
    const target = {id: 'sprite', blocks};
    const parentThread = {
        blockContainer: blocks,
        peekStack: jest.fn(() => 'grouping'),
        target
    };
    const originalActiveThread = {id: 'original'};
    const sequencer = {
        activeThread: originalActiveThread,
        stepThread: jest.fn(thread => {
            if (onStep) onStep(thread);
        })
    };
    return {
        originalActiveThread,
        runtime: {sequencer},
        sequencer,
        util: {
            stackFrame: {},
            startBranch: jest.fn(),
            target,
            thread: parentThread
        }
    };
};

describe('Objects blocks', () => {
    test('persists and restores the dynamic text input for duplicated and shared font draw blocks', () => {
        const originalDocument = global.document;
        global.document = {
            createElement: name => {
                const attributes = new Map();
                return {
                    getAttribute: key => attributes.has(key) ? attributes.get(key) : null,
                    nodeName: name,
                    setAttribute: (key, value) => attributes.set(key, String(value))
                };
            }
        };
        const ScratchBlocks = {
            Blocks: {},
            Events: {isEnabled: () => false},
            FieldDropdown: class {},
            FieldLabel: class {},
            Xml: {domToText: element => element.outerHTML}
        };
        const vm = {runtime: {}};
        installObjectBlockDefinitions(ScratchBlocks, vm);
        const definition = ScratchBlocks.Blocks.objects_draw;
        const makeBlock = (initialSource, initialAsset) => {
            let source = initialSource;
            const visibility = {};
            const fields = {
                ASSET: {setValue: jest.fn()},
                SOURCE: {
                    setValue: jest.fn(value => {
                        source = value;
                    })
                }
            };
            return Object.assign({
                getField: name => fields[name],
                getFieldValue: name => {
                    if (name === 'ASSET') return encodeDrawAsset(source, initialAsset);
                    if (name === 'SOURCE') return source;
                    if (name === 'VIDEO_MODE') return 'sequence';
                    return '';
                },
                getInput: name => ({
                    connection: null,
                    setVisible: value => {
                        visibility[name] = value;
                        return [];
                    }
                }),
                objectDrawAsset_: initialAsset,
                objectDrawSource_: source,
                objectDrawVideoMode_: 'sequence',
                rendered: false,
                visibility
            }, definition);
        };
        try {
            const original = makeBlock('text', 'sans-serif');
            const mutation = original.mutationToDom();
            const restored = makeBlock('costume', 'costume1');

            restored.domToMutation(mutation);

            expect(mutation.getAttribute('source')).toBe('text');
            expect(mutation.getAttribute('asset')).toBe('sans-serif');
            expect(restored.objectDrawSource_).toBe('text');
            expect(restored.objectDrawAsset_).toBe('sans-serif');
            expect(restored.visibility.TEXT).toBe(true);
        } finally {
            global.document = originalDocument;
        }
    });

    test('supports the legacy ScratchBlocks field source API', () => {
        const sourceBlock = {};

        expect(getFieldSourceBlock({sourceBlock_: sourceBlock})).toBe(sourceBlock);
        expect(getFieldSourceBlock({getSourceBlock: () => sourceBlock})).toBe(sourceBlock);
    });

    test('marks project media as deletable while protecting built-in fonts and the last costume', () => {
        const costume = {name: 'only image'};
        const target = {
            getCostumes: () => [costume],
            id: 'sprite'
        };
        const vm = {
            editingTarget: target,
            runtime: {
                fontManager: {
                    getFonts: () => [{family: 'Project Font', name: 'Project Font'}]
                },
                movieAssetManager: {
                    getModels: () => [{name: 'model'}],
                    getVideos: () => [{name: 'video', url: 'blob:video'}]
                }
            }
        };

        const items = getAssetItems(vm);

        expect(items.find(item => item.source === 'costume')).toMatchObject({
            deletable: false,
            index: 0
        });
        expect(items.find(item => item.name === 'Sans Serif')).toMatchObject({deletable: false});
        expect(items.find(item => item.name === 'Project Font')).toMatchObject({
            deletable: true,
            index: 0
        });
        expect(items.find(item => item.source === 'video')).toMatchObject({deletable: true, index: 0});
        expect(items.find(item => item.source === 'model')).toMatchObject({deletable: true, index: 0});
    });

    test('deletes each supported project media type through its owning API', () => {
        const deleteCostume = jest.fn(() => () => {});
        const manager = {
            deleteFont: jest.fn(),
            deleteModel: jest.fn(),
            deleteVideo: jest.fn()
        };
        const vm = {
            deleteCostume,
            editingTarget: {
                getCostumes: () => [{name: 'one'}, {name: 'two'}],
                id: 'sprite'
            },
            runtime: {movieAssetManager: manager}
        };

        expect(deleteAsset(vm, {deletable: true, index: 1, source: 'costume'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 2, source: 'video'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 3, source: 'model'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 4, source: 'text'})).toBe(true);
        expect(deleteAsset(vm, {deletable: false, index: 0, source: 'text'})).toBe(false);

        expect(deleteCostume).toHaveBeenCalledWith(1);
        expect(manager.deleteVideo).toHaveBeenCalledWith('sprite', 2);
        expect(manager.deleteModel).toHaveBeenCalledWith('sprite', 3);
        expect(manager.deleteFont).toHaveBeenCalledWith(4);
    });

    test('selects an imported asset on the live block after the workspace refreshes', async () => {
        const listeners = {};
        const input = {
            addEventListener: jest.fn((name, listener) => {
                listeners[name] = listener;
            }),
            click: jest.fn(),
            files: [{name: 'new-image.png'}],
            parentNode: null,
            style: {}
        };
        const body = {
            appendChild: jest.fn(node => {
                node.parentNode = body;
            }),
            removeChild: jest.fn(node => {
                node.parentNode = null;
            })
        };
        const originalDocument = global.document;
        global.document = {
            body,
            createElement: jest.fn(() => input)
        };
        const liveBlock = {id: 'draw-block', setDrawAsset_: jest.fn()};
        const workspace = {getBlockById: jest.fn(() => null)};
        const mainWorkspace = {getBlockById: jest.fn(() => liveBlock)};
        const ScratchBlocks = {getMainWorkspace: jest.fn(() => mainWorkspace)};
        const staleBlock = {
            getFieldValue: jest.fn(name => (name === 'ASSET' ? 'costume:old' : 'costume')),
            id: 'draw-block',
            setDrawAsset_: jest.fn(),
            setWarningText: jest.fn(),
            workspace
        };
        const manager = {
            importFiles: jest.fn(() => Promise.resolve([{name: 'new-image', source: 'costume'}]))
        };
        const storedBlock = {
            fields: {
                ASSET: {value: 'costume:old'},
                SOURCE: {value: 'costume'}
            }
        };
        const blocks = {
            changeBlock: jest.fn(change => {
                storedBlock.fields[change.name].value = change.value;
            }),
            getBlock: jest.fn(() => storedBlock)
        };
        const vm = {
            editingTarget: {blocks, id: 'sprite'},
            refreshWorkspace: jest.fn(),
            runtime: {movieAssetManager: manager}
        };
        try {
            openImportPicker(vm, staleBlock, ScratchBlocks);
            listeners.change();
            await Promise.resolve();
            await Promise.resolve();

            expect(mainWorkspace.getBlockById).toHaveBeenCalledWith('draw-block');
            expect(liveBlock.setDrawAsset_).toHaveBeenCalledWith('costume', 'new-image');
            expect(staleBlock.setDrawAsset_).not.toHaveBeenCalled();
            expect(storedBlock.fields.ASSET.value).toBe('costume:new-image');
            expect(storedBlock.fields.SOURCE.value).toBe('costume');
            expect(vm.refreshWorkspace).not.toHaveBeenCalled();
        } finally {
            global.document = originalDocument;
        }
    });

    test('imports pasted files without opening the system file picker', async () => {
        const pastedFile = {name: 'pasted-image.png'};
        const liveBlock = {id: 'draw-block', setDrawAsset_: jest.fn()};
        const workspace = {getBlockById: jest.fn(() => null)};
        const ScratchBlocks = {
            getMainWorkspace: jest.fn(() => ({getBlockById: jest.fn(() => liveBlock)}))
        };
        const block = {
            getFieldValue: jest.fn(name => (name === 'ASSET' ? 'costume:old' : 'costume')),
            id: 'draw-block',
            workspace
        };
        const manager = {
            importFiles: jest.fn(() => Promise.resolve([{name: 'pasted-image', source: 'costume'}]))
        };
        const vm = {
            editingTarget: {id: 'sprite'},
            runtime: {movieAssetManager: manager}
        };

        openImportPicker(vm, block, ScratchBlocks, [pastedFile]);
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.importFiles).toHaveBeenCalledWith('sprite', [pastedFile], {modelName: ''});
        expect(liveBlock.setDrawAsset_).toHaveBeenCalledWith('costume', 'pasted-image');
    });

    test('encodes the combined draw asset selection while keeping legacy source fields readable', () => {
        expect(decodeDrawAsset(encodeDrawAsset('model', 'Hero:Idle'), 'costume')).toEqual({
            asset: 'Hero:Idle',
            source: 'model'
        });
        expect(decodeDrawAsset('legacy-costume', 'costume')).toEqual({
            asset: 'legacy-costume',
            source: 'costume'
        });
    });

    test('switches video controls between silent sequence frames and timed playback', () => {
        const target = {id: 'sprite'};
        const models = [
            {animationCount: 0, motions: [], name: 'Still'},
            {animationCount: 1, motions: [{frameCount: 48, name: 'Walk'}], name: 'Animated'}
        ];
        const vm = {
            editingTarget: target,
            runtime: {movieAssetManager: {getModels: jest.fn(() => models)}}
        };

        expect(drawSelectionUsesFrame(vm, 'video', 'clip')).toBe(true);
        expect(drawSelectionUsesFrame(vm, 'video', 'clip', 'video')).toBe(false);
        expect(drawSelectionUsesFrame(vm, 'model', 'Still')).toBe(false);
        expect(drawSelectionUsesFrame(vm, 'model', 'Animated')).toBe(true);
        expect(drawSelectionUsesFrame(vm, 'costume', 'image')).toBe(false);
        expect(getDrawInputVisibility(vm, 'video', 'clip', 'sequence')).toEqual({
            frame: true,
            speed: false,
            text: false,
            videoMode: true,
            volume: false
        });
        expect(getDrawInputVisibility(vm, 'video', 'clip', 'video')).toEqual({
            frame: false,
            speed: true,
            text: false,
            videoMode: true,
            volume: true
        });
        expect(normalizeVideoMode('anything else')).toBe('sequence');
        expect(modelHasFrames({animationCount: 1})).toBe(true);
    });

    test('exposes one draw command instead of separate transform commands', () => {
        const vm = {runtime: {}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const info = blocks.getInfo();

        expect(info.blocks.map(blockInfo => blockInfo.opcode)).toEqual(['draw', 'grouping']);
        expect(Object.keys(info.blocks[0].arguments)).toEqual([
            'SOURCE', 'ASSET', 'TEXT', 'VIDEO_MODE', 'FRAME', 'SPEED', 'VOLUME',
            'PX', 'PY', 'PZ',
            'RX', 'RY', 'RZ',
            'SX', 'SY', 'SZ',
            'SIZE', 'WIDTH', 'HEIGHT',
            'T1', 'T2'
        ]);
    });

    test('draws one complete object and never returns a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({
            SOURCE: 'text',
            ASSET: 'Movie Sans',
            TEXT: 'Title',
            VIDEO_MODE: 'sequence',
            FRAME: 12,
            SPEED: 1,
            VOLUME: 100,
            PX: 10,
            PY: 20,
            PZ: 30,
            RX: 1,
            RY: 2,
            RZ: 3,
            SX: 2,
            SY: 3,
            SZ: 4,
            SIZE: 75,
            WIDTH: 125,
            HEIGHT: 80,
            T1: 1.5,
            T2: 4.5
        }, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, {
            asset: 'Movie Sans',
            frame: 12,
            height: 80,
            playbackId: 'draw-block',
            position: {x: 10, y: 20, z: 30},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            size: 75,
            source: 'text',
            speed: 1,
            text: 'Title',
            time: {start: 1.5, end: 4.5},
            videoMode: 'sequence',
            volume: 100,
            width: 125
        });
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('starts asynchronous Objects video playback without returning a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({
            ASSET: 'video:clip',
            FRAME: 1,
            HEIGHT: 100,
            PX: 0,
            PY: 0,
            PZ: 480,
            RX: 0,
            RY: 0,
            RZ: 0,
            SIZE: 100,
            SOURCE: 'video',
            SPEED: 2,
            SX: 1,
            SY: 1,
            SZ: 1,
            T1: 3,
            T2: 8,
            TEXT: '',
            VIDEO_MODE: 'video',
            VOLUME: 60,
            WIDTH: 100
        }, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, expect.objectContaining({
            asset: 'clip',
            playbackId: 'draw-block',
            speed: 2,
            videoMode: 'video',
            volume: 60
        }));
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
    });

    test('runs both grouping branches atomically and scopes Pen FX without returning a promise', () => {
        const penFX = {beginGroup: jest.fn(), endGroup: jest.fn()};
        const harness = makeGroupingHarness();
        harness.runtime.penFX = penFX;
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(harness.sequencer.stepThread.mock.calls.map(call => call[0].topBlock)).toEqual([
            'objects-branch',
            'effects-branch'
        ]);
        expect(harness.sequencer.stepThread.mock.calls.every(call => call[0].peekStackFrame().warpMode)).toBe(true);
        expect(harness.sequencer.activeThread).toBe(harness.originalActiveThread);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('finishes grouping and the following block in one compiled VM step', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const groupBoundaries = [];
        runtime.penFX = {
            beginGroup: jest.fn(() => groupBoundaries.push(['begin', runtime.ext_scratch3_control.getCounter()])),
            endGroup: jest.fn(() => groupBoundaries.push(['end', runtime.ext_scratch3_control.getCounter()]))
        };

        target.blocks.createBlock({
            id: 'grouping',
            opcode: 'objects_grouping',
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'objects-branch', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: 'effects-branch', shadow: null}
            },
            fields: {},
            next: 'after-grouping',
            parent: null,
            shadow: false,
            topLevel: true
        });
        for (const [id, parent] of [
            ['objects-branch', 'grouping'],
            ['effects-branch', 'grouping'],
            ['after-grouping', 'grouping']
        ]) {
            target.blocks.createBlock({
                id,
                opcode: 'control_incr_counter',
                inputs: {},
                fields: {},
                next: null,
                parent,
                shadow: false,
                topLevel: false
            });
        }

        runtime.ext_scratch3_control.clearCounter();
        const thread = runtime._pushThread('grouping', target);
        expect(thread.isCompiled).toBe(true);
        runtime.sequencer.stepThread(thread);

        expect(runtime.ext_scratch3_control.getCounter()).toBe(3);
        expect(groupBoundaries).toEqual([['begin', 0], ['end', 2]]);
        expect(runtime.penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(runtime.penFX.endGroup).toHaveBeenCalledTimes(1);
    });

    test('finishes an asynchronous grouped draw before applying captured effects', async () => {
        let resolveDraw;
        const pendingDraw = new Promise(resolve => {
            resolveDraw = resolve;
        });
        const effects = [{}];
        const penFX = {
            applyCapturedEffects: jest.fn(),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(),
            endEffectCapture: jest.fn(() => effects),
            endGroup: jest.fn()
        };
        const manager = {runWithoutWaiting: jest.fn()};
        const harness = makeGroupingHarness(thread => {
            if (thread.topBlock === 'objects-branch') thread.objectPendingDraws = [pendingDraw];
        });
        Object.assign(harness.runtime, {movieAssetManager: manager, penFX});
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.beginEffectCapture).toHaveBeenCalledTimes(1);
        expect(penFX.applyCapturedEffects).not.toHaveBeenCalled();
        const finishGroup = manager.runWithoutWaiting.mock.calls[0][0];
        resolveDraw();
        await finishGroup;
        expect(penFX.applyCapturedEffects).toHaveBeenCalledWith(effects);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(expect.any(Promise));
    });
});
