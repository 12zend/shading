import EventEmitter from 'events';

import {installBlockTimeInputPreview, isTimelineTimeInput} from '../../../src/lib/block-time-input-preview';

const makeHtmlInput = () => {
    const listeners = {};
    return {
        value: '',
        addEventListener: (type, listener) => {
            listeners[type] = listener;
        },
        removeEventListener: (type, listener) => {
            if (listeners[type] === listener) delete listeners[type];
        },
        select: jest.fn(),
        type: function (text) {
            this.value = text;
            if (listeners.input) listeners.input({type: 'input'});
        }
    };
};

const makeScratchBlocks = () => {
    const ScratchBlocks = {};
    const WidgetDiv = {
        dispose_: null,
        owner_: null,
        hide: () => {
            if (WidgetDiv.dispose_) WidgetDiv.dispose_();
            WidgetDiv.dispose_ = null;
            WidgetDiv.owner_ = null;
        }
    };
    const FieldTextInput = function (text) {
        this.text_ = text;
    };
    FieldTextInput.prototype.showEditor_ = function () {
        WidgetDiv.hide();
        WidgetDiv.owner_ = this;
        const htmlInput = makeHtmlInput();
        htmlInput.value = this.text_;
        FieldTextInput.htmlInput_ = htmlInput;
        WidgetDiv.dispose_ = () => {
            this.text_ = FieldTextInput.htmlInput_.value;
        };
    };
    FieldTextInput.prototype.onHtmlInputChange_ = function () {
        this.text_ = FieldTextInput.htmlInput_.value;
    };
    return Object.assign(ScratchBlocks, {FieldTextInput, WidgetDiv});
};

const makeManager = () => {
    const manager = new EventEmitter();
    manager.timeline = {currentTime: 2, duration: 10, playing: false, recording: false};
    manager.getTimelineState = () => Object.assign({}, manager.timeline);
    manager.seekTimeline = jest.fn(seconds => {
        manager.timeline.currentTime = Math.round(Math.max(0, Math.min(10, seconds)) * 30) / 30;
        manager.emit('timelineChanged', manager.getTimelineState());
    });
    manager.pauseTimeline = jest.fn();
    manager.playTimeline = jest.fn();
    return manager;
};

// A number reporter plugged into `inputName` of a block of type `parentType`.
const plugField = (ScratchBlocks, parentType, inputName, text, fields = {}) => {
    const field = new ScratchBlocks.FieldTextInput(text);
    const shadow = {type: 'math_number', isInFlyout: false};
    const parent = {
        type: parentType,
        getFieldValue: name => fields[name],
        inputList: [
            {name: 'OTHER', connection: {targetBlock: () => null}},
            {name: inputName, connection: {targetBlock: () => shadow}}
        ]
    };
    shadow.getParent = () => parent;
    field.sourceBlock_ = shadow;
    return field;
};

describe('block time input preview', () => {
    let ScratchBlocks;
    let manager;
    let vm;

    beforeEach(() => {
        ScratchBlocks = makeScratchBlocks();
        manager = makeManager();
        vm = {runtime: {movieAssetManager: manager, _blockInfo: []}};
        installBlockTimeInputPreview(ScratchBlocks, vm);
    });

    test('previews a draw time range on the timeline and restores the playhead on commit', () => {
        const field = plugField(ScratchBlocks, 'objects_draw', 'T1', '4');

        field.showEditor_();
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(4);

        const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
        htmlInput.type('6.5');
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(6.5);

        // Dragging the timeline writes the playhead time into the block.
        manager.seekTimeline(3);
        expect(htmlInput.value).toBe('3');
        expect(field.text_).toBe('3');
        expect(htmlInput.select).toHaveBeenCalled();

        ScratchBlocks.WidgetDiv.hide();
        expect(field.text_).toBe('3');
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(2);
        expect(manager.listenerCount('timelineChanged')).toBe(0);

        // After the edit, timeline moves no longer touch the value.
        manager.seekTimeline(8);
        expect(field.text_).toBe('3');
    });

    test('leaves other number inputs alone', () => {
        const field = plugField(ScratchBlocks, 'objects_draw', 'SIZE', '4');

        field.showEditor_();
        manager.seekTimeline(3);
        ScratchBlocks.WidgetDiv.hide();

        expect(manager.seekTimeline).toHaveBeenCalledTimes(1);
        expect(field.text_).toBe('4');
    });

    test('ignores blocks in the flyout', () => {
        const field = plugField(ScratchBlocks, 'objects_timeWithin', 'T1', '4');
        field.sourceBlock_.isInFlyout = true;

        field.showEditor_();

        expect(manager.seekTimeline).not.toHaveBeenCalled();
    });

    test('knows the time inputs of core blocks, by mode where the block has one', () => {
        const block = (type, fields = {}) => ({type, getFieldValue: name => fields[name]});

        expect(isTimelineTimeInput(block('sound_playattime'), 'T2')).toBe(true);
        expect(isTimelineTimeInput(block('operator_easing'), 'T0')).toBe(true);
        expect(isTimelineTimeInput(block('operator_easing'), 'V0')).toBe(false);
        expect(isTimelineTimeInput(block('objects_pass'), 'TIME')).toBe(true);
        expect(isTimelineTimeInput(block('objects_localTime', {MODE: 'freeze'}), 'A')).toBe(true);
        expect(isTimelineTimeInput(block('objects_localTime', {MODE: 'loop'}), 'A')).toBe(false);
        expect(isTimelineTimeInput(block('objects_localTime', {MODE: 'loop'}), 'B')).toBe(true);
        expect(isTimelineTimeInput(block('objects_localTime', {MODE: 'posterize'}), 'A')).toBe(false);
        expect(isTimelineTimeInput(block('objects_echo'), 'INTERVAL')).toBe(false);
    });

    test('reads timelineTime from extension and plugin block arguments', () => {
        vm.runtime._blockInfo = [{
            id: 'simulation',
            blocks: [{
                info: {arguments: {NAME: {}, TIME: {type: 'string', timelineTime: true}}},
                json: {type: 'simulation_stateAt'}
            }]
        }];
        const field = plugField(ScratchBlocks, 'simulation_stateAt', 'TIME', '');
        field.sourceBlock_.type = 'text';

        expect(isTimelineTimeInput({type: 'simulation_stateAt'}, 'TIME', vm)).toBe(true);
        expect(isTimelineTimeInput({type: 'simulation_stateAt'}, 'NAME', vm)).toBe(false);

        // An empty time keeps the playhead, and dragging fills it in.
        field.showEditor_();
        expect(manager.seekTimeline).not.toHaveBeenCalled();
        manager.seekTimeline(1.5);
        expect(field.text_).toBe('1.5');
        ScratchBlocks.WidgetDiv.hide();
        expect(manager.seekTimeline).toHaveBeenLastCalledWith(2);
    });
});
