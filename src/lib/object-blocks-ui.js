import {
    DRAW_SOURCES,
    PRIMARY,
    SECONDARY,
    SHAPE_TYPES,
    TERTIARY,
    decodeDrawAsset,
    encodeDrawAsset,
    normalizeShapeType
} from './object-blocks';
import installObjectCompositionBlockDefinitions from './object-composition-blocks-ui';
import log from './log';
import {mountInlinePaintEditor, unmountInlinePaintEditor} from './inline-paint-editor';
import addLibraryCostumeIcon from '../components/asset-panel/icon--add-costume-lib.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';

import styles from './object-blocks-ui.css';

const IMPORT_VALUE = '__movie_import__';
const INLINE_PAINT_REFERENCE_HEIGHT = 700;
const INLINE_PAINT_REFERENCE_WIDTH = 1249;
const SOURCE_LABELS = {
    costume: 'Costume',
    model: 'Model',
    text: 'Font',
    video: 'Video'
};
const IMPORT_ACCEPT = [
    '.svg', '.png', '.bmp', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.exr',
    '.mp4', '.webm', '.ogv', '.mov',
    '.ttf', '.otf', '.woff', '.woff2',
    '.glb', '.pmx', '.fbx', '.obj', '.mtl',
    '.spa', '.sph', '.tga', '.vmd', '.vpd'
].join(',');

