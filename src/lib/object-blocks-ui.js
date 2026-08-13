import {PRIMARY, SECONDARY, TERTIARY} from './object-blocks';

const SOURCE_OPTIONS = [
    ['costume', 'costume'],
    ['video', 'video'],
    ['text', 'text'],
    ['model', 'model']
];

const emptyMenu = () => [['', '']];

const getFieldSourceBlock = field => {
    if (field && typeof field.getSourceBlock === 'function') return field.getSourceBlock();
    return field && field.sourceBlock_;
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
    const menuForSource = source => {
        const target = vm.editingTarget;
        const manager = vm.runtime && vm.runtime.movieAssetManager;
        if (source === 'costume' && target && typeof target.getCostumes === 'function') {
            const costumes = target.getCostumes();
            return costumes.length ? costumes.map(costume => [costume.name, costume.name]) : emptyMenu();
        }
        if (source === 'video' && manager && target) {
            const videos = manager.getVideos(target);
            return videos.length ? videos.map(video => [video.name, video.name]) : emptyMenu();
        }
        if (source === 'model' && manager && target) {
            const models = manager.getModels(target);
            return models.length ? models.map(model => [model.name, model.name]) : emptyMenu();
        }
        if (source === 'text') {
            const defaults = [
                ['Sans Serif', 'sans-serif'],
                ['Serif', 'serif'],
                ['Monospace', 'monospace']
            ];
            const fontManager = vm.runtime && vm.runtime.fontManager;
            const fonts = fontManager ? fontManager.getFonts().map(font => [font.name, font.name]) : [];
            return defaults.concat(fonts);
        }
        return emptyMenu();
    };

    ScratchBlocks.Blocks.objects_draw = {
        init: function () {
            const assetOptions = function () {
                // ScratchBlocks binds dropdown callbacks to the field instance.
                // eslint-disable-next-line no-invalid-this
                const block = getFieldSourceBlock(this);
                return menuForSource(block ? block.objectDrawSource_ : 'costume');
            };
            const sourceValidator = function (value) {
                // ScratchBlocks binds dropdown callbacks to the field instance.
                // eslint-disable-next-line no-invalid-this
                const block = getFieldSourceBlock(this);
                if (block) block.updateDrawSource_(value);
                return value;
            };
            this.appendDummyInput('DRAW')
                .appendField('draw')
                .appendField(new ScratchBlocks.FieldDropdown(SOURCE_OPTIONS, sourceValidator), 'SOURCE')
                .appendField(new ScratchBlocks.FieldDropdown(assetOptions), 'ASSET');
            this.appendValueInput('TEXT').appendField('text:');
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
                this.syncDrawTextVisibility_();
            });
            this.updateDrawSource_(this.getFieldValue('SOURCE'));
        },
        syncDrawTextVisibility_: function () {
            const textInput = this.getInput('TEXT');
            if (!textInput) return;
            const visible = this.objectDrawSource_ === 'text';
            const renderList = textInput.setVisible(visible);
            if (!visible && textInput.connection) {
                textInput.connection.hideAll();
                const textBlock = textInput.connection.targetBlock();
                if (textBlock && textBlock.getSvgRoot()) {
                    textBlock.getSvgRoot().style.display = 'none';
                    textBlock.rendered = false;
                }
            } else if (visible && this.rendered) {
                for (const block of renderList) block.render();
            }
        },
        updateDrawSource_: function (requestedSource) {
            const source = String(requestedSource || 'costume');
            this.objectDrawSource_ = source;
            this.syncDrawTextVisibility_();
            const assetField = this.getField('ASSET');
            if (assetField) {
                const options = menuForSource(source);
                const values = options.map(option => option[1]);
                if (!values.includes(assetField.getValue())) assetField.setValue(values[0]);
            }
            if (this.rendered) this.render();
        },
        mutationToDom: function () {
            const mutation = document.createElement('mutation');
            mutation.setAttribute('source', this.getFieldValue('SOURCE') || 'costume');
            return mutation;
        },
        domToMutation: function (mutation) {
            this.updateDrawSource_(mutation.getAttribute('source') || 'costume');
        }
    };

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
};

export {getFieldSourceBlock};
export default installObjectBlockDefinitions;
