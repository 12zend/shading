/**
 * @jest-environment jsdom
 */
import {
    BLOCK_PINS_STORAGE_KEY,
    BlockPins,
    PINNED_CATEGORY_ID,
    addPinnedCategory,
    installBlockPinMenu
} from '../../../src/lib/block-pins';

const makeStorage = initial => {
    const values = new Map(initial ? [[BLOCK_PINS_STORAGE_KEY, initial]] : []);
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: jest.fn((key, value) => values.set(key, value)),
        values
    };
};

describe('block pins', () => {
    test('keeps pinned block XML in order and saves every change', () => {
        const storage = makeStorage(JSON.stringify({blocks: ['<block type="a"></block>', 3]}));
        const onChange = jest.fn();
        const pins = new BlockPins({storage, onChange});
        expect(pins.blocks).toEqual(['<block type="a"></block>']);

        pins.pin('<block type="b"></block>');
        pins.pin('<block type="b"></block>');
        expect(pins.blocks).toEqual(['<block type="a"></block>', '<block type="b"></block>']);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.values.get(BLOCK_PINS_STORAGE_KEY)).blocks).toEqual(pins.blocks);

        pins.unpin('<block type="a"></block>');
        expect(pins.blocks).toEqual(['<block type="b"></block>']);
        pins.clear();
        expect(pins.blocks).toEqual([]);
        expect(JSON.parse(storage.values.get(BLOCK_PINS_STORAGE_KEY))).toEqual({blocks: []});
        expect(onChange).toHaveBeenCalledTimes(3);
    });

    test('ignores storage that is unreadable or cannot be written', () => {
        const storage = makeStorage('{broken');
        storage.setItem.mockImplementation(() => {
            throw new Error('full');
        });
        const pins = new BlockPins({storage, onChange: jest.fn()});
        expect(pins.blocks).toEqual([]);
        pins.pin('<block type="a"></block>');
        expect(pins.blocks).toEqual(['<block type="a"></block>']);
        expect(new BlockPins({storage: null, onChange: jest.fn()}).blocks).toEqual([]);
    });

    test('adds a pinned category above every other category only when blocks are pinned', () => {
        const toolbox = '<xml style="display: none"><category name="Camera" id="motion"></category></xml>';
        expect(addPinnedCategory(toolbox, [], 'ja')).toBe(toolbox);

        const root = new DOMParser().parseFromString(
            addPinnedCategory(toolbox, ['<block type="a"></block>', '<block type="b"></block>'], 'ja'),
            'text/xml'
        ).documentElement;
        const [pinned, camera] = Array.from(root.getElementsByTagName('category'));
        expect(pinned.getAttribute('id')).toBe(PINNED_CATEGORY_ID);
        expect(pinned.getAttribute('name')).toBe('ピン留め');
        expect(pinned.getAttribute('iconURI')).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(Array.from(pinned.children).map(block => block.getAttribute('type'))).toEqual(['a', 'b']);
        expect(camera.getAttribute('id')).toBe('motion');
    });

    test('offers pin, remove pin and remove all pins for palette blocks only', () => {
        const shown = [];
        const ScratchBlocks = {
            BlockSvg: class {
                showContextMenu_ () {
                    ScratchBlocks.ContextMenu.show({}, this.isInFlyout ? [] : [{text: 'Duplicate'}], false);
                }
            },
            ContextMenu: {show: (event, options) => shown.push(options)},
            Xml: {
                blockToDom: (block, noId) => ({block, noId}),
                domToText: ({block, noId}) => `<block xmlns="http://www.w3.org/1999/xhtml" type="${block.type}"` +
                    `${noId ? '' : ' id="x"'}></block>`
            }
        };
        const originalShow = ScratchBlocks.ContextMenu.show;
        const pins = new BlockPins({storage: null, onChange: jest.fn()});
        const makeBlock = (type, options = {}) => Object.assign(new ScratchBlocks.BlockSvg(), {
            getParent: () => null,
            getRootBlock () {
                return this;
            },
            isInFlyout: true,
            isShadow: () => false,
            type
        }, options);
        const detach = installBlockPinMenu(ScratchBlocks, {
            getLocale: () => 'ja',
            getPinnedBlock: block => (block.type === 'pinned' ? '<block type="a"></block>' : null),
            pins
        });
        const labels = () => shown[shown.length - 1].map(option => `${option.text}:${option.enabled}`);

        const block = makeBlock('a');
        block.showContextMenu_({});
        expect(labels()).toEqual(['ピン留め:true', 'ピン留めを削除:false', '全てのピン留めを削除:false']);
        shown[shown.length - 1][0].callback();
        expect(pins.blocks).toEqual(['<block type="a"></block>']);
        expect(ScratchBlocks.ContextMenu.show).toBe(originalShow);

        // A shadow shows its parent's menu, and an entry in the pinned category removes its own pin.
        makeBlock('shadow', {getParent: () => makeBlock('pinned'), isShadow: () => true}).showContextMenu_({});
        expect(labels()).toEqual(['ピン留め:false', 'ピン留めを削除:true', '全てのピン留めを削除:true']);
        shown[shown.length - 1][1].callback();
        expect(pins.blocks).toEqual([]);

        makeBlock('b', {isInFlyout: false}).showContextMenu_({});
        expect(shown[shown.length - 1]).toEqual([{text: 'Duplicate'}]);

        pins.pin('<block type="b"></block>');
        makeBlock('c').showContextMenu_({});
        shown[shown.length - 1][2].callback();
        expect(pins.blocks).toEqual([]);

        detach();
        makeBlock('a').showContextMenu_({});
        expect(shown[shown.length - 1]).toEqual([]);
    });
});