const MEDIA_FIELD_ICON = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1.5">' +
    '<rect x="1.75" y="1.75" width="5" height="5" rx="1"/><rect x="9.25" y="1.75" width="5" height="5" rx="1"/>' +
    '<rect x="1.75" y="9.25" width="5" height="5" rx="1"/><rect x="9.25" y="9.25" width="5" height="5" rx="1"/>' +
    '</svg>'
)}`;

const createSvgIcon = (path, className) => {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-width', '2');
    const shape = document.createElementNS(namespace, 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
};

const getFieldSourceBlock = field => {
    if (field && typeof field.getSourceBlock === 'function') return field.getSourceBlock();
    return field && field.sourceBlock_;
};

const getAssetItems = vm => {
    const items = [];
    const addItems = (source, assets, makeItem = () => ({})) => {
        assets.forEach((asset, index) => {
            const name = typeof asset === 'string' ? asset : asset.name;
            if (!name) return;
            items.push(Object.assign({
                deletable: false,
                index,
                label: SOURCE_LABELS[source],
                name,
                source,
                value: encodeDrawAsset(source, name)
            }, makeItem(asset, index)));
        });
    };

    const target = vm.editingTarget;
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    if (target && typeof target.getCostumes === 'function') {
        const costumes = target.getCostumes();
        addItems('costume', costumes, costume => {
            let previewUrl = '';
            try {
                if (costume.asset && typeof costume.asset.encodeDataURI === 'function') {
                    previewUrl = costume.asset.encodeDataURI();
                }
            } catch (error) { // A missing preview must not make the media itself unavailable.
                log.warn(error);
            }
            return {
                deletable: costumes.length > 1,
                details: costume.size ? `${Math.ceil(costume.size[0] / (costume.bitmapResolution || 1))} × ${
                    Math.ceil(costume.size[1] / (costume.bitmapResolution || 1))}` : '',
                previewType: 'image',
                previewUrl
            };
        });
    }
    if (manager && target) {
        addItems('video', manager.getVideos(target), video => ({
            deletable: true,
            previewType: 'video',
            previewUrl: video.url
        }));
        addItems('model', manager.getModels(target), model => ({
            deletable: true,
            model,
            previewType: 'model'
        }));
    }

    const fonts = [
        {name: 'Sans Serif', value: 'sans-serif'},
        {name: 'Serif', value: 'serif'},
        {name: 'Monospace', value: 'monospace'}
    ];
    const fontManager = vm.runtime && vm.runtime.fontManager;
    if (fontManager && typeof fontManager.getFonts === 'function') {
        fontManager.getFonts().forEach((font, index) => fonts.push({
            deletable: true,
            family: font.family || font.name,
            index,
            name: font.name,
            value: font.name
        }));
    }
    fonts.forEach(font => items.push({
        family: font.family || font.value,
        label: SOURCE_LABELS.text,
        name: font.name,
        previewType: 'font',
        source: 'text',
        value: encodeDrawAsset('text', font.value),
        deletable: Boolean(font.deletable),
        index: font.index
    }));

    return items;
};

const getAssetOptions = vm => [
    ['Import', IMPORT_VALUE],
    ...getAssetItems(vm).map(item => [`${item.label}: ${item.name}`, item.value])
];

const modelHasFrames = model => {
    if (!model) return false;
    return (Array.isArray(model.motions) &&
        model.motions.some(motion => Number(motion && motion.frameCount) > 0)) ||
        Number(model.animationCount) > 0;
};

const normalizeVideoMode = mode => (
    String(mode || '').toLowerCase() === 'video' ? 'video' : 'sequence'
);

const drawSelectionUsesFrame = (vm, source, asset, videoMode = 'sequence') => {
    if (source === 'video') return normalizeVideoMode(videoMode) === 'sequence';
    if (source !== 'model') return false;
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    const target = vm.editingTarget;
    if (!manager || !target || typeof manager.getModels !== 'function') return false;
    return modelHasFrames(manager.getModels(target).find(model => model.name === asset));
};

const getDrawInputVisibility = (vm, source, asset, videoMode) => {
    const isVideo = source === 'video';
    const normalizedMode = normalizeVideoMode(videoMode);
    const playsVideo = isVideo && normalizedMode === 'video';
    return {
        frame: drawSelectionUsesFrame(vm, source, asset, normalizedMode),
        speed: playsVideo,
        text: source === 'text',
        videoMode: isVideo,
        volume: playsVideo
    };
};

const deleteAsset = (vm, item) => {
    if (!item || !item.deletable) return false;
    const target = vm.editingTarget;
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    if (item.source === 'costume') {
        if (!target || typeof target.getCostumes !== 'function' || target.getCostumes().length <= 1 ||
            typeof vm.deleteCostume !== 'function') return false;
        return Boolean(vm.deleteCostume(item.index));
    }
    if (item.source === 'video' && manager && target && typeof manager.deleteVideo === 'function') {
        manager.deleteVideo(target.id, item.index);
        return true;
    }
    if (item.source === 'model' && manager && target && typeof manager.deleteModel === 'function') {
        manager.deleteModel(target.id, item.index);
        return true;
    }
    if (item.source === 'text' && manager && typeof manager.deleteFont === 'function') {
        manager.deleteFont(item.index);
        return true;
    }
    return false;
};

const getLiveBlock = (block, workspace = block && block.workspace) => {
    if (!block) return null;
    if (workspace && block.id && typeof workspace.getBlockById === 'function') {
        return workspace.getBlockById(block.id) || block;
    }
    return block;
};

const getImportedBlock = (ScratchBlocks, block, originalWorkspace) => {
    if (ScratchBlocks && typeof ScratchBlocks.getMainWorkspace === 'function' && block && block.id) {
        const mainWorkspace = ScratchBlocks.getMainWorkspace();
        if (mainWorkspace && typeof mainWorkspace.getBlockById === 'function') {
            const mainBlock = mainWorkspace.getBlockById(block.id);
            if (mainBlock) return mainBlock;
        }
    }
    return getLiveBlock(block, originalWorkspace);
};

const persistDrawAsset = (vm, block, source, asset) => {
    const value = encodeDrawAsset(source, asset);
    const target = vm.editingTarget;
    const blocks = target && target.blocks;
    const storedBlock = blocks && block && block.id && typeof blocks.getBlock === 'function' ?
        blocks.getBlock(block.id) : null;
    if (storedBlock && typeof blocks.changeBlock === 'function') {
        blocks.changeBlock({
            element: 'field',
            id: block.id,
            name: 'SOURCE',
            value: source
        });
        blocks.changeBlock({
            element: 'field',
            id: block.id,
            name: 'ASSET',
            value
        });
    }

    const liveBlock = getLiveBlock(block);
    if (liveBlock && typeof liveBlock.setDrawAsset_ === 'function') {
        liveBlock.objectDrawImportError_ = null;
        liveBlock.setDrawAsset_(source, asset);
    }
    return liveBlock;
};

const showImportError = (block, error) => {
    const message = error && error.message ? error.message : String(error);
    const liveBlock = getLiveBlock(block);
    if (liveBlock) {
        liveBlock.objectDrawImportError_ = message;
        if (typeof liveBlock.setWarningText === 'function') liveBlock.setWarningText(null);
    }
    log.error(error);
};

const importDrawFiles = (vm, block, ScratchBlocks, files) => {
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    const target = vm.editingTarget;
    if (!manager || typeof manager.importFiles !== 'function' || !target) {
        showImportError(block, new Error('Select an object before importing an asset.'));
        return;
    }
    const importedFiles = Array.from(files || []);
    if (!importedFiles.length) return;

    const selection = decodeDrawAsset(
        block.getFieldValue('ASSET'),
        block.getFieldValue('SOURCE') || block.objectDrawSource_
    );
    // Importing an asset refreshes Blockly before this promise resolves. Keep
    // the workspace reference so we can find the replacement block by its ID.
    const workspace = block.workspace;
    const currentBlock = getImportedBlock(ScratchBlocks, block, workspace);
    if (currentBlock) {
        currentBlock.objectDrawImportError_ = null;
        if (typeof currentBlock.setWarningText === 'function') currentBlock.setWarningText(null);
    }
    manager.importFiles(target.id, importedFiles, {
        modelName: selection.source === 'model' ? selection.asset : ''
    }).then(imported => {
        const drawable = imported.slice().reverse()
            .find(asset => DRAW_SOURCES.includes(asset.source));
        if (drawable) {
            persistDrawAsset(
                vm,
                getImportedBlock(ScratchBlocks, block, workspace),
                drawable.source,
                drawable.name
            );
        }
    }, error => showImportError(block, error));
};

const getClipboardFiles = clipboardData => {
    if (!clipboardData) return [];
    const files = Array.from(clipboardData.files || []);
    if (files.length) return files;
    return Array.from(clipboardData.items || [])
        .filter(item => item && item.kind === 'file' && typeof item.getAsFile === 'function')
        .map(item => item.getAsFile())
        .filter(Boolean);
};

const hasFileTransfer = dataTransfer => (
    Boolean(dataTransfer) && Array.from(dataTransfer.types || []).includes('Files')
);

const openImportPicker = (vm, block, ScratchBlocks, files = []) => {
    const importedFiles = Array.from(files || []);
    if (importedFiles.length) {
        importDrawFiles(vm, block, ScratchBlocks, importedFiles);
        return;
    }
    if (typeof document === 'undefined' || !document.body) return;
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    const target = vm.editingTarget;
    if (!manager || typeof manager.importFiles !== 'function' || !target) {
        showImportError(block, new Error('Select an object before importing an asset.'));
        return;
    }

    const input = document.createElement('input');
    input.accept = IMPORT_ACCEPT;
    input.multiple = true;
    input.type = 'file';
    input.style.display = 'none';
    const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.addEventListener('cancel', cleanup);
    input.addEventListener('change', () => {
        const selectedFiles = Array.from(input.files || []);
        cleanup();
        if (!selectedFiles.length) return;
        importDrawFiles(vm, block, ScratchBlocks, selectedFiles);
    });
    document.body.appendChild(input);
    input.click();
};

const createMediaField = (ScratchBlocks, vm, assetOptions, assetValidator) => {
    class MediaField extends ScratchBlocks.FieldDropdown {
        constructor () {
            super(assetOptions, assetValidator);
            this.inlineEditorRoot_ = null;
            this.inlineEditorResizeObserver_ = null;
            this.inlineEditorResize_ = null;
            this.inlineEditorOverlay_ = null;
            this.inlineEditorDropdownContainer_ = null;
            this.previewRenderers_ = [];
            this.previewVersion_ = 0;
        }

        init () {
            super.init();
            if (this.arrow_) {
                this.arrowSize_ = 14;
                this.arrow_.setAttribute('height', `${this.arrowSize_}px`);
                this.arrow_.setAttribute('width', `${this.arrowSize_}px`);
                this.arrow_.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', MEDIA_FIELD_ICON);
            }
        }

        refreshDisplay_ () {
            const selectedOption = this.getOptions().find(option => option[1] === this.getValue());
            if (selectedOption) this.setText(selectedOption[0]);
        }

        disposePreviews_ () {
            this.previewVersion_++;
            this.previewRenderers_.forEach(renderer => renderer.dispose());
            this.previewRenderers_ = [];
        }

        disposeInlineEditor_ () {
            if (this.inlineEditorResizeObserver_) {
                this.inlineEditorResizeObserver_.disconnect();
                this.inlineEditorResizeObserver_ = null;
            }
            this.inlineEditorResize_ = null;
            if (!this.inlineEditorRoot_) return;
            unmountInlinePaintEditor(this.inlineEditorRoot_);
            this.inlineEditorRoot_ = null;
        }

        disposeInlineEditorOverlay_ () {
            if (this.inlineEditorDropdownContainer_) {
                this.inlineEditorDropdownContainer_.classList.remove(styles.mediaDropdownHidden);
                this.inlineEditorDropdownContainer_ = null;
            }
            if (!this.inlineEditorOverlay_) return;
            if (this.inlineEditorOverlay_.parentNode) {
                this.inlineEditorOverlay_.parentNode.removeChild(this.inlineEditorOverlay_);
            }
            this.inlineEditorOverlay_ = null;
        }

        removeOutsideCloseListener_ () {
            if (!this.outsideCloseListener_ || typeof document === 'undefined') return;
            document.removeEventListener('pointerdown', this.outsideCloseListener_, true);
            this.outsideCloseListener_ = null;
        }

        onHide () {
            this.removeOutsideCloseListener_();
            this.disposeInlineEditor_();
            this.disposeInlineEditorOverlay_();
            this.disposePreviews_();
            super.onHide();
        }

        showEditor_ () {
            const items = getAssetItems(vm);
            const manager = vm.runtime && vm.runtime.movieAssetManager;
            this.dropDownOpen_ = true;
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
            ScratchBlocks.DropDownDiv.clearContent();

            const content = ScratchBlocks.DropDownDiv.getContentDiv();
            const picker = document.createElement('section');
            picker.className = styles.mediaPicker;
            picker.setAttribute('aria-label', 'Choose media for draw');
            const boundsElement = this.sourceBlock_.workspace.getParentSvg().parentNode;
            const availableWidth = Math.max(240, boundsElement.clientWidth - 16);
            picker.style.setProperty('--media-picker-available-width', `${availableWidth}px`);

            const header = document.createElement('div');
            header.className = styles.mediaHeader;
            const headingGroup = document.createElement('div');
            const heading = document.createElement('h2');
            heading.className = styles.mediaHeading;
            heading.textContent = 'Choose media';
            const helper = document.createElement('p');
            helper.className = styles.mediaHelper;
            helper.textContent = 'Import, drop, or paste files with ⌘V / Ctrl+V, then select one.';
            headingGroup.appendChild(heading);
            headingGroup.appendChild(helper);
            const importButton = document.createElement('button');
            importButton.className = styles.importButton;
            importButton.type = 'button';
            importButton.appendChild(createSvgIcon('M12 3v12m0-12 4 4m-4-4-4 4M5 14v5h14v-5', styles.buttonIcon));
            importButton.appendChild(document.createTextNode('Import'));
            importButton.addEventListener('click', () => {
                ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                openImportPicker(vm, getLiveBlock(this.sourceBlock_), ScratchBlocks);
            });
            const headerActions = document.createElement('div');
            headerActions.className = styles.mediaActions;
            const closeButton = document.createElement('button');
            closeButton.className = styles.closeButton;
            closeButton.type = 'button';
            closeButton.title = 'Close';
            closeButton.setAttribute('aria-label', 'Close media picker');
            closeButton.appendChild(createSvgIcon('M6 6l12 12M18 6 6 18', styles.closeIcon));
            closeButton.addEventListener('click', () => ScratchBlocks.DropDownDiv.hide());
            headerActions.appendChild(importButton);
            headerActions.appendChild(closeButton);
            header.appendChild(headingGroup);
            header.appendChild(headerActions);
            picker.appendChild(header);

            const sourceBlock = getLiveBlock(this.sourceBlock_);
            if (sourceBlock && typeof sourceBlock.setWarningText === 'function') sourceBlock.setWarningText(null);
            if (sourceBlock && sourceBlock.objectDrawImportError_) {
                const importError = document.createElement('div');
                importError.className = styles.importError;
                importError.textContent = `Import failed: ${sourceBlock.objectDrawImportError_}`;
                picker.appendChild(importError);
            }

            const filterBar = document.createElement('div');
            filterBar.className = styles.filterBar;
            filterBar.setAttribute('aria-label', 'Filter media');
            const grid = document.createElement('div');
            grid.className = styles.mediaGrid;
            grid.setAttribute('aria-label', 'Available media');
            grid.setAttribute('role', 'listbox');

            const viewSwitchBar = document.createElement('div');
            viewSwitchBar.className = styles.viewSwitchBar;
            const viewSwitch = document.createElement('div');
            viewSwitch.className = styles.viewSwitch;
            viewSwitch.setAttribute('aria-label', 'Media picker view');
            viewSwitch.setAttribute('role', 'group');
            const mediaViewButton = document.createElement('button');
            mediaViewButton.className = `${styles.viewButton} ${styles.viewButtonActive}`;
            mediaViewButton.type = 'button';
            mediaViewButton.setAttribute('aria-label', 'Show media');
            mediaViewButton.setAttribute('aria-pressed', 'true');
            mediaViewButton.appendChild(createSvgIcon(
                'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
                styles.viewIcon
            ));
            mediaViewButton.appendChild(document.createTextNode('Media'));
            const editViewButton = document.createElement('button');
            editViewButton.className = styles.viewButton;
            editViewButton.type = 'button';
            editViewButton.setAttribute('aria-label', 'Edit selected costume');
            editViewButton.setAttribute('aria-pressed', 'false');
            editViewButton.appendChild(createSvgIcon(
                'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z',
                styles.viewIcon
            ));
            editViewButton.appendChild(document.createTextNode('Edit'));
            const editHint = document.createElement('span');
            editHint.className = styles.editHint;
            viewSwitch.appendChild(mediaViewButton);
            viewSwitch.appendChild(editViewButton);
            viewSwitchBar.appendChild(viewSwitch);
            viewSwitchBar.appendChild(editHint);
            picker.appendChild(viewSwitchBar);

            const browserView = document.createElement('div');
            browserView.className = styles.browserView;
            browserView.setAttribute('aria-label', 'Media browser');
            browserView.appendChild(filterBar);
            browserView.appendChild(grid);
            picker.appendChild(browserView);

            const editorView = document.createElement('div');
            editorView.className = styles.editorView;
            editorView.setAttribute('aria-label', 'Costume editor');
            editorView.hidden = true;
            const editorLayout = document.createElement('div');
            editorLayout.className = styles.editorLayout;
            const costumeRail = document.createElement('div');
            costumeRail.className = styles.costumeRail;
            const costumeRailList = document.createElement('div');
            costumeRailList.className = styles.costumeRailList;
            costumeRailList.setAttribute('aria-label', 'Costumes');
            costumeRailList.setAttribute('role', 'listbox');
            const costumeActionMenu = document.createElement('div');
            costumeActionMenu.className = styles.costumeActionMenu;
            const uploadCostumeButton = document.createElement('button');
            uploadCostumeButton.className = styles.costumeActionSecondary;
            uploadCostumeButton.type = 'button';
            uploadCostumeButton.title = 'Upload Costume';
            uploadCostumeButton.setAttribute('aria-label', 'Upload Costume');
            const uploadCostumeIcon = document.createElement('img');
            uploadCostumeIcon.alt = '';
            uploadCostumeIcon.draggable = false;
            uploadCostumeIcon.src = fileUploadIcon;
            uploadCostumeButton.appendChild(uploadCostumeIcon);
            uploadCostumeButton.addEventListener('click', () => {
                openImportPicker(vm, getLiveBlock(this.sourceBlock_), ScratchBlocks);
            });
            const chooseCostumeButton = document.createElement('button');
            chooseCostumeButton.className = styles.costumeActionButton;
            chooseCostumeButton.type = 'button';
            chooseCostumeButton.title = 'Choose a Costume';
            chooseCostumeButton.setAttribute('aria-label', 'Choose a Costume');
            const chooseCostumeIcon = document.createElement('img');
            chooseCostumeIcon.alt = '';
            chooseCostumeIcon.draggable = false;
            chooseCostumeIcon.src = addLibraryCostumeIcon;
            chooseCostumeButton.appendChild(chooseCostumeIcon);
            costumeActionMenu.appendChild(uploadCostumeButton);
            costumeActionMenu.appendChild(chooseCostumeButton);
            costumeRail.appendChild(costumeRailList);
            costumeRail.appendChild(costumeActionMenu);
            const editorViewport = document.createElement('div');
            editorViewport.className = styles.inlineEditor;
            const editorRoot = document.createElement('div');
            editorRoot.className = styles.inlineEditorSurface;
            editorViewport.appendChild(editorRoot);
            editorLayout.appendChild(costumeRail);
            editorLayout.appendChild(editorViewport);
            editorView.appendChild(editorLayout);
            picker.appendChild(editorView);

            const dropOverlay = document.createElement('div');
            dropOverlay.className = styles.dropOverlay;
            dropOverlay.setAttribute('aria-label', 'Drop files to import');
            dropOverlay.setAttribute('aria-hidden', 'true');
            dropOverlay.setAttribute('role', 'status');
            dropOverlay.appendChild(createSvgIcon(
                'M12 3v12m0-12 4 4m-4-4-4 4M5 14v5h14v-5',
                styles.dropIcon
            ));
            const dropLabel = document.createElement('span');
            dropLabel.textContent = 'Drop files to import';
            dropOverlay.appendChild(dropLabel);
            picker.appendChild(dropOverlay);
            content.appendChild(picker);

            const filterOptions = [
                {label: 'All', value: 'all'},
                {label: 'Images', value: 'costume'},
                {label: 'Videos', value: 'video'},
                {label: 'Fonts', value: 'text'},
                {label: '3D', value: 'model'}
            ].filter(filter => filter.value === 'all' || items.some(item => item.source === filter.value));
            let activeFilter = 'all';
            let activeFilterButton;
            let activeView = 'media';
            let renderedButtons = [];
            let renderedCostumeButtons = [];

            const getSelectedCostume = () => items.find(item => (
                item.source === 'costume' && item.value === this.getValue()
            ));

            const updateEditAvailability = () => {
                const costume = getSelectedCostume();
                editViewButton.disabled = !costume;
                editHint.textContent = costume ?
                    `${costume.name} · edits save automatically` :
                    'Select an image to edit';
            };

            const selectItem = item => {
                let value = this.callValidator(item.value);
                if (typeof value === 'undefined') value = item.value;
                if (value !== null) {
                    this.setValue(value);
                    this.refreshDisplay_();
                }
                ScratchBlocks.Events.setGroup(false);
                updateEditAvailability();
            };

            const syncRenderedSelection = () => {
                renderedButtons.forEach(button => {
                    const selected = button.objectDrawValue_ === this.getValue();
                    button.setAttribute('aria-selected', String(selected));
                    button.parentNode.classList.toggle(styles.mediaItemSelected, selected);
                    if (selected && !button.objectDrawSelectedCheck_) {
                        const check = document.createElement('span');
                        check.className = styles.selectedCheck;
                        check.appendChild(createSvgIcon('m5 12 4 4L19 6', styles.checkIcon));
                        button.appendChild(check);
                        button.objectDrawSelectedCheck_ = check;
                    } else if (!selected && button.objectDrawSelectedCheck_) {
                        button.removeChild(button.objectDrawSelectedCheck_);
                        button.objectDrawSelectedCheck_ = null;
                    }
                });
            };

            const syncCostumeRailSelection = () => {
                renderedCostumeButtons.forEach(button => {
                    const selected = button.objectDrawItem_.value === this.getValue();
                    button.setAttribute('aria-selected', String(selected));
                    button.classList.toggle(styles.costumeRailItemSelected, selected);
                });
            };

            const mountSelectedCostumeEditor = () => {
                const costume = getSelectedCostume();
                if (!costume) return;
                this.disposeInlineEditor_();
                editorRoot.textContent = '';
                editorRoot.classList.remove(styles.editorUnavailable);
                const resizeEditorToViewport = () => {
                    if (this.inlineEditorOverlay_) {
                        editorLayout.style.height = '';
                        editorRoot.style.setProperty('--inline-paint-scale', '1');
                        return;
                    }
                    const viewportWidth = editorViewport.clientWidth || Math.min(544, availableWidth) - 72;
                    const viewportBounds = typeof editorViewport.getBoundingClientRect === 'function' ?
                        editorViewport.getBoundingClientRect() : null;
                    const visibleViewportHeight = viewportBounds && typeof window !== 'undefined' ?
                        Math.max(140, window.innerHeight - viewportBounds.top - 16) : 384;
                    const editorScale = Math.min(
                        viewportWidth / INLINE_PAINT_REFERENCE_WIDTH,
                        visibleViewportHeight / INLINE_PAINT_REFERENCE_HEIGHT,
                        1
                    );
                    editorLayout.style.height = `${INLINE_PAINT_REFERENCE_HEIGHT * editorScale}px`;
                    editorRoot.style.setProperty('--inline-paint-scale', String(editorScale));
                };
                this.inlineEditorResize_ = resizeEditorToViewport;
                resizeEditorToViewport();
                this.inlineEditorRoot_ = editorRoot;
                const mounted = mountInlinePaintEditor(editorRoot, costume.index, name => {
                    const oldValue = costume.value;
                    costume.name = name;
                    costume.value = encodeDrawAsset('costume', name);
                    selectItem(costume);
                    const selectedButton = renderedButtons.find(button => button.objectDrawValue_ === oldValue);
                    if (selectedButton) {
                        selectedButton.objectDrawValue_ = costume.value;
                        selectedButton.setAttribute('aria-label', `${costume.label}: ${name}`);
                        selectedButton.objectDrawNameElement_.textContent = name;
                    }
                    const railButton = renderedCostumeButtons.find(button => button.objectDrawItem_ === costume);
                    if (railButton) {
                        railButton.setAttribute('aria-label', `Edit Costume: ${name}`);
                        railButton.objectDrawNameElement_.textContent = name;
                    }
                    syncRenderedSelection();
                    syncCostumeRailSelection();
                    editHint.textContent = `${name} · edits save automatically`;
                });
                if (!mounted) {
                    this.inlineEditorRoot_ = null;
                    editorRoot.textContent = 'The costume editor is unavailable. Reopen Movie and try again.';
                    editorRoot.classList.add(styles.editorUnavailable);
                } else if (typeof ResizeObserver !== 'undefined') {
                    this.inlineEditorResizeObserver_ = new ResizeObserver(resizeEditorToViewport);
                    this.inlineEditorResizeObserver_.observe(editorViewport);
                }
            };

            const renderCostumeRail = () => {
                costumeRailList.textContent = '';
                renderedCostumeButtons = [];
                items.filter(item => item.source === 'costume').forEach((item, index) => {
                    const selected = item.value === this.getValue();
                    const button = document.createElement('button');
                    button.className = `${styles.costumeRailItem}${selected ?
                        ` ${styles.costumeRailItemSelected}` : ''}`;
                    button.type = 'button';
                    button.setAttribute('aria-label', `Edit ${item.label}: ${item.name}`);
                    button.setAttribute('aria-selected', String(selected));
                    button.setAttribute('role', 'option');
                    button.objectDrawItem_ = item;
                    const number = document.createElement('span');
                    number.className = styles.costumeRailNumber;
                    number.textContent = String(index + 1);
                    const preview = document.createElement('span');
                    preview.className = styles.costumeRailPreview;
                    if (item.previewUrl) {
                        const image = document.createElement('img');
                        image.alt = '';
                        image.src = item.previewUrl;
                        preview.appendChild(image);
                    } else {
                        preview.appendChild(createSvgIcon(
                            'M4 5h16v14H4zM4 15l4-4 3 3 2-2 7 7M16 9h.01',
                            styles.fallbackIcon
                        ));
                    }
                    const name = document.createElement('span');
                    name.className = styles.costumeRailName;
                    name.textContent = item.name;
                    button.objectDrawNameElement_ = name;
                    const details = document.createElement('span');
                    details.className = styles.costumeRailDetails;
                    details.textContent = item.details;
                    button.appendChild(number);
                    button.appendChild(preview);
                    button.appendChild(name);
                    button.appendChild(details);
                    button.addEventListener('click', () => {
                        selectItem(item);
                        syncRenderedSelection();
                        syncCostumeRailSelection();
                        mountSelectedCostumeEditor();
                    });
                    costumeRailList.appendChild(button);
                    renderedCostumeButtons.push(button);
                });
            };

            const setActiveView = view => {
                if (view === 'editor' && !getSelectedCostume()) return;
                activeView = view;
                const editing = view === 'editor';
                browserView.hidden = editing;
                editorView.hidden = !editing;
                editorView.classList.toggle(styles.editorViewFullscreen, editing);
                mediaViewButton.classList.toggle(styles.viewButtonActive, !editing);
                editViewButton.classList.toggle(styles.viewButtonActive, editing);
                mediaViewButton.setAttribute('aria-pressed', String(!editing));
                editViewButton.setAttribute('aria-pressed', String(editing));
                if (!editing) {
                    this.disposeInlineEditor_();
                    if (this.inlineEditorOverlay_) {
                        picker.hidden = false;
                        if (this.inlineEditorDropdownContainer_) {
                            this.inlineEditorDropdownContainer_.classList.remove(styles.mediaDropdownHidden);
                            this.inlineEditorDropdownContainer_ = null;
                        }
                        picker.insertBefore(header, picker.firstChild);
                        picker.insertBefore(viewSwitchBar, browserView);
                        picker.insertBefore(editorView, dropOverlay);
                        this.inlineEditorOverlay_ = null;
                    }
                    (renderedButtons.find(button => button.getAttribute('aria-selected') === 'true') ||
                        renderedButtons[0] || importButton).focus();
                    return;
                }
                if (typeof document !== 'undefined' && document.body) {
                    editorView.insertBefore(header, editorLayout);
                    editorView.insertBefore(viewSwitchBar, editorLayout);
                    document.body.appendChild(editorView);
                    this.inlineEditorOverlay_ = editorView;
                    picker.hidden = true;
                    if (content.parentNode) {
                        this.inlineEditorDropdownContainer_ = content.parentNode;
                        this.inlineEditorDropdownContainer_.classList.add(styles.mediaDropdownHidden);
                    }
                }
                syncCostumeRailSelection();
                mountSelectedCostumeEditor();
                if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                    window.requestAnimationFrame(() => {
                        if (this.inlineEditorResize_) this.inlineEditorResize_();
                    });
                }
            };

            mediaViewButton.addEventListener('click', () => setActiveView('media'));
            editViewButton.addEventListener('click', () => setActiveView('editor'));
            chooseCostumeButton.addEventListener('click', () => setActiveView('media'));
            renderCostumeRail();

            const renderPreview = (item, preview) => {
                if (item.previewType === 'image' && item.previewUrl) {
                    const image = document.createElement('img');
                    image.alt = '';
                    image.loading = 'lazy';
                    image.src = item.previewUrl;
                    preview.appendChild(image);
                } else if (item.previewType === 'video' && item.previewUrl) {
                    const video = document.createElement('video');
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'metadata';
                    video.src = item.previewUrl;
                    preview.appendChild(video);
                } else if (item.previewType === 'font') {
                    const sample = document.createElement('span');
                    sample.className = styles.fontSample;
                    sample.style.fontFamily = item.family;
                    sample.textContent = 'Aa';
                    preview.appendChild(sample);
                } else if (item.previewType === 'model') {
                    const canvas = document.createElement('canvas');
                    canvas.className = styles.modelCanvas;
                    canvas.height = 180;
                    canvas.width = 240;
                    preview.appendChild(canvas);
                    if (manager && typeof manager.renderModelPreview === 'function') {
                        const version = this.previewVersion_;
                        manager.renderModelPreview(item.model, canvas).then(renderer => {
                            if (version !== this.previewVersion_ || !canvas.isConnected) {
                                renderer.dispose();
                                return;
                            }
                            this.previewRenderers_.push(renderer);
                            preview.classList.add(styles.previewReady);
                        })
                            .catch(error => log.warn(error));
                    }
                } else {
                    preview.appendChild(createSvgIcon(
                        'M4 5h16v14H4zM4 15l4-4 3 3 2-2 7 7M16 9h.01',
                        styles.fallbackIcon
                    ));
                }
            };

            const handleGridKeyDown = event => {
                const currentIndex = renderedButtons.indexOf(document.activeElement);
                if (currentIndex < 0) return;
                let nextIndex = currentIndex;
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex++;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex--;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = renderedButtons.length - 1;
                if (nextIndex !== currentIndex) {
                    event.preventDefault();
                    renderedButtons[Math.max(0, Math.min(renderedButtons.length - 1, nextIndex))].focus();
                }
            };
            grid.addEventListener('keydown', handleGridKeyDown);

            const renderGrid = () => {
                this.disposePreviews_();
                grid.textContent = '';
                renderedButtons = [];
                const visibleItems = activeFilter === 'all' ?
                    items : items.filter(item => item.source === activeFilter);
                if (!visibleItems.length) {
                    const empty = document.createElement('div');
                    empty.className = styles.emptyState;
                    empty.textContent = 'No media yet. Import a file to add it here.';
                    grid.appendChild(empty);
                    return;
                }
                visibleItems.forEach(item => {
                    const selected = item.value === this.getValue();
                    const card = document.createElement('div');
                    card.className = `${styles.mediaItem}${selected ? ` ${styles.mediaItemSelected}` : ''}`;
                    const selectButton = document.createElement('button');
                    selectButton.className = styles.selectButton;
                    selectButton.type = 'button';
                    selectButton.setAttribute('aria-label', `${item.label}: ${item.name}`);
                    selectButton.setAttribute('aria-selected', String(selected));
                    selectButton.setAttribute('role', 'option');
                    selectButton.objectDrawValue_ = item.value;
                    const preview = document.createElement('span');
                    preview.className = `${styles.mediaPreview} ${styles[`preview${item.source}`] || ''}`;
                    renderPreview(item, preview);
                    const meta = document.createElement('span');
                    meta.className = styles.mediaMeta;
                    const name = document.createElement('span');
                    name.className = styles.mediaName;
                    name.textContent = item.name;
                    selectButton.objectDrawNameElement_ = name;
                    const type = document.createElement('span');
                    type.className = styles.mediaType;
                    type.textContent = item.label;
                    meta.appendChild(name);
                    meta.appendChild(type);
                    selectButton.appendChild(preview);
                    selectButton.appendChild(meta);
                    if (selected) {
                        const check = document.createElement('span');
                        check.className = styles.selectedCheck;
                        check.appendChild(createSvgIcon('m5 12 4 4L19 6', styles.checkIcon));
                        selectButton.appendChild(check);
                        selectButton.objectDrawSelectedCheck_ = check;
                    }
                    selectButton.addEventListener('click', () => {
                        selectItem(item);
                        syncRenderedSelection();
                        selectButton.focus();
                    });
                    card.appendChild(selectButton);
                    if (item.deletable) {
                        const deleteButton = document.createElement('button');
                        deleteButton.className = styles.deleteButton;
                        deleteButton.type = 'button';
                        deleteButton.title = `Delete ${item.name}`;
                        deleteButton.setAttribute('aria-label', `Delete ${item.label}: ${item.name}`);
                        deleteButton.appendChild(createSvgIcon(
                            'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5',
                            styles.deleteIcon
                        ));
                        deleteButton.addEventListener('click', event => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (selected) {
                                const fallback = items.find(candidate => candidate.value !== item.value &&
                                    candidate.source === item.source) ||
                                    items.find(candidate => candidate.value !== item.value);
                                if (fallback) {
                                    const selection = decodeDrawAsset(fallback.value, fallback.source);
                                    persistDrawAsset(
                                        vm,
                                        getLiveBlock(this.sourceBlock_),
                                        selection.source,
                                        selection.asset
                                    );
                                }
                            }
                            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                            deleteAsset(vm, item);
                        });
                        card.appendChild(deleteButton);
                    }
                    grid.appendChild(card);
                    renderedButtons.push(selectButton);
                });
            };

            filterOptions.forEach(filter => {
                const button = document.createElement('button');
                button.className = styles.filterButton;
                button.type = 'button';
                button.textContent = filter.label;
                button.setAttribute('aria-pressed', String(filter.value === activeFilter));
                if (filter.value === activeFilter) {
                    button.classList.add(styles.filterButtonActive);
                    activeFilterButton = button;
                }
                button.addEventListener('click', () => {
                    activeFilter = filter.value;
                    if (activeFilterButton) {
                        activeFilterButton.classList.remove(styles.filterButtonActive);
                        activeFilterButton.setAttribute('aria-pressed', 'false');
                    }
                    activeFilterButton = button;
                    button.classList.add(styles.filterButtonActive);
                    button.setAttribute('aria-pressed', 'true');
                    renderGrid();
                    if (renderedButtons[0]) renderedButtons[0].focus();
                });
                filterBar.appendChild(button);
            });

            picker.addEventListener('keydown', event => {
                if (event.key === 'Escape') ScratchBlocks.DropDownDiv.hide();
            });
            picker.addEventListener('paste', event => {
                const files = getClipboardFiles(event.clipboardData);
                if (!files.length) return;
                event.preventDefault();
                event.stopPropagation();
                ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                openImportPicker(vm, getLiveBlock(this.sourceBlock_), ScratchBlocks, files);
            });
            let fileDragDepth = 0;
            const showDropOverlay = show => {
                picker.classList.toggle(styles.mediaPickerDragging, show);
                dropOverlay.setAttribute('aria-hidden', String(!show));
            };
            picker.addEventListener('dragenter', event => {
                if (!hasFileTransfer(event.dataTransfer)) return;
                event.preventDefault();
                fileDragDepth++;
                showDropOverlay(true);
            });
            picker.addEventListener('dragover', event => {
                if (!hasFileTransfer(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                fileDragDepth = Math.max(1, fileDragDepth);
                showDropOverlay(true);
            });
            picker.addEventListener('dragleave', () => {
                if (fileDragDepth === 0) return;
                fileDragDepth = Math.max(0, fileDragDepth - 1);
                if (fileDragDepth === 0) showDropOverlay(false);
            });
            picker.addEventListener('drop', event => {
                const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
                if (!hasFileTransfer(event.dataTransfer) && !files.length) return;
                event.preventDefault();
                event.stopPropagation();
                fileDragDepth = 0;
                showDropOverlay(false);
                if (!files.length) return;
                ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                openImportPicker(vm, getLiveBlock(this.sourceBlock_), ScratchBlocks, files);
            });
            renderGrid();
            updateEditAvailability();

            ScratchBlocks.DropDownDiv.setColour('var(--ui-modal-background)', 'var(--ui-black-transparent)');
            ScratchBlocks.DropDownDiv.setCategory(this.sourceBlock_.getCategory());
            ScratchBlocks.DropDownDiv.setBoundsElement(boundsElement);
            ScratchBlocks.DropDownDiv.showPositionedByBlock(this, this.sourceBlock_, this.onHide.bind(this));
            this.outsideCloseListener_ = event => {
                if (activeView !== 'editor' && !picker.contains(event.target)) ScratchBlocks.DropDownDiv.hide();
            };
            document.addEventListener('pointerdown', this.outsideCloseListener_, true);

            const selectedButton = renderedButtons.find(button => button.getAttribute('aria-selected') === 'true');
            (selectedButton || renderedButtons[0] || importButton).focus();
            if (!this.disableColourChange_ && this.box_) {
                this.box_.setAttribute('fill', this.sourceBlock_.getColourQuaternary());
            }
        }
    }
    return MediaField;
};

const makeObjectRowsRenderer = ScratchBlocks => function (iconWidth) {
    // This is the ScratchBlocks vertical renderer's row measurement specialized for one multi-row command block.
    // eslint-disable-next-line no-invalid-this
    const block = this;
    const inputRows = [];
    inputRows.rightEdge = 0;
    inputRows.bottomEdge = 0;
    let previousRow;

    for (const input of block.inputList) {
        if (!input.isVisible()) continue;
        let row;
        if (!inputRows.length || input.objectStartRow_) {
            row = block.createRowForInput_(input);
            inputRows.push(row);
        } else {
            row = inputRows[inputRows.length - 1];
        }
        row.push(input);
        input.renderHeight = block.computeInputHeight_(input, row, previousRow);
        input.renderWidth = block.computeInputWidth_(input);

        if (input.connection) {
            const linkedBlock = input.connection.targetBlock();
            let paddedHeight;
            let paddedWidth = 0;
            if (linkedBlock) {
                const bounds = linkedBlock.getHeightWidth();
                paddedHeight = bounds.height;
                paddedWidth = bounds.width;
            } else {
                paddedHeight = ScratchBlocks.BlockSvg.INPUT_SHAPE_HEIGHT;
            }
            if (input.connection.type === ScratchBlocks.INPUT_VALUE) {
                paddedHeight += 2 * ScratchBlocks.BlockSvg.INLINE_PADDING_Y;
            }
            input.renderHeight = Math.max(input.renderHeight, paddedHeight);
            input.renderWidth = Math.max(input.renderWidth, paddedWidth);
        }

        row.height = Math.max(row.height, input.renderHeight);
        input.fieldWidth = 0;
        let previousFieldEditable = false;
        for (let index = 0; index < input.fieldRow.length; index++) {
            const field = input.fieldRow[index];
            if (index !== 0) input.fieldWidth += ScratchBlocks.BlockSvg.SEP_SPACE_X;
            const fieldSize = field.getSize();
            field.renderWidth = fieldSize.width;
            field.renderSep = previousFieldEditable && field.EDITABLE ? ScratchBlocks.BlockSvg.SEP_SPACE_X : 0;
            input.fieldWidth += field.renderWidth + field.renderSep;
            row.height = Math.max(row.height, fieldSize.height);
            previousFieldEditable = field.EDITABLE;
        }
        previousRow = row;
    }

    for (let rowIndex = 0; rowIndex < inputRows.length; rowIndex++) {
        const row = inputRows[rowIndex];
        let cursorX = row.paddingStart + (rowIndex === 0 ? (block.RTL ? -iconWidth : iconWidth) : 0);
        for (const input of row) {
            cursorX += input.fieldWidth;
            if (input.type === ScratchBlocks.INPUT_VALUE) {
                if (block.previousConnection) {
                    cursorX = Math.max(cursorX, ScratchBlocks.BlockSvg.INPUT_AND_FIELD_MIN_X);
                }
                cursorX += input.renderWidth + ScratchBlocks.BlockSvg.SEP_SPACE_X;
            }
        }
        cursorX -= ScratchBlocks.BlockSvg.SEP_SPACE_X;
        inputRows.rightEdge = Math.max(inputRows.rightEdge, cursorX + row.paddingEnd);
        inputRows.bottomEdge += row.height;
    }

    inputRows.statementEdge = ScratchBlocks.BlockSvg.STATEMENT_INPUT_EDGE_WIDTH;
    inputRows.rightEdge = block.computeRightEdge_(inputRows.rightEdge, false);
    inputRows.hasValue = false;
    inputRows.hasStatement = false;
    inputRows.hasDummy = false;
    return inputRows;
};

const makeObjectRightEdgeRenderer = ScratchBlocks => function (steps, inputRows, iconWidth) {
    // eslint-disable-next-line no-invalid-this
    const block = this;
    let cursorY = 0;
    for (let rowIndex = 0; rowIndex < inputRows.length; rowIndex++) {
        const row = inputRows[rowIndex];
        let cursorX = row.paddingStart + (rowIndex === 0 ? (block.RTL ? -iconWidth : iconWidth) : 0);
        for (const input of row) {
            const fieldY = cursorY + (row.height / 2);
            const fieldX = ScratchBlocks.BlockSvg.getAlignedCursor_(cursorX, input, inputRows.rightEdge);
            cursorX = block.renderFields_(input.fieldRow, fieldX, fieldY);
            if (input.type === ScratchBlocks.INPUT_VALUE) {
                if (block.previousConnection) {
                    cursorX = Math.max(cursorX, ScratchBlocks.BlockSvg.INPUT_AND_FIELD_MIN_X);
                }
                const connectionX = block.RTL ? -cursorX : cursorX;
                const connectionY = cursorY + (row.height / 2);
                input.connection.setOffsetInBlock(connectionX, connectionY);
                block.renderInputShape_(input, cursorX, connectionY);
                cursorX += input.renderWidth + ScratchBlocks.BlockSvg.SEP_SPACE_X;
            }
        }
        cursorY += row.height;
    }

    block.width = Math.max(block.width, inputRows.rightEdge);
    steps.push('H', inputRows.rightEdge - ScratchBlocks.BlockSvg.CORNER_RADIUS);
    steps.push(ScratchBlocks.BlockSvg.TOP_RIGHT_CORNER);
    steps.push('v', cursorY - (2 * ScratchBlocks.BlockSvg.CORNER_RADIUS));
    return cursorY;
};

const installObjectBlockDefinitions = (ScratchBlocks, vm) => {
    ScratchBlocks.Blocks.objects_draw = {
        init: function () {
            const assetOptions = function () {
                // ScratchBlocks binds dropdown callbacks to the field instance.
                // eslint-disable-next-line no-invalid-this
                return getAssetOptions(vm);
            };
            const assetValidator = function (value) {
                // ScratchBlocks binds dropdown callbacks to the field instance.
                // eslint-disable-next-line no-invalid-this
                const block = getFieldSourceBlock(this);
                if (value === IMPORT_VALUE) {
                    openImportPicker(vm, block, ScratchBlocks);
                    return (block && block.getFieldValue('ASSET')) || IMPORT_VALUE;
                }
                if (block) block.updateDrawSelection_(value);
                return value;
            };
            const MediaField = createMediaField(ScratchBlocks, vm, assetOptions, assetValidator);
            const videoModeValidator = function (value) {
                // ScratchBlocks binds dropdown callbacks to the field instance.
                // eslint-disable-next-line no-invalid-this
                const block = getFieldSourceBlock(this);
                const mode = normalizeVideoMode(value);
                if (block) {
                    block.objectDrawVideoMode_ = mode;
                    block.syncDrawOptionalInputs_();
                }
                return mode;
            };
            const SourceField = ScratchBlocks.FieldLabelSerializable || ScratchBlocks.FieldLabel;
            this.appendDummyInput('DRAW')
                .appendField('draw')
                .appendField(new MediaField(), 'ASSET');
            this.appendDummyInput('VIDEO_MODE_INPUT')
                .appendField(new ScratchBlocks.FieldDropdown([
                    ['sequence', 'sequence'],
                    ['video', 'video']
                ], videoModeValidator), 'VIDEO_MODE');
            this.appendDummyInput('LEGACY_SOURCE')
                .appendField(new SourceField('costume'), 'SOURCE');
            this.getInput('LEGACY_SOURCE').setVisible(false);
            this.appendValueInput('TEXT').appendField('text:');
            this.appendValueInput('FRAME').appendField('frame:');
            this.appendValueInput('SPEED').appendField('speed:');
            this.appendValueInput('VOLUME').appendField('volume:');
            const position = this.appendValueInput('PX').appendField('position x:');
            position.objectStartRow_ = true;
            this.appendValueInput('PY').appendField('y:');
            this.appendValueInput('PZ').appendField('z:');
            const rotation = this.appendValueInput('RX').appendField('rotation x:');
            rotation.objectStartRow_ = true;
            this.appendValueInput('RY').appendField('y:');
            this.appendValueInput('RZ').appendField('z:');
            const scale = this.appendValueInput('SX').appendField('scale x:');
            scale.objectStartRow_ = true;
            this.appendValueInput('SY').appendField('y:');
            this.appendValueInput('SZ').appendField('z:');
            const size = this.appendValueInput('SIZE').appendField('size:');
            size.objectStartRow_ = true;
            const width = this.appendValueInput('WIDTH').appendField('width:');
            width.objectStartRow_ = true;
            this.appendValueInput('HEIGHT').appendField('height:');
            const startTime = this.appendValueInput('T1').appendField('time:');
            startTime.objectStartRow_ = true;
            this.appendValueInput('T2').appendField('~');
            this.setInputsInline(true);
            this.setColour(PRIMARY, SECONDARY, TERTIARY);
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
            this.renderCompute_ = makeObjectRowsRenderer(ScratchBlocks);
            this.renderDrawRight_ = makeObjectRightEdgeRenderer(ScratchBlocks);
            this.setOnChange(function () {
                // ScratchBlocks binds onchange handlers to the block instance.
                // eslint-disable-next-line no-invalid-this
                const block = this;
                block.syncDrawOptionalInputs_();
                const value = block.getFieldValue('ASSET');
                if (value && value !== IMPORT_VALUE) {
                    const selection = decodeDrawAsset(
                        value,
                        block.getFieldValue('SOURCE') || block.objectDrawSource_ || 'costume'
                    );
                    const normalized = encodeDrawAsset(selection.source, selection.asset);
                    if (value !== normalized) block.getField('ASSET').setValue(normalized);
                }
            });
            this.objectDrawSource_ = this.getFieldValue('SOURCE') || 'costume';
            this.objectDrawVideoMode_ = normalizeVideoMode(this.getFieldValue('VIDEO_MODE'));
            this.updateDrawSelection_(this.getFieldValue('ASSET') || IMPORT_VALUE);
        },
        updateDrawSelection_: function (requestedValue) {
            const oldMutation = this.objectDrawSource_ && ScratchBlocks.Events.isEnabled() ?
                ScratchBlocks.Xml.domToText(this.mutationToDom()) : null;
            const selection = decodeDrawAsset(
                requestedValue === IMPORT_VALUE ? '' : requestedValue,
                this.getFieldValue('SOURCE') || this.objectDrawSource_ || 'costume'
            );
            this.objectDrawSource_ = selection.source;
            this.objectDrawAsset_ = selection.asset;
            const sourceField = this.getField('SOURCE');
            if (sourceField) sourceField.setValue(selection.source);
            this.syncDrawOptionalInputs_();
            if (oldMutation !== null && !this.objectRestoringDrawMutation_) {
                const newMutation = ScratchBlocks.Xml.domToText(this.mutationToDom());
                if (oldMutation !== newMutation) {
                    ScratchBlocks.Events.fire(new ScratchBlocks.Events.Change(
                        this, 'mutation', null, oldMutation, newMutation
                    ));
                }
            }
        },
        setDrawAsset_: function (source, asset) {
            this.updateDrawSelection_(encodeDrawAsset(source, asset));
            const assetField = this.getField('ASSET');
            if (assetField) {
                assetField.setValue(encodeDrawAsset(source, asset));
                if (typeof assetField.refreshDisplay_ === 'function') assetField.refreshDisplay_();
            }
            if (this.rendered) this.render();
        },
        syncDrawOptionalInputs_: function () {
            const syncVisibility = (inputName, visible) => {
                const input = this.getInput(inputName);
                if (!input) return;
                const renderList = input.setVisible(visible);
                if (!visible && input.connection) {
                    input.connection.hideAll();
                    const childBlock = input.connection.targetBlock();
                    if (childBlock && childBlock.getSvgRoot()) {
                        childBlock.getSvgRoot().style.display = 'none';
                        childBlock.rendered = false;
                    }
                } else if (visible && this.rendered) {
                    for (const block of renderList) block.render();
                }
            };
            const videoMode = normalizeVideoMode(
                this.getFieldValue('VIDEO_MODE') || this.objectDrawVideoMode_
            );
            this.objectDrawVideoMode_ = videoMode;
            const visibility = getDrawInputVisibility(
                vm,
                this.objectDrawSource_,
                this.objectDrawAsset_,
                videoMode
            );
            syncVisibility('TEXT', visibility.text);
            syncVisibility('VIDEO_MODE_INPUT', visibility.videoMode);
            syncVisibility('FRAME', visibility.frame);
            syncVisibility('SPEED', visibility.speed);
            syncVisibility('VOLUME', visibility.volume);
        },
        mutationToDom: function () {
            const mutation = document.createElement('mutation');
            const fieldSelection = decodeDrawAsset(
                this.getFieldValue('ASSET'),
                this.objectDrawSource_ || this.getFieldValue('SOURCE') || 'costume'
            );
            const selection = {
                asset: typeof this.objectDrawAsset_ === 'string' ? this.objectDrawAsset_ : fieldSelection.asset,
                source: this.objectDrawSource_ || fieldSelection.source
            };
            mutation.setAttribute('source', selection.source);
            mutation.setAttribute('asset', selection.asset);
            mutation.setAttribute('video-mode', normalizeVideoMode(
                this.getFieldValue('VIDEO_MODE') || this.objectDrawVideoMode_
            ));
            return mutation;
        },
        domToMutation: function (mutation) {
            const source = mutation.getAttribute('source') || 'costume';
            const asset = mutation.getAttribute('asset');
            const videoMode = mutation.getAttribute('video-mode');
            this.objectRestoringDrawMutation_ = true;
            this.objectDrawSource_ = source;
            if (videoMode !== null) this.objectDrawVideoMode_ = normalizeVideoMode(videoMode);
            const sourceField = this.getField('SOURCE');
            if (sourceField) sourceField.setValue(source);
            if (asset === null) {
                // Older projects only stored the source. Fields are restored after
                // the mutation, so do not let the temporary default ASSET value
                // change a text block back into a costume block here.
                this.syncDrawOptionalInputs_();
            } else {
                this.updateDrawSelection_(encodeDrawAsset(source, asset));
            }
            this.objectRestoringDrawMutation_ = false;
        }
    };

    ScratchBlocks.Blocks.objects_shape = {
        init: function () {
            const shapeOptions = SHAPE_TYPES.map(shape => [shape, shape]);
            this.appendDummyInput('SHAPE_INPUT')
                .appendField('shape')
                .appendField(
                    new ScratchBlocks.FieldDropdown(shapeOptions, value => normalizeShapeType(value)),
                    'SHAPE'
                );
            this.appendValueInput('N').appendField('n:');
            const position = this.appendValueInput('PX').appendField('position x:');
            position.objectStartRow_ = true;
            this.appendValueInput('PY').appendField('y:');
            this.appendValueInput('PZ').appendField('z:');
            const rotation = this.appendValueInput('RX').appendField('rotation x:');
            rotation.objectStartRow_ = true;
            this.appendValueInput('RY').appendField('y:');
            this.appendValueInput('RZ').appendField('z:');
            const scale = this.appendValueInput('SX').appendField('scale x:');
            scale.objectStartRow_ = true;
            this.appendValueInput('SY').appendField('y:');
            this.appendValueInput('SZ').appendField('z:');
            const radius = this.appendValueInput('INNER').appendField('radius:');
            radius.objectStartRow_ = true;
            this.appendValueInput('OUTER');
            const width = this.appendValueInput('WIDTH').appendField('width:');
            width.objectStartRow_ = true;
            this.appendValueInput('HEIGHT').appendField('height:');
            const startTime = this.appendValueInput('T1').appendField('time:');
            startTime.objectStartRow_ = true;
            this.appendValueInput('T2').appendField('~');
            const color = this.appendValueInput('COLOR').appendField('color:');
            color.objectStartRow_ = true;
            this.appendValueInput('OPACITY')
                .appendField('opacity:')
                .appendField('%');
            this.setInputsInline(true);
            this.setColour(PRIMARY, SECONDARY, TERTIARY);
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
            this.renderCompute_ = makeObjectRowsRenderer(ScratchBlocks);
            this.renderDrawRight_ = makeObjectRightEdgeRenderer(ScratchBlocks);
            this.setOnChange(function () {
                // ScratchBlocks binds onchange handlers to the block instance.
                // eslint-disable-next-line no-invalid-this
                const block = this;
                const field = block.getField('SHAPE');
                if (field) {
                    const value = normalizeShapeType(block.getFieldValue('SHAPE'));
                    if (value !== block.getFieldValue('SHAPE')) field.setValue(value);
                }
            });
        }
    };

    /* eslint-disable no-invalid-this */
    const installProceduralShapeBlock = (opcode, setup) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                setup.call(this);
                this.setInputsInline(true);
                this.setColour(PRIMARY, SECONDARY, TERTIARY);
                this.setPreviousStatement(true);
                this.setNextStatement(true);
                this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
                this.renderCompute_ = makeObjectRowsRenderer(ScratchBlocks);
                this.renderDrawRight_ = makeObjectRightEdgeRenderer(ScratchBlocks);
            }
        };
    };

    const addTransformInputs = block => {
        const position = block.appendValueInput('PX').appendField('position x:');
        position.objectStartRow_ = true;
        block.appendValueInput('PY').appendField('y:');
        block.appendValueInput('PZ').appendField('z:');
        const rotation = block.appendValueInput('RX').appendField('rotation x:');
        rotation.objectStartRow_ = true;
        block.appendValueInput('RY').appendField('y:');
        block.appendValueInput('RZ').appendField('z:');
        const scale = block.appendValueInput('SX').appendField('scale x:');
        scale.objectStartRow_ = true;
        block.appendValueInput('SY').appendField('y:');
        block.appendValueInput('SZ').appendField('z:');
    };

    const addShapeAppearanceInputs = block => {
        const time = block.appendValueInput('T1').appendField('time:');
        time.objectStartRow_ = true;
        block.appendValueInput('T2').appendField('~');
        const color = block.appendValueInput('COLOR').appendField('color:');
        color.objectStartRow_ = true;
        block.appendValueInput('OPACITY')
            .appendField('opacity:')
            .appendField('%');
    };

    installProceduralShapeBlock('objects_arc', function () {
        this.appendDummyInput('ARC_INPUT').appendField('arc');
        addTransformInputs(this);
        const radius = this.appendValueInput('INNER').appendField('radius:');
        radius.objectStartRow_ = true;
        this.appendValueInput('OUTER');
        const angle = this.appendValueInput('START').appendField('angle:');
        angle.objectStartRow_ = true;
        this.appendValueInput('END');
        const width = this.appendValueInput('WIDTH').appendField('width:');
        width.objectStartRow_ = true;
        this.appendValueInput('HEIGHT').appendField('height:');
        addShapeAppearanceInputs(this);
    });

    installProceduralShapeBlock('objects_circularSegment', function () {
        this.appendDummyInput('SEGMENT_INPUT').appendField('circular segment');
        addTransformInputs(this);
        this.appendValueInput('OUTER').appendField('size:');
        const angle = this.appendValueInput('START').appendField('angle:');
        angle.objectStartRow_ = true;
        this.appendValueInput('END');
        const width = this.appendValueInput('WIDTH').appendField('width:');
        width.objectStartRow_ = true;
        this.appendValueInput('HEIGHT').appendField('height:');
        addShapeAppearanceInputs(this);
    });

    installProceduralShapeBlock('objects_line', function () {
        this.appendDummyInput('LINE_INPUT').appendField('line');
        const position1 = this.appendValueInput('P1X').appendField('position1 x:');
        position1.objectStartRow_ = true;
        this.appendValueInput('P1Y').appendField('y:');
        this.appendValueInput('P1Z').appendField('z:');
        const position2 = this.appendValueInput('P2X').appendField('position2 x:');
        position2.objectStartRow_ = true;
        this.appendValueInput('P2Y').appendField('y:');
        this.appendValueInput('P2Z').appendField('z:');
        const thickness = this.appendValueInput('THICKNESS').appendField('thickness:');
        thickness.objectStartRow_ = true;
        addShapeAppearanceInputs(this);
    });
    /* eslint-enable no-invalid-this */

    ScratchBlocks.Blocks.objects_grouping = {
        init: function () {
            this.jsonInit({
                message0: 'grouping',
                message1: '%1',
                args1: [{type: 'input_statement', name: 'SUBSTACK'}],
                message2: 'effects',
                message3: '%1',
                args3: [{type: 'input_statement', name: 'SUBSTACK2'}],
                category: 'Objects',
                colour: PRIMARY,
                colourSecondary: SECONDARY,
                colourTertiary: TERTIARY,
                extensions: ['shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.objects_scene = {
        init: function () {
            this.jsonInit({
                message0: 'scene',
                message1: '%1',
                args1: [{type: 'input_statement', name: 'SUBSTACK'}],
                category: 'Objects',
                colour: PRIMARY,
                colourSecondary: SECONDARY,
                colourTertiary: TERTIARY,
                extensions: ['shape_statement']
            });
        }
    };

    installObjectCompositionBlockDefinitions(ScratchBlocks);
};

export {
    getFieldSourceBlock,
    getLiveBlock,
    IMPORT_VALUE,
    createMediaField,
    drawSelectionUsesFrame,
    getDrawInputVisibility,
    getAssetItems,
    getAssetOptions,
    modelHasFrames,
    normalizeVideoMode,
    deleteAsset,
    openImportPicker,
    persistDrawAsset
};
export default installObjectBlockDefinitions;
