import {beginTimelineTimeInput} from './timeline-time-input';

// Inputs that hold a time on the main timeline, in seconds. A function picks the inputs from the block's fields.
const LOCAL_TIME_INPUTS = {
    offset: ['A'],
    freeze: ['A'],
    speed: ['B'],
    loop: ['B']
};

const TIME_RANGE = ['T1', 'T2'];

const TIMELINE_TIME_INPUTS = {
    objects_draw: TIME_RANGE,
    objects_shape: TIME_RANGE,
    objects_arc: TIME_RANGE,
    objects_circularSegment: TIME_RANGE,
    objects_line: TIME_RANGE,
    objects_animate: TIME_RANGE,
    objects_timeWithin: TIME_RANGE,
    objects_interpolateColor: TIME_RANGE,
    objects_interpolateAngle: TIME_RANGE,
    objects_interpolateVector: TIME_RANGE,
    objects_pass: ['TIME'],
    objects_repeat: ['TIME'],
    objects_timeOffset: ['TIME'],
    objects_timeFreeze: ['TIME'],
    objects_timeRange: ['START', 'END'],
    objects_localTime: block => LOCAL_TIME_INPUTS[block.getFieldValue('MODE')] || [],
    sound_playattime: TIME_RANGE,
    operator_easing: ['T0', 'T1']
};

const VALUE_BLOCK_TYPES = ['math_number', 'math_positive_number', 'math_whole_number', 'math_integer', 'text'];

const getParentBlock = block => (typeof block.getParent === 'function' ? block.getParent() : block.parentBlock_);

// Extension and plugin blocks mark a time argument with `timelineTime: true` in their getInfo() arguments.
const isExtensionTimeArgument = (vm, opcode, inputName) => {
    const categories = vm && vm.runtime && Array.isArray(vm.runtime._blockInfo) ? vm.runtime._blockInfo : [];
    for (const category of categories) {
        const blocks = Array.isArray(category.blocks) ? category.blocks : [];
        const block = blocks.find(candidate => candidate.json && candidate.json.type === opcode);
        if (!block) continue;
        const argument = block.info && block.info.arguments && block.info.arguments[inputName];
        return Boolean(argument && argument.timelineTime === true);
    }
    return false;
};

/**
 * Whether an input of a block holds a time on the main timeline.
 * @param {object} block Scratch Blocks block that owns the input.
 * @param {string} inputName Input name.
 * @param {VirtualMachine} [vm] The VM, for extension and plugin blocks.
 * @returns {boolean} True for a timeline time.
 */
const isTimelineTimeInput = (block, inputName, vm) => {
    const inputs = TIMELINE_TIME_INPUTS[block.type];
    if (inputs) return (typeof inputs === 'function' ? inputs(block) : inputs).indexOf(inputName) >= 0;
    return isExtensionTimeArgument(vm, block.type, inputName);
};

// The field is the value of a number or text reporter plugged into a timeline time input.
const isTimeField = (field, vm) => {
    const block = field.sourceBlock_;
    if (!block || block.isInFlyout || VALUE_BLOCK_TYPES.indexOf(block.type) < 0) return false;
    const parent = getParentBlock(block);
    if (!parent || !Array.isArray(parent.inputList)) return false;
    const input = parent.inputList.find(candidate => (
        candidate.connection && candidate.connection.targetBlock() === block
    ));
    return Boolean(input) && isTimelineTimeInput(parent, input.name, vm);
};

const startPreview = (ScratchBlocks, vm, field) => {
    const manager = vm.runtime && vm.runtime.movieAssetManager;
    const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
    const WidgetDiv = ScratchBlocks.WidgetDiv;
    if (!manager || !htmlInput || !WidgetDiv || WidgetDiv.owner_ !== field) return;

    const session = beginTimelineTimeInput(manager, {
        read: () => htmlInput.value,
        write: text => {
            if (ScratchBlocks.FieldTextInput.htmlInput_ !== htmlInput) return;
            htmlInput.value = text;
            // Update the block the same way typing does.
            field.onHtmlInputChange_({type: 'input'});
            if (typeof htmlInput.select === 'function') htmlInput.select();
        }
    });
    if (!session) return;

    const handleInput = () => session.preview(htmlInput.value);
    htmlInput.addEventListener('input', handleInput);
    const dispose = WidgetDiv.dispose_;
    // Enter, Escape, Tab and clicking elsewhere all close the editor; the edit is saved before the playhead returns.
    WidgetDiv.dispose_ = function (...args) {
        if (typeof dispose === 'function') dispose.apply(this, args);
        htmlInput.removeEventListener('input', handleInput);
        session.end();
    };
};

/**
 * Preview timeline time values on the main timeline while they are typed: opening the editor moves the playhead
 * to the value, typing moves it along, dragging the playhead writes its time into the value, and closing the
 * editor returns the playhead to where it was.
 * @param {object} ScratchBlocks Scratch Blocks namespace.
 * @param {VirtualMachine} vm The VM whose Movie asset manager owns the timeline.
 */
const installBlockTimeInputPreview = (ScratchBlocks, vm) => {
    ScratchBlocks.movieTimeInputPreviewVM_ = vm;
    if (ScratchBlocks.movieTimeInputPreviewInstalled_) return;
    ScratchBlocks.movieTimeInputPreviewInstalled_ = true;

    const fieldPrototype = ScratchBlocks.FieldTextInput.prototype;
    const originalShowEditor = fieldPrototype.showEditor_;
    fieldPrototype.showEditor_ = function (...args) {
        const result = originalShowEditor.apply(this, args);
        const currentVM = ScratchBlocks.movieTimeInputPreviewVM_;
        if (currentVM && isTimeField(this, currentVM)) startPreview(ScratchBlocks, currentVM, this);
        return result;
    };
};

export {
    TIMELINE_TIME_INPUTS,
    installBlockTimeInputPreview,
    isTimelineTimeInput
};
