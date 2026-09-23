/* eslint-disable */

import styles from './pen-fx-ui.css';
import {localize} from './movie-block-l10n';
import {CATEGORIES as COLOR_GRADING_CATEGORIES, PRESETS as COLOR_GRADING_PRESETS} from
    'scratch-render/src/pen-fx/color-grading/presets';
import {createSampleSnapshot, getColorGradingPreviewRenderer, isBlankSnapshot} from './color-grading-preview';
import {getEasyEffectPreviewRenderer} from './easy-effect-preview';
import {easyBlocks, presetName} from 'scratch-vm/src/lib/pen-fx/easy';

const MAX_STOPS = 8;
const DEFAULT_GRADIENT = {
    stops: [
        {color: '#000000', position: 0},
        {color: '#ffffff', position: 1}
    ]
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeColor = value => {
    const color = String(value || '').trim()
        .toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) {
        return `#${color.slice(1).split('')
            .map(channel => `${channel}${channel}`)
            .join('')}`;
    }
    return '#000000';
};

const normalizeGradient = value => {
    let descriptor = value;
    if (typeof descriptor === 'string') {
        try {
            descriptor = JSON.parse(descriptor);
        } catch (error) {
            descriptor = null;
        }
    }
    const sourceStops = descriptor && Array.isArray(descriptor.stops) ? descriptor.stops : DEFAULT_GRADIENT.stops;
    const stops = sourceStops.map(stop => ({
        color: normalizeColor(stop && stop.color),
        position: clamp(Number(stop && stop.position) || 0, 0, 1)
    })).slice(0, MAX_STOPS);
    if (stops.length < 2) {
        stops.push({
            color: stops.length ? stops[0].color : '#ffffff',
            position: 1
        });
    }
    stops.sort((a, b) => a.position - b.position);
    return {stops};
};

const serializeGradient = value => JSON.stringify(normalizeGradient(value));

const gradientToCss = value => normalizeGradient(value).stops
    .map(stop => `${stop.color} ${Math.round(stop.position * 100)}%`)
    .join(', ');

