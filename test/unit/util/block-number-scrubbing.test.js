import installBlockNumberScrubbing from '../../../src/lib/block-number-scrubbing';

const makeScratchBlocks = () => {
    const FieldNumber = function () {};
    const FieldAngle = function () {};
    const FieldNumberDropdown = function () {};

    const Gesture = function () {};
    Gesture.prototype.updateIsDragging_ = function () {
        this.usedOriginalDrag_ = true;
        this.calledUpdateIsDragging_ = true;
    };
    Gesture.prototype.updateFromEvent_ = function (event) {
        const x = event.clientX - this.mouseDownXY_.x;
        const y = event.clientY - this.mouseDownXY_.y;
        this.currentDragDeltaXY_ = {x, y};
        if (!this.calledUpdateIsDragging_ && Math.sqrt((x * x) + (y * y)) > 3) {
            this.updateIsDragging_();
        }
    };
    Gesture.prototype.handleMove = function (event) {
        this.updateFromEvent_(event);
    };
    Gesture.prototype.handleUp = function (event) {
        this.updateFromEvent_(event);
        this.dispose();
    };
    Gesture.prototype.dispose = function () {
        this.disposed_ = true;
    };

    let eventGroup = false;
    const Events = {
        getGroup: jest.fn(() => eventGroup),
        setGroup: jest.fn(value => {
            eventGroup = value;
        })
    };

    return {Events, FieldAngle, FieldNumber, FieldNumberDropdown, Gesture};
};

const makeField = (ScratchBlocks, value = '10') => {
    const field = new ScratchBlocks.FieldNumber();
    field.sourceBlock_ = {isInFlyout: false};
    field.isCurrentlyEditable = () => true;
    field.getValue = () => value;
    field.setValue = jest.fn(newValue => {
        value = newValue;
    });
    return field;
};

const makeGesture = (ScratchBlocks, field) => {
    const gesture = new ScratchBlocks.Gesture();
    gesture.startField_ = field;
    gesture.mouseDownXY_ = {x: 0, y: 0};
    gesture.currentDragDeltaXY_ = {x: 0, y: 0};
    gesture.calledUpdateIsDragging_ = false;
    return gesture;
};

describe('block number scrubbing', () => {
    beforeEach(() => {
        global.document = {body: {style: {cursor: ''}}};
        document.body.style.cursor = '';
    });

    afterEach(() => {
        delete global.document;
    });

    test('changes a number horizontally and uses a tenth of the rate with Shift', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeField(ScratchBlocks);
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: 5, clientY: 0, shiftKey: false});
        gesture.handleMove({clientX: 15, clientY: 0, shiftKey: true});

        expect(field.setValue.mock.calls).toEqual([['15'], ['16']]);
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(document.body.style.cursor).toBe('ew-resize');

        gesture.handleUp({clientX: 15, clientY: 0, shiftKey: true});
        expect(ScratchBlocks.Events.setGroup.mock.calls).toEqual([[true], [false]]);
        expect(document.body.style.cursor).toBe('');
    });

    test('rounds values for fields that only accept integers', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const field = makeField(ScratchBlocks, '3');
        field.decimalAllowed_ = false;
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: 9, clientY: 0, shiftKey: true});

        expect(field.setValue).toHaveBeenLastCalledWith('4');
    });

    test('keeps positive-only fields at zero or above', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const field = makeField(ScratchBlocks, '2');
        field.negativeAllowed_ = false;
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: -5, clientY: 0, shiftKey: false});

        expect(field.setValue).toHaveBeenLastCalledWith('0');
    });

    test('does not request a preview when rounding keeps the value unchanged', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeField(ScratchBlocks, '3');
        field.decimalAllowed_ = false;
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: 4, clientY: 0, shiftKey: true});

        expect(field.setValue).toHaveBeenLastCalledWith('3');
        expect(onChange).not.toHaveBeenCalled();
    });

    test('leaves vertical drags to the original block gesture', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const gesture = makeGesture(ScratchBlocks, makeField(ScratchBlocks));

        gesture.handleMove({clientX: 0, clientY: 5, shiftKey: false});

        expect(gesture.usedOriginalDrag_).toBe(true);
        expect(gesture.movieNumberScrub_).toBeUndefined();
    });

    test('does not scrub non-numeric dropdown options or flyout fields', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);

        const dropdown = new ScratchBlocks.FieldNumberDropdown();
        dropdown.sourceBlock_ = {isInFlyout: false};
        dropdown.isCurrentlyEditable = () => true;
        dropdown.getValue = () => 'last';
        const dropdownGesture = makeGesture(ScratchBlocks, dropdown);
        dropdownGesture.handleMove({clientX: 5, clientY: 0, shiftKey: false});

        const flyoutField = makeField(ScratchBlocks);
        flyoutField.sourceBlock_.isInFlyout = true;
        const flyoutGesture = makeGesture(ScratchBlocks, flyoutField);
        flyoutGesture.handleMove({clientX: 5, clientY: 0, shiftKey: false});

        expect(dropdownGesture.usedOriginalDrag_).toBe(true);
        expect(flyoutGesture.usedOriginalDrag_).toBe(true);
    });
});
