import {localize} from './movie-block-l10n';

// Pinned blocks are kept per browser, like the palette layout, and shown in a category above all others.
const BLOCK_PINS_STORAGE_KEY = 'shading:pinned-blocks';
const PINNED_CATEGORY_ID = 'pinned';
const PIN_ICON = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
    '<circle cx="20" cy="20" r="19" fill="#FFBF00" stroke="#CC9900" stroke-width="2"/>' +
    '<path d="M16 9h8l-1 8 4 4v2h-6v8l-1 2-1-2v-8h-6v-2l4-4z" fill="#fff"/></svg>'
)}`;

const readPins = storage => {
    try {
        const data = JSON.parse(storage.getItem(BLOCK_PINS_STORAGE_KEY));
        return Array.isArray(data && data.blocks) ? data.blocks.filter(xml => typeof xml === 'string') : [];
    } catch (error) {
        return [];
    }
};

/**
 * The pinned blocks: XML of palette blocks, in the order they were pinned.
 */
class BlockPins {
    /**
     * @param {object} options Options.
     * @param {?Storage} options.storage Where the pins are kept.
     * @param {function()} options.onChange Called after the pins change.
     */
    constructor ({storage, onChange}) {
        this.storage = storage;
        this.onChange = onChange;
        this.blocks = storage ? readPins(storage) : [];
    }

    has (xml) {
        return this.blocks.includes(xml);
    }

    pin (xml) {
        if (this.has(xml)) return;
        this.update(this.blocks.concat([xml]));
    }

    unpin (xml) {
        this.update(this.blocks.filter(pinned => pinned !== xml));
    }

    clear () {
        this.update([]);
    }

    update (blocks) {
        this.blocks = blocks;
        if (this.storage) {
            try {
                this.storage.setItem(BLOCK_PINS_STORAGE_KEY, JSON.stringify({blocks}));
            } catch (error) {
                // Storage may be full or disabled; the pins still apply until the editor is reloaded.
            }
        }
        this.onChange();
    }
}

/**
 * Serialize a palette block the way it is pinned: its XML without block IDs.
 * @param {object} ScratchBlocks ScratchBlocks.
 * @param {object} block A block in the palette.
 * @returns {string} The block XML.
 */
const serializePinnedBlock = (ScratchBlocks, block) => (
    ScratchBlocks.Xml.domToText(ScratchBlocks.Xml.blockToDom(block, true)).replace(/ xmlns="[^"]*"/g, '')
);

/**
 * Put the pinned blocks in a category at the top of the toolbox.
 * @param {string} toolboxXML Toolbox XML.
 * @param {string[]} blocks XML of the pinned blocks.
 * @param {string} locale UI locale.
 * @returns {string} The toolbox XML.
 */
const addPinnedCategory = (toolboxXML, blocks, locale) => {
    if (typeof toolboxXML !== 'string' || !blocks.length) return toolboxXML;
    const start = toolboxXML.indexOf('>', toolboxXML.indexOf('<xml')) + 1;
    if (start <= 0) return toolboxXML;
    const name = localize(locale, 'Pinned', 'ピン留め');
    const category = `<category name="${name}" id="${PINNED_CATEGORY_ID}" colour="#FFBF00" ` +
        `secondaryColour="#CC9900" iconURI="${PIN_ICON}">${blocks.join('')}</category><sep gap="36"/>`;
    return toolboxXML.slice(0, start) + category + toolboxXML.slice(start);
};

let activeMenu = null;

/**
 * Add pin commands to the context menu of palette blocks.
 * @param {object} ScratchBlocks ScratchBlocks.
 * @param {object} menu The palette whose menu is shown.
 * @param {BlockPins} menu.pins The pins.
 * @param {function(object): ?string} menu.getPinnedBlock The pinned XML that a palette entry shows, if any.
 * @param {function(): string} menu.getLocale UI locale.
 * @returns {function()} Detach this palette from the menu.
 */
const installBlockPinMenu = (ScratchBlocks, menu) => {
    activeMenu = menu;
    const prototype = ScratchBlocks.BlockSvg.prototype;
    if (!prototype.shadingPinMenuInstalled) {
        prototype.shadingPinMenuInstalled = true;
        const showContextMenu = prototype.showContextMenu_;
        prototype.showContextMenu_ = function (event) {
            if (!this.isInFlyout || !activeMenu) return showContextMenu.call(this, event);
            // A shadow's menu is its parent block's.
            if (this.isShadow() && this.getParent()) return this.getParent().showContextMenu_(event);
            const {pins, getLocale} = activeMenu;
            const locale = getLocale();
            // A palette entry is pinned as a whole, including blocks placed in its inputs.
            const entry = this.getRootBlock();
            const xml = activeMenu.getPinnedBlock(entry) || serializePinnedBlock(ScratchBlocks, entry);
            const options = [
                {
                    text: localize(locale, 'Pin', 'ピン留め'),
                    enabled: !pins.has(xml),
                    callback: () => pins.pin(xml)
                },
                {
                    text: localize(locale, 'Remove pin', 'ピン留めを削除'),
                    enabled: pins.has(xml),
                    callback: () => pins.unpin(xml)
                },
                {
                    text: localize(locale, 'Remove all pins', '全てのピン留めを削除'),
                    enabled: pins.blocks.length > 0,
                    callback: () => pins.clear()
                }
            ];
            const show = ScratchBlocks.ContextMenu.show;
            ScratchBlocks.ContextMenu.show = function (menuEvent, menuOptions, rtl) {
                ScratchBlocks.ContextMenu.show = show;
                return show.call(this, menuEvent, menuOptions.concat(options), rtl);
            };
            try {
                return showContextMenu.call(this, event);
            } finally {
                ScratchBlocks.ContextMenu.show = show;
            }
        };
    }
    return () => {
        if (activeMenu === menu) activeMenu = null;
    };
};

export {
    BLOCK_PINS_STORAGE_KEY,
    BlockPins,
    PINNED_CATEGORY_ID,
    addPinnedCategory,
    installBlockPinMenu,
    serializePinnedBlock
};
