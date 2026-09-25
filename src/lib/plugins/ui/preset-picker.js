import styles from './preset-picker.css';
import {localize} from '../../movie-block-l10n';
import {createSampleSnapshot, isBlankSnapshot} from './snapshots';

// A searchable grid of thumbnails for a Blockly menu field. Plugins describe their presets and how a thumbnail is
// drawn; while the picker is open, the owning block's input is captured during the render transaction so every
// thumbnail previews the look on the user's own frame.
//
// A picker source is {label, categories: [{id, name}], presets: [{id, name, category, keywords?}],
// thumbnailsPerFrame, frameBudgetMs?, ready?(), getRenderer(), drawThumbnail(renderer, entry, canvas)}.
// renderer.setSnapshot({width, height, pixels}) receives the input before thumbnails are drawn.

const PREVIEW_FALLBACK_MS = 450;

const getPenFX = vm => (vm && vm.runtime && vm.runtime.penFX) || null;

const getFieldSourceBlock = field => {
    if (field && typeof field.getSourceBlock === 'function') return field.getSourceBlock();
    return field && field.sourceBlock_;
};

// The block that owns the menu shadow is the one whose input is captured while the picker is open.
const getOwnerBlockId = sourceBlock => {
    if (!sourceBlock || !sourceBlock.workspace || sourceBlock.workspace.isFlyout) return null;
    const parent = typeof sourceBlock.getParent === 'function' ? sourceBlock.getParent() : null;
    const owner = sourceBlock.isShadow && sourceBlock.isShadow() && parent ? parent : sourceBlock;
    return (owner && owner.id) || null;
};

