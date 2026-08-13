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
            this.setInputsInline(true);
            this.setColour(PRIMARY, SECONDARY, TERTIARY);
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
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

    const command = (message0, args0) => ({
        init: function () {
            this.jsonInit({
                message0,
                args0,
                inputsInline: true,
                category: 'Objects',
                colour: PRIMARY,
                colourSecondary: SECONDARY,
                colourTertiary: TERTIARY,
                extensions: ['shape_statement']
            });
        }
    });
    const numberInput = name => ({type: 'input_value', name});

    ScratchBlocks.Blocks.objects_position = command('position x: %1 y: %2 z: %3', [
        numberInput('X'), numberInput('Y'), numberInput('Z')
    ]);
    ScratchBlocks.Blocks.objects_rotation = command('rotation x: %1 y: %2 z: %3', [
        numberInput('X'), numberInput('Y'), numberInput('Z')
    ]);
    ScratchBlocks.Blocks.objects_scale = command('scale x: %1 y: %2 z: %3', [
        numberInput('X'), numberInput('Y'), numberInput('Z')
    ]);
    ScratchBlocks.Blocks.objects_size = command('size: %1', [numberInput('SIZE')]);
    ScratchBlocks.Blocks.objects_dimensions = command('width: %1 height: %2', [
        numberInput('WIDTH'), numberInput('HEIGHT')
    ]);

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
