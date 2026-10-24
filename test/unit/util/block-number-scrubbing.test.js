import installBlockNumberScrubbing from '../../../src/lib/block-number-scrubbing';

const makeScratchBlocks = () => {
    const FieldNumber = function () {};
    const FieldAngle = function () {};
    const FieldNumberDropdown = function () {};
    const FieldTextInput = function () {};

    [FieldNumber, FieldAngle, FieldNumberDropdown, FieldTextInput].forEach(FieldClass => {
        FieldClass.prototype.widgetDispose_ = function () {
            return () => {
                if (typeof this.editedValue_ !== 'undefined') this.setValue(this.editedValue_);
            };
        };
    });

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

    return {Events, FieldAngle, FieldNumber, FieldNumberDropdown, FieldTextInput, Gesture};
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

const makeProcedureArgumentField = (ScratchBlocks, value = '10') => {
    const field = new ScratchBlocks.FieldTextInput();
    const procedureCall = {type: 'procedures_call'};
    field.sourceBlock_ = {
        type: 'text',
        isInFlyout: false,
        getParent: () => procedureCall
    };
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

    test('only changes a number while Shift is held and uses the fine drag rate', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeField(ScratchBlocks);
        const blockDragGesture = makeGesture(ScratchBlocks, field);

        blockDragGesture.handleMove({clientX: 5, clientY: 0, shiftKey: false});

        expect(blockDragGesture.usedOriginalDrag_).toBe(true);
        expect(blockDragGesture.movieNumberScrub_).toBeUndefined();
        expect(field.setValue).not.toHaveBeenCalled();
        expect(document.body.style.cursor).toBe('');

        const scrubGesture = makeGesture(ScratchBlocks, field);
        scrubGesture.handleMove({clientX: 5, clientY: 0, shiftKey: true});
        scrubGesture.handleMove({clientX: 15, clientY: 0, shiftKey: true});
        scrubGesture.handleMove({clientX: 25, clientY: 0, shiftKey: false});
        scrubGesture.handleMove({clientX: 35, clientY: 0, shiftKey: true});

        expect(field.setValue.mock.calls).toEqual([['10.5'], ['11.5'], ['12.5']]);
        expect(onChange).toHaveBeenCalledTimes(3);
        expect(document.body.style.cursor).toBe('ew-resize');

        scrubGesture.handleUp({clientX: 35, clientY: 0, shiftKey: true});
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

    test('scrubs numeric values in custom procedure arguments', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeProcedureArgumentField(ScratchBlocks);
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: 5, clientY: 0, shiftKey: true});
        gesture.handleMove({clientX: 15, clientY: 0, shiftKey: true});

        expect(field.setValue.mock.calls).toEqual([['10.5'], ['11.5']]);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    test('refreshes after directly editing a custom procedure argument', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeProcedureArgumentField(ScratchBlocks);
        const disposeEditor = field.widgetDispose_();

        field.editedValue_ = '25';
        disposeEditor();

        expect(field.getValue()).toBe('25');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('keeps positive-only fields at zero or above', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const field = makeField(ScratchBlocks, '2');
        field.negativeAllowed_ = false;
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: -50, clientY: 0, shiftKey: true});

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

    test('requests a preview after directly editing a numeric field', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const field = makeField(ScratchBlocks, '10');
        const disposeEditor = field.widgetDispose_();

        field.editedValue_ = '25';
        disposeEditor();

        expect(field.getValue()).toBe('25');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('does not request a preview after an unchanged or flyout direct edit', () => {
        const ScratchBlocks = makeScratchBlocks();
        const onChange = jest.fn();
        installBlockNumberScrubbing(ScratchBlocks, onChange);
        const unchangedField = makeField(ScratchBlocks, '10');
        const disposeUnchangedEditor = unchangedField.widgetDispose_();
        unchangedField.editedValue_ = '10';

        const flyoutField = makeField(ScratchBlocks, '10');
        flyoutField.sourceBlock_.isInFlyout = true;
        const disposeFlyoutEditor = flyoutField.widgetDispose_();
        flyoutField.editedValue_ = '25';

        disposeUnchangedEditor();
        disposeFlyoutEditor();

        expect(onChange).not.toHaveBeenCalled();
    });

    test('leaves vertical drags to the original block gesture', () => {
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const gesture = makeGesture(ScratchBlocks, makeField(ScratchBlocks));

        gesture.handleMove({clientX: 0, clientY: 5, shiftKey: true});

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
        dropdownGesture.handleMove({clientX: 5, clientY: 0, shiftKey: true});

        const flyoutField = makeField(ScratchBlocks);
        flyoutField.sourceBlock_.isInFlyout = true;
        const flyoutGesture = makeGesture(ScratchBlocks, flyoutField);
        flyoutGesture.handleMove({clientX: 5, clientY: 0, shiftKey: true});

        expect(dropdownGesture.usedOriginalDrag_).toBe(true);
        expect(flyoutGesture.usedOriginalDrag_).toBe(true);
    });

    test('locks the pointer and wraps its stand-in cursor around the window edges', () => {
        const listeners = {};
        const appended = [];
        const body = {
            style: {cursor: ''},
            requestPointerLock: jest.fn(),
            appendChild: element => {
                element.parentNode = body;
                appended.push(element);
            },
            removeChild: element => {
                appended.splice(appended.indexOf(element), 1);
            }
        };
        global.document = {
            body,
            pointerLockElement: null,
            addEventListener: (type, listener) => {
                listeners[type] = listener;
            },
            removeEventListener: jest.fn(type => {
                delete listeners[type];
            }),
            createElement: () => ({style: {}, setAttribute: jest.fn()}),
            exitPointerLock: jest.fn(() => {
                document.pointerLockElement = null;
            })
        };
        global.window = {innerWidth: 100, innerHeight: 50};
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const field = makeField(ScratchBlocks, '10');
        const gesture = makeGesture(ScratchBlocks, field);
        gesture.mouseDownXY_ = {x: 90, y: 20};

        gesture.handleMove({clientX: 95, clientY: 20, shiftKey: true});
        expect(body.requestPointerLock).toHaveBeenCalledTimes(1);
        expect(field.setValue).toHaveBeenLastCalledWith('10.5');

        document.pointerLockElement = body;
        listeners.pointerlockchange();
        expect(appended).toHaveLength(1);
        // The position no longer changes while locked; the first reported movement is ignored.
        gesture.handleMove({clientX: 95, clientY: 20, movementX: 400, movementY: 0, shiftKey: true});
        expect(field.setValue).toHaveBeenCalledTimes(1);

        // Moving 10px right from x=95 passes the right edge, so the cursor comes back in at the left.
        gesture.handleMove({clientX: 95, clientY: 20, movementX: 10, movementY: 0, shiftKey: true});
        expect(field.setValue).toHaveBeenLastCalledWith('11.5');
        expect(appended[0].style.transform).toBe('translate(5px, 20px) translate(-50%, -50%)');
        gesture.handleMove({clientX: 95, clientY: 20, movementX: -20, movementY: 0, shiftKey: true});
        expect(field.setValue).toHaveBeenLastCalledWith('9.5');
        expect(appended[0].style.transform).toBe('translate(85px, 20px) translate(-50%, -50%)');

        gesture.handleUp({clientX: 95, clientY: 20, movementX: 0, movementY: 0, shiftKey: true});
        expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
        expect(appended).toHaveLength(0);
        expect(listeners.pointerlockchange).toBeUndefined();
        expect(body.style.cursor).toBe('');
        delete global.window;
    });

    test('keeps scrubbing by position after the pointer lock ends', () => {
        const listeners = {};
        const body = {style: {cursor: ''}, requestPointerLock: jest.fn(), appendChild: jest.fn(), removeChild: jest.fn()};
        global.document = {
            body,
            pointerLockElement: null,
            addEventListener: (type, listener) => {
                listeners[type] = listener;
            },
            removeEventListener: jest.fn(),
            createElement: () => ({style: {}, setAttribute: jest.fn(), parentNode: body})
        };
        global.window = {innerWidth: 100, innerHeight: 50};
        const ScratchBlocks = makeScratchBlocks();
        installBlockNumberScrubbing(ScratchBlocks);
        const field = makeField(ScratchBlocks, '10');
        const gesture = makeGesture(ScratchBlocks, field);

        gesture.handleMove({clientX: 5, clientY: 0, shiftKey: true});
        document.pointerLockElement = body;
        listeners.pointerlockchange();
        document.pointerLockElement = null;
        listeners.pointerlockchange();
        // The first event after the lock ends only records the cursor position, so the value does not jump.
        gesture.handleMove({clientX: 60, clientY: 0, shiftKey: true});
        gesture.handleMove({clientX: 70, clientY: 0, shiftKey: true});

        expect(field.setValue.mock.calls).toEqual([['10.5'], ['11.5']]);
        delete global.window;
    });
});
