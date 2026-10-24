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

// While scrubbing, Pointer Lock hides the real cursor so a drag never stops at the edge of the screen. A stand-in
// cursor follows the mouse and wraps around: past the left edge it comes back from the right, and the other way.
const VIRTUAL_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16">' +
    '<path d="M1 8l6-6v4h10V2l6 6-6 6v-4H7v4z" fill="#fff" stroke="#000" stroke-width="1.2" ' +
    'stroke-linejoin="round"/></svg>';

const canLockPointer = () => typeof document !== 'undefined' && document.body &&
    typeof document.body.requestPointerLock === 'function' &&
    typeof document.addEventListener === 'function' &&
    typeof document.createElement === 'function' &&
    typeof window !== 'undefined';

const wrap = (value, size) => (size > 0 ? ((value % size) + size) % size : value);

const placeVirtualCursor = state => {
    if (!state.cursorElement) return;
    state.cursorElement.style.transform = `translate(${state.cursorX}px, ${state.cursorY}px) translate(-50%, -50%)`;
};

const showVirtualCursor = state => {
    if (state.cursorElement) return;
    const element = document.createElement('div');
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = VIRTUAL_CURSOR_SVG;
    Object.assign(element.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '24px',
        height: '16px',
        pointerEvents: 'none',
        zIndex: '2147483647'
    });
    document.body.appendChild(element);
    state.cursorElement = element;
    placeVirtualCursor(state);
};

const hideVirtualCursor = state => {
    if (state.cursorElement && state.cursorElement.parentNode) {
        state.cursorElement.parentNode.removeChild(state.cursorElement);
    }
    state.cursorElement = null;
};

const lockPointer = state => {
    if (!canLockPointer()) return;
    const target = document.body;
    state.onPointerLockChange = () => {
        const locked = document.pointerLockElement === target;
        if (locked === state.locked) return;
        state.locked = locked;
        if (locked) {
            // Some browsers report one large movement right after locking.
            state.skipMovement = true;
            showVirtualCursor(state);
        } else {
            // Escape ends the lock; the real cursor shows again and drives the value by its position.
            state.lastClientX = null;
            hideVirtualCursor(state);
        }
    };
    document.addEventListener('pointerlockchange', state.onPointerLockChange);
    try {
        const request = target.requestPointerLock();
        if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch (error) {
        // Without the lock the drag still works; it just stops at the edge of the screen.
    }
};

const unlockPointer = state => {
    if (state.onPointerLockChange) {
        document.removeEventListener('pointerlockchange', state.onPointerLockChange);
        if (document.pointerLockElement === document.body && typeof document.exitPointerLock === 'function') {
            document.exitPointerLock();
        }
    }
    hideVirtualCursor(state);
};

const startScrubbing = (ScratchBlocks, gesture) => {
    const field = gesture.startField_;
    const ownsEventGroup = !ScratchBlocks.Events.getGroup();
    if (ownsEventGroup) ScratchBlocks.Events.setGroup(true);

    gesture.movieNumberScrub_ = {
        field,
        lastClientX: gesture.mouseDownXY_.x,
        cursorX: gesture.mouseDownXY_.x,
        cursorY: gesture.mouseDownXY_.y,
        locked: false,
        skipMovement: false,
        cursorElement: null,
        onPointerLockChange: null,
        ownsEventGroup,
        value: Number(field.getValue())
    };

    if (typeof document !== 'undefined' && document.body) {
        gesture.movieNumberScrub_.previousCursor = document.body.style.cursor;
        document.body.style.cursor = 'ew-resize';
    }
    lockPointer(gesture.movieNumberScrub_);
};

// Horizontal movement since the previous event: the locked pointer's movement, else the change in position.
const movementOf = (state, event) => {
    if (state.locked) {
        const movementX = Number(event.movementX) || 0;
        const movementY = Number(event.movementY) || 0;
        if (state.skipMovement) {
            state.skipMovement = false;
            return 0;
        }
        state.cursorX = wrap(state.cursorX + movementX, window.innerWidth);
        state.cursorY = Math.max(0, Math.min(window.innerHeight, state.cursorY + movementY));
        placeVirtualCursor(state);
        return movementX;
    }
    if (typeof event.clientX !== 'number') return 0;
    state.cursorX = event.clientX;
    if (typeof event.clientY === 'number') state.cursorY = event.clientY;
    const previous = state.lastClientX;
    state.lastClientX = event.clientX;
    return previous === null ? 0 : event.clientX - previous;
};

const updateScrubbing = (ScratchBlocks, gesture, event) => {
    const state = gesture.movieNumberScrub_;
    if (!state) return;

    const deltaX = movementOf(state, event);
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

    unlockPointer(state);
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
 * The pointer is locked while scrubbing, and its stand-in cursor wraps around the window edges.
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