const createSvgIcon = (path, className) => {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-width', '2');
    const shape = document.createElementNS(namespace, 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
};

const getGradientFieldSourceBlock = field => {
    if (field && typeof field.getSourceBlock === 'function') return field.getSourceBlock();
    return field && field.sourceBlock_;
};

const createGradientField = ScratchBlocks => {
    const BaseField = ScratchBlocks.FieldTextInput;
    const GradientField = function (value = serializeGradient(DEFAULT_GRADIENT)) {
        BaseField.call(this, serializeGradient(value));
        this.outsideCloseListener_ = null;
        this.gradientValue_ = serializeGradient(value);
    };
    GradientField.prototype = Object.create(BaseField.prototype);
    GradientField.prototype.constructor = GradientField;

    GradientField.prototype.init = function () {
        BaseField.prototype.init.call(this);
        this.refreshDisplay_();
    };

    GradientField.prototype.getValue = function () {
        return this.gradientValue_ || BaseField.prototype.getValue.call(this);
    };

    GradientField.prototype.setValue = function (value) {
        const serializedValue = serializeGradient(value);
        // Let Blockly compare the serialized value with the previous value before
        // updating our backing value. Otherwise getValue() returns the new value
        // during BaseField#setValue and no BlockChange event reaches the VM.
        BaseField.prototype.setValue.call(this, serializedValue);
        this.gradientValue_ = serializedValue;
        this.refreshDisplay_();
    };

    GradientField.prototype.refreshDisplay_ = function () {
        this.setText('gradient');
        if (this.box_) {
            const stops = normalizeGradient(this.getValue()).stops;
            this.box_.setAttribute('fill', stops[0].color);
        }
    };

    GradientField.prototype.onHide = function () {
        if (this.outsideCloseListener_ && typeof document !== 'undefined') {
            document.removeEventListener('pointerdown', this.outsideCloseListener_, true);
            this.outsideCloseListener_ = null;
        }
        if (typeof BaseField.prototype.onHide === 'function') BaseField.prototype.onHide.call(this);
    };

    GradientField.prototype.showEditor_ = function () {
        if (typeof document === 'undefined' || !document.body) return;
        const sourceBlock = getGradientFieldSourceBlock(this);
        const dropdown = ScratchBlocks.DropDownDiv;
        dropdown.hideWithoutAnimation();
        dropdown.clearContent();

        const content = dropdown.getContentDiv();
        const picker = document.createElement('section');
        picker.className = styles.gradientPicker;
        picker.setAttribute('aria-label', 'Edit gradient');

        const header = document.createElement('div');
        header.className = styles.gradientHeader;
        const headingGroup = document.createElement('div');
        const heading = document.createElement('h2');
        heading.className = styles.gradientHeading;
        heading.textContent = 'Gradient overlay';
        const helper = document.createElement('p');
        helper.className = styles.gradientHelper;
        helper.textContent = 'Use color stops to shape the layer tint.';
        headingGroup.appendChild(heading);
        headingGroup.appendChild(helper);
        const closeButton = document.createElement('button');
        closeButton.className = styles.gradientCloseButton;
        closeButton.type = 'button';
        closeButton.title = 'Close';
        closeButton.setAttribute('aria-label', 'Close gradient editor');
        closeButton.appendChild(createSvgIcon('M6 6l12 12M18 6 6 18', styles.gradientCloseIcon));
        closeButton.addEventListener('click', () => dropdown.hide());
        header.appendChild(headingGroup);
        header.appendChild(closeButton);
        picker.appendChild(header);

        const preview = document.createElement('div');
        preview.className = styles.gradientPreview;
        preview.setAttribute('aria-label', 'Gradient preview');
        picker.appendChild(preview);

        const stopsList = document.createElement('div');
        stopsList.className = styles.gradientStops;
        stopsList.setAttribute('aria-label', 'Gradient stops');
        picker.appendChild(stopsList);

        const footer = document.createElement('div');
        footer.className = styles.gradientFooter;
        const addButton = document.createElement('button');
        addButton.className = styles.gradientAddButton;
        addButton.type = 'button';
        addButton.textContent = 'Add stop';
        footer.appendChild(addButton);
        picker.appendChild(footer);
        content.appendChild(picker);

        let stops = normalizeGradient(this.getValue()).stops;
        const updateField = () => {
            stops = normalizeGradient({stops}).stops;
            this.setValue({stops});
            preview.style.backgroundImage = `linear-gradient(90deg, ${gradientToCss({stops})})`;
            addButton.disabled = stops.length >= MAX_STOPS;
        };

        const makeStopRow = (stop, index) => {
            const row = document.createElement('div');
            row.className = styles.gradientStop;
            const label = document.createElement('span');
            label.className = styles.gradientStopLabel;
            label.textContent = `Stop ${index + 1}`;
            row.appendChild(label);

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = stop.color;
            colorInput.className = styles.gradientColorInput;
            colorInput.setAttribute('aria-label', `Stop ${index + 1} color`);
            colorInput.addEventListener('input', event => {
                stops[index].color = normalizeColor(event.target.value);
                updateField();
            });
            row.appendChild(colorInput);

            const positionInput = document.createElement('input');
            positionInput.type = 'range';
            positionInput.min = '0';
            positionInput.max = '1';
            positionInput.step = '0.01';
            positionInput.value = String(stop.position);
            positionInput.className = styles.gradientPositionInput;
            positionInput.setAttribute('aria-label', `Stop ${index + 1} position`);
            positionInput.addEventListener('input', event => {
                stops[index].position = clamp(Number(event.target.value) || 0, 0, 1);
                updateField();
            });
            row.appendChild(positionInput);

            const positionLabel = document.createElement('output');
            positionLabel.className = styles.gradientPositionLabel;
            positionLabel.textContent = `${Math.round(stop.position * 100)}%`;
            row.appendChild(positionLabel);

            if (stops.length > 2) {
                const removeButton = document.createElement('button');
                removeButton.className = styles.gradientRemoveButton;
                removeButton.type = 'button';
                removeButton.textContent = 'Remove';
                removeButton.addEventListener('click', () => {
                    stops.splice(index, 1);
                    updateField();
                    // The row renderer is declared below so it can reuse the row factory.
                    // eslint-disable-next-line no-use-before-define
                    renderStops();
                });
                row.appendChild(removeButton);
            }
            return row;
        };

        const renderStops = () => {
            stopsList.textContent = '';
            stops.forEach((stop, index) => stopsList.appendChild(makeStopRow(stop, index)));
        };

        addButton.addEventListener('click', () => {
            if (stops.length >= MAX_STOPS) return;
            const sorted = stops.slice().sort((a, b) => a.position - b.position);
            let largestGap = 0;
            let insertAfter = 0;
            for (let index = 0; index < sorted.length - 1; index++) {
                const gap = sorted[index + 1].position - sorted[index].position;
                if (gap > largestGap) {
                    largestGap = gap;
                    insertAfter = index;
                }
            }
            const left = sorted[insertAfter];
            const right = sorted[insertAfter + 1] || left;
            stops.push({
                color: left.color,
                position: right === left ? clamp(left.position + 0.1, 0, 1) :
                    (left.position + right.position) / 2
            });
            updateField();
            renderStops();
        });

        picker.addEventListener('keydown', event => {
            if (event.key === 'Escape') dropdown.hide();
        });
        this.onHide();
        const boundsElement = sourceBlock && sourceBlock.workspace && sourceBlock.workspace.getParentSvg ?
            sourceBlock.workspace.getParentSvg().parentNode : document.body;
        dropdown.setColour('var(--ui-modal-background)', 'var(--ui-black-transparent)');
        if (sourceBlock && sourceBlock.getCategory) dropdown.setCategory(sourceBlock.getCategory());
        dropdown.setBoundsElement(boundsElement);
        dropdown.showPositionedByBlock(this, sourceBlock, this.onHide.bind(this));
        this.outsideCloseListener_ = event => {
            if (!picker.contains(event.target)) dropdown.hide();
        };
        document.addEventListener('pointerdown', this.outsideCloseListener_, true);
        updateField();
        renderStops();
    };
    return GradientField;
};


const COLOR_GRADING_MENU = 'colorGradingPresets';
const PREVIEW_FALLBACK_MS = 450;

const getPenFX = vm => vm && vm.runtime && vm.runtime.penFX || null;

// Each Easy menu describes its presets and how a thumbnail is drawn; the picker itself is shared.
const colorGradingPickerSource = locale => ({
    label: localize(locale, 'Color grading presets', 'カラーグレーディングのプリセット'),
    categories: COLOR_GRADING_CATEGORIES.map(category => ({id: category.id, name: category.name})),
    presets: COLOR_GRADING_PRESETS.map(preset => ({id: preset.id, name: preset.name, category: preset.category, preset})),
    thumbnailsPerFrame: 16,
    getRenderer: () => getColorGradingPreviewRenderer(),
    drawThumbnail: (renderer, entry, canvas) => renderer.draw(entry.preset, canvas)
});

const easyEffectPickerSource = (block, vm, locale) => ({
    label: localize(locale, 'Effect presets', 'エフェクトのプリセット'),
    categories: block.categories.map(category => ({id: category.id, name: localize(locale, category.name, category.ja)})),
    presets: block.presets.map(preset => ({
        id: preset.id,
        name: presetName(preset, locale),
        category: preset.category,
        keywords: `${preset.name} ${preset.ja}`,
        preset
    })),
    // Effect recipes can run several passes, and a Genshade effect compiles its shaders on first use, so each
    // animation frame draws thumbnails only until its time budget is spent.
    thumbnailsPerFrame: 8,
    frameBudgetMs: 12,
    getRenderer: () => {
        const penFX = getPenFX(vm);
        if (!penFX || typeof penFX.runEasyPreset !== 'function') throw new Error('PenFX is not available.');
        return getEasyEffectPreviewRenderer(penFX);
    },
    // Genshade shaders load in the background; wait for them so the first thumbnails are not ungraded.
    ready: () => {
        const penFX = getPenFX(vm);
        return penFX && penFX.genshadeReady;
    },
    drawThumbnail: (renderer, entry, canvas) => renderer.draw(block.opcode, entry.preset, canvas)
});

// The PenFX block that owns the menu shadow is the one whose input is captured while the picker is open.
const getColorGradingBlockId = sourceBlock => {
    if (!sourceBlock || !sourceBlock.workspace || sourceBlock.workspace.isFlyout) return null;
    const parent = typeof sourceBlock.getParent === 'function' ? sourceBlock.getParent() : null;
    const owner = sourceBlock.isShadow && sourceBlock.isShadow() && parent ? parent : sourceBlock;
    return owner && owner.id || null;
};

const createEasyPresetField = (ScratchBlocks, vm, locale, pickerSource) => {
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
        if (value !== undefined) this.setValue(value);
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
        const sourceBlock = getGradientFieldSourceBlock(this);
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

        const blockId = getColorGradingBlockId(sourceBlock);
        const penFX = getPenFX(vm);
        const unsubscribe = blockId && penFX && typeof penFX.requestEasyPreview === 'function' ?
            penFX.requestEasyPreview(blockId, snapshot => {
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

const createColorGradingPresetField = (ScratchBlocks, vm, locale = 'en') =>
    createEasyPresetField(ScratchBlocks, vm, locale, () => colorGradingPickerSource(locale));

const installPenFXBlockDefinitions = (ScratchBlocks, locale = 'en', vm = null) => {
    if (!ScratchBlocks || !ScratchBlocks.Blocks || !ScratchBlocks.FieldTextInput) return;
    const GradientField = createGradientField(ScratchBlocks);
    if (ScratchBlocks.FieldDropdown) {
        const menus = [[COLOR_GRADING_MENU, () => colorGradingPickerSource(locale)]].concat(easyBlocks.map(block => (
            [block.menu, () => easyEffectPickerSource(block, vm, locale)]
        )));
        for (const [menu, pickerSource] of menus) {
            const PresetField = createEasyPresetField(ScratchBlocks, vm, locale, pickerSource);
            ScratchBlocks.Blocks[`penfx_menu_${menu}`] = {
                init: function () {
                    this.appendDummyInput().appendField(new PresetField(), menu);
                    this.setInputsInline(true);
                    this.setOutput(true, 'String');
                    this.setColour('#6b56d9', '#5945c2', '#46359f');
                    this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_ROUND);
                }
            };
        }
    }
    ScratchBlocks.Blocks.penfx_gradationOverlay = {
        init: function () {
            this.appendDummyInput('GRADIENT_INPUT')
                .appendField(localize(locale, 'gradation overlay', 'グラデーションオーバーレイ'))
                .appendField(new GradientField(), 'GRADIENT');
            this.appendValueInput('DIR').appendField(localize(locale, 'dir:', '向き:'));
            this.appendValueInput('MIX')
                .appendField(localize(locale, 'mix:', '混合:'))
                .appendField('%');
            this.setInputsInline(true);
            this.setColour('#6b56d9', '#5945c2', '#46359f');
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
        }
    };
};

export {
    DEFAULT_GRADIENT,
    createColorGradingPresetField,
    createEasyPresetField,
    createGradientField,
    getColorGradingBlockId,
    gradientToCss,
    normalizeGradient,
    serializeGradient
};
export default installPenFXBlockDefinitions;
