const FINE_DRAG_RATE = 0.1;
const ROUNDING_FACTOR = 1e10;

const isFiniteNumber = value => Number.isFinite(Number(value));

const getParentBlock = block => {
    if (!block) return null;
    return typeof block.getParent === 'function' ? block.getParent() : block.parentBlock_;
};

const isProcedureArgumentField = (ScratchBlocks, field) => {
    if (!ScratchBlocks.FieldTextInput || !(field instanceof ScratchBlocks.FieldTextInput)) {
        return false;
    }

    const sourceBlock = field.sourceBlock_;
    const parentBlock = getParentBlock(sourceBlock);
    return sourceBlock &&
        sourceBlock.type === 'text' &&
        parentBlock &&
        parentBlock.type === 'procedures_call';
};

const isNumericField = (ScratchBlocks, field) => (
    field instanceof ScratchBlocks.FieldNumber ||
    field instanceof ScratchBlocks.FieldAngle ||
    field instanceof ScratchBlocks.FieldNumberDropdown ||
    isProcedureArgumentField(ScratchBlocks, field)
);

const canStartScrubbing = (ScratchBlocks, gesture) => {
    const field = gesture.startField_;
    const delta = gesture.currentDragDeltaXY_;
    return gesture.movieNumberScrubShiftKey_ &&
        field &&
        isNumericField(ScratchBlocks, field) &&
        field.isCurrentlyEditable() &&
        !field.useTouchInteraction_ &&
        !field.sourceBlock_.isInFlyout &&
        isFiniteNumber(field.getValue()) &&
        Math.abs(delta.x) >= Math.abs(delta.y);
};

const formatValue = (field, value) => {
    let rounded = value;
    if (Math.abs(rounded) < Number.MAX_SAFE_INTEGER / ROUNDING_FACTOR) {
        rounded = Math.round(rounded * ROUNDING_FACTOR) / ROUNDING_FACTOR;
    }
    if (field.decimalAllowed_ === false) {
        rounded = Math.round(rounded);
    }
    if (field.negativeAllowed_ === false) {
        rounded = Math.max(0, rounded);
    }
    return String(Object.is(rounded, -0) ? 0 : rounded);
};

const startScrubbing = (ScratchBlocks, gesture) => {
    const field = gesture.startField_;
    const ownsEventGroup = !ScratchBlocks.Events.getGroup();
    if (ownsEventGroup) ScratchBlocks.Events.setGroup(true);

    gesture.movieNumberScrub_ = {
        field,
        lastClientX: gesture.mouseDownXY_.x,
        ownsEventGroup,
        value: Number(field.getValue())
    };

    if (typeof document !== 'undefined' && document.body) {
        gesture.movieNumberScrub_.previousCursor = document.body.style.cursor;
        document.body.style.cursor = 'ew-resize';
    }
};

const updateScrubbing = (ScratchBlocks, gesture, event) => {
    const state = gesture.movieNumberScrub_;
    if (!state || typeof event.clientX !== 'number') return;

    const deltaX = event.clientX - state.lastClientX;
    state.lastClientX = event.clientX;
    if (!event.shiftKey || !deltaX) return;

    state.value += deltaX * FINE_DRAG_RATE;
    const previousValue = state.field.getValue();
    state.field.setValue(formatValue(state.field, state.value));
    if (
        state.field.getValue() !== previousValue &&
        typeof ScratchBlocks.movieNumberScrubChangeCallback_ === 'function'
    ) {
        ScratchBlocks.movieNumberScrubChangeCallback_();
    }
};

const stopScrubbing = (ScratchBlocks, gesture) => {
    const state = gesture.movieNumberScrub_;
    if (!state) return;

    if (typeof document !== 'undefined' && document.body) {
        document.body.style.cursor = state.previousCursor || '';
    }
    if (state.ownsEventGroup) ScratchBlocks.Events.setGroup(false);
    gesture.movieNumberScrub_ = null;
};

const installDirectInputChangeCallback = (ScratchBlocks, FieldClass, isSupportedField = () => true) => {
    const fieldPrototype = FieldClass.prototype;
    const originalWidgetDispose = fieldPrototype.widgetDispose_;

    fieldPrototype.widgetDispose_ = function () {
        const field = this;
        const originalValue = field.getValue();
        const dispose = originalWidgetDispose.call(field);

        return function () {
            dispose();
            if (
                isSupportedField(field) &&
                field.sourceBlock_ &&
                !field.sourceBlock_.isInFlyout &&
                field.getValue() !== originalValue &&
                typeof ScratchBlocks.movieNumberScrubChangeCallback_ === 'function'
            ) {
                ScratchBlocks.movieNumberScrubChangeCallback_();
            }
        };
    };
};

/**
 * Add horizontal scrubbing to every numeric Scratch Blocks field.
 * Holding Shift while dragging horizontally changes the value by 0.1 per pixel.
 * Without Shift, or when dragging vertically, the regular block gesture is used.
 * @param {object} ScratchBlocks Scratch Blocks namespace.
 * @param {Function} onChange Called after a drag or direct edit changes the field value.
 */
const installBlockNumberScrubbing = (ScratchBlocks, onChange) => {
    ScratchBlocks.movieNumberScrubChangeCallback_ = onChange;
    if (ScratchBlocks.movieNumberScrubbingInstalled_) return;
    ScratchBlocks.movieNumberScrubbingInstalled_ = true;

    installDirectInputChangeCallback(ScratchBlocks, ScratchBlocks.FieldNumber);
    installDirectInputChangeCallback(ScratchBlocks, ScratchBlocks.FieldAngle);
    installDirectInputChangeCallback(ScratchBlocks, ScratchBlocks.FieldNumberDropdown);
    if (ScratchBlocks.FieldTextInput) {
        installDirectInputChangeCallback(
            ScratchBlocks,
            ScratchBlocks.FieldTextInput,
            field => isProcedureArgumentField(ScratchBlocks, field)
        );
    }

    const gesturePrototype = ScratchBlocks.Gesture.prototype;
    const originalUpdateIsDragging = gesturePrototype.updateIsDragging_;
    const originalHandleMove = gesturePrototype.handleMove;
    const originalHandleUp = gesturePrototype.handleUp;
    const originalDispose = gesturePrototype.dispose;

    gesturePrototype.updateIsDragging_ = function () {
        if (canStartScrubbing(ScratchBlocks, this)) {
            this.calledUpdateIsDragging_ = true;
            startScrubbing(ScratchBlocks, this);
            return;
        }
        originalUpdateIsDragging.call(this);
    };

    gesturePrototype.handleMove = function (event) {
        this.movieNumberScrubShiftKey_ = Boolean(event.shiftKey);
        originalHandleMove.call(this, event);
        updateScrubbing(ScratchBlocks, this, event);
    };

    gesturePrototype.handleUp = function (event) {
        this.movieNumberScrubShiftKey_ = Boolean(event.shiftKey);
        updateScrubbing(ScratchBlocks, this, event);
        originalHandleUp.call(this, event);
    };

    gesturePrototype.dispose = function () {
        stopScrubbing(ScratchBlocks, this);
        delete this.movieNumberScrubShiftKey_;
        originalDispose.call(this);
    };
};

export default installBlockNumberScrubbing;