const createPresetPickerField = (ScratchBlocks, vm, locale, pickerSource) => {
    const BaseField = ScratchBlocks.FieldDropdown;
    let cachedSource = null;
    const getSource = () => {
        if (!cachedSource) cachedSource = pickerSource();
        return cachedSource;
    };
    const options = () => getSource().presets.map(entry => [entry.name, entry.id]);
    const PresetField = function (value) {
        BaseField.call(this, options);
        this.pickerCleanup_ = null;
        if (typeof value !== 'undefined') this.setValue(value);
    };
    PresetField.prototype = Object.create(BaseField.prototype);
    PresetField.prototype.constructor = PresetField;

    PresetField.prototype.onHide = function () {
        if (this.pickerCleanup_) {
            const cleanup = this.pickerCleanup_;
            this.pickerCleanup_ = null;
            cleanup();
        }
        BaseField.prototype.onHide.call(this);
    };

    PresetField.prototype.showEditor_ = function () {
        if (typeof document === 'undefined' || !document.body) return;
        const field = this;
        const source = getSource();
        const sourceBlock = getFieldSourceBlock(this);
        const dropdown = ScratchBlocks.DropDownDiv;
        dropdown.hideWithoutAnimation();
        dropdown.clearContent();
        this.dropDownOpen_ = true;

        const picker = document.createElement('section');
        picker.className = styles.presetPicker;
        picker.setAttribute('aria-label', source.label);

        const search = document.createElement('input');
        search.type = 'search';
        search.className = styles.presetSearch;
        search.placeholder = localize(locale, 'Search looks', 'ルックを検索');
        search.setAttribute('aria-label', search.placeholder);
        picker.appendChild(search);

        const status = document.createElement('p');
        status.className = styles.presetStatus;
        picker.appendChild(status);

        const list = document.createElement('div');
        list.className = styles.presetList;
        picker.appendChild(list);

        const cards = [];
        const sections = [];
        for (const category of source.categories) {
            const section = document.createElement('div');
            section.className = styles.presetSection;
            const heading = document.createElement('h3');
            heading.className = styles.presetHeading;
            heading.textContent = category.name;
            section.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = styles.presetGrid;
            section.appendChild(grid);
            const sectionCards = [];
            for (const preset of source.presets) {
                if (preset.category !== category.id) continue;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = styles.presetCard;
                card.title = preset.name;
                card.setAttribute('aria-pressed', String(preset.id === field.getValue()));
                const canvas = document.createElement('canvas');
                canvas.className = styles.presetThumbnail;
                canvas.width = 16;
                canvas.height = 9;
                const name = document.createElement('span');
                name.className = styles.presetName;
                name.textContent = preset.name;
                card.appendChild(canvas);
                card.appendChild(name);
                // Keep the picker open so looks can be compared on the stage; an outside click closes it.
                card.addEventListener('click', () => {
                    if (sourceBlock) ScratchBlocks.Events.setGroup(true);
                    field.setValue(field.callValidator ? field.callValidator(preset.id) : preset.id);
                    if (sourceBlock) ScratchBlocks.Events.setGroup(false);
                    for (const entry of cards) {
                        entry.card.setAttribute('aria-pressed', String(entry.preset.id === field.getValue()));
                    }
                });
                grid.appendChild(card);
                const entry = {
                    canvas,
                    card,
                    preset,
                    search: `${preset.name} ${preset.keywords || ''} ${category.name}`.toLowerCase()
                };
                cards.push(entry);
                sectionCards.push(entry);
            }
            list.appendChild(section);
            sections.push({section, cards: sectionCards});
        }

        search.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            for (const {section, cards: sectionCards} of sections) {
                let visible = 0;
                for (const entry of sectionCards) {
                    const match = !query || entry.search.indexOf(query) !== -1;
                    entry.card.hidden = !match;
                    if (match) visible++;
                }
                section.hidden = visible === 0;
            }
        });
        picker.addEventListener('keydown', event => {
            if (event.key === 'Escape') dropdown.hide();
        });

        // Thumbnails are drawn a few per animation frame so opening the picker stays responsive, and a newer
        // capture simply restarts the queue.
        let renderer = null;
        let frame = null;
        let generation = 0;
        let receivedCapture = false;
        const ready = Promise.resolve(source.ready ? source.ready() : null).catch(() => null);
        const renderSnapshot = (capture, message) => {
            const blank = isBlankSnapshot(capture);
            const snapshot = blank ? createSampleSnapshot() : capture;
            if (!snapshot) return;
            status.textContent = blank ?
                localize(locale, 'Preview: sample image (the input is empty)', 'プレビュー: サンプル画像（入力が空です）') :
                message;
            const current = ++generation;
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            ready.then(() => {
                if (current !== generation) return;
                try {
                    renderer = renderer || source.getRenderer();
                    renderer.setSnapshot(snapshot);
                } catch (error) {
                    status.textContent = localize(locale, 'Preview unavailable', 'プレビューを表示できません');
                    return;
                }
                let index = 0;
                const step = () => {
                    frame = null;
                    if (current !== generation) return;
                    renderer.setSnapshot(snapshot);
                    const start = Date.now();
                    const end = Math.min(cards.length, index + source.thumbnailsPerFrame);
                    while (index < end) {
                        source.drawThumbnail(renderer, cards[index].preset, cards[index].canvas);
                        index++;
                        if (source.frameBudgetMs && Date.now() - start >= source.frameBudgetMs) break;
                    }
                    if (index < cards.length) frame = requestAnimationFrame(step);
                };
                step();
            });
        };

        const blockId = getOwnerBlockId(sourceBlock);
        const penFX = getPenFX(vm);
        const unsubscribe = blockId && penFX && typeof penFX.requestInputPreview === 'function' ?
            penFX.requestInputPreview(blockId, snapshot => {
                receivedCapture = true;
                renderSnapshot(snapshot, localize(locale, 'Preview: input of this block',
                    'プレビュー: このブロックへの入力'));
            }) : null;
        const manager = vm && vm.runtime && vm.runtime.movieAssetManager;
        if (unsubscribe && manager && typeof manager.requestTimelinePreviewRefresh === 'function') {
            manager.requestTimelinePreviewRefresh();
        }
        // If the block is not part of the rendered frame, preview against the current pen layer instead.
        const fallback = setTimeout(() => {
            if (receivedCapture) return;
            const snapshot = penFX && typeof penFX.captureCurrentPenLayer === 'function' ?
                penFX.captureCurrentPenLayer() : null;
            renderSnapshot(snapshot, localize(locale, 'Preview: current frame', 'プレビュー: 現在のフレーム'));
        }, blockId ? PREVIEW_FALLBACK_MS : 0);

        // The drop-down can open below the block, so cap the picker to the space left in the window; the list
        // scrolls inside it and the last presets stay reachable.
        // Blockly caps the drop-down content at a fixed height with its own scrollbar, which would clip the list.
        const content = dropdown.getContentDiv();
        const previousContentMaxHeight = content.style.maxHeight;
        content.style.maxHeight = 'none';
        const fitToViewport = () => {
            const top = picker.getBoundingClientRect().top;
            picker.style.maxHeight = `${Math.max(180, window.innerHeight - Math.max(0, top) - 16)}px`;
        };
        // The drop-down slides into place, so measure again once it has settled.
        const settle = setTimeout(fitToViewport, 300);
        const closeOnOutsidePointer = event => {
            if (!picker.contains(event.target)) dropdown.hide();
        };
        this.pickerCleanup_ = () => {
            document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
            window.removeEventListener('resize', fitToViewport);
            clearTimeout(settle);
            content.style.maxHeight = previousContentMaxHeight;
            clearTimeout(fallback);
            generation++;
            if (frame !== null) cancelAnimationFrame(frame);
            if (unsubscribe) unsubscribe();
        };

        content.appendChild(picker);
        dropdown.setColour('var(--ui-modal-background)', 'var(--ui-black-transparent)');
        if (sourceBlock) {
            const owner = sourceBlock.isShadow && sourceBlock.isShadow() && sourceBlock.getParent() ?
                sourceBlock.getParent() : sourceBlock;
            if (owner.getCategory) dropdown.setCategory(owner.getCategory());
        }
        const boundsElement = sourceBlock && sourceBlock.workspace && sourceBlock.workspace.getParentSvg ?
            sourceBlock.workspace.getParentSvg().parentNode : document.body;
        dropdown.setBoundsElement(boundsElement);
        dropdown.showPositionedByBlock(this, sourceBlock, this.onHide.bind(this));
        if (sourceBlock && sourceBlock.isShadow && sourceBlock.isShadow() && !this.disableColourChange_) {
            sourceBlock.setShadowColour(sourceBlock.getColourQuaternary());
        }
        document.addEventListener('pointerdown', closeOnOutsidePointer, true);
        fitToViewport();
        window.addEventListener('resize', fitToViewport);
        const selected = cards.find(entry => entry.preset.id === field.getValue());
        if (selected && selected.card.scrollIntoView) selected.card.scrollIntoView({block: 'center'});
        search.focus();
    };
    return PresetField;
};

/**
 * Define the menu block `${extensionId}_menu_${menu}` with a thumbnail picker field.
 * @param {object} ScratchBlocks scratch-blocks.
 * @param {object} vm VM.
 * @param {string} locale Locale.
 * @param {object} options {extensionId, menu, source: () => pickerSource, colours?: [primary, secondary, tertiary]}.
 */
const definePresetMenuBlock = (ScratchBlocks, vm, locale, options) => {
    if (!ScratchBlocks || !ScratchBlocks.Blocks || !ScratchBlocks.FieldDropdown) return;
    const PresetField = createPresetPickerField(ScratchBlocks, vm, locale, options.source);
    const colours = options.colours || ['#6b56d9', '#5945c2', '#46359f'];
    const menu = options.menu;
    ScratchBlocks.Blocks[`${options.extensionId}_menu_${menu}`] = {
        init: function () {
            this.appendDummyInput().appendField(new PresetField(), menu);
            this.setInputsInline(true);
            this.setOutput(true, 'String');
            this.setColour(colours[0], colours[1], colours[2]);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_ROUND);
        }
    };
};

export {createPresetPickerField, definePresetMenuBlock, getOwnerBlockId};
