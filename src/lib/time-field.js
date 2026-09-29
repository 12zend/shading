import {
    TIME_FIELD,
    TIME_RANGE_FIELD,
    TIME_RANGE_SHADOW_OPCODE,
    TIME_SHADOW_OPCODE,
    formatTimeRange,
    parseTimeRange
} from '../../scratch-vm/src/lib/time-range';

import {getWaveformPath, subscribeTimelineWaveform} from './timeline-waveform';
import styles from './time-field.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_DURATION = 10;

// The timeline lives inside the shadow block, right of the value, and is edited in place:
// drag the handles, wheel to scroll, Ctrl/⌘ + wheel (or pinch) to zoom. Clicking the value types it.
const INLINE_WIDTH = 216;
const INLINE_INFINITY_WIDTH = 15;
const INLINE_GAP = 8;
const INLINE_RIGHT_PADDING = 12;
const INLINE_HEIGHT = 30;
const LABEL_Y = 7.5;
const TRACK_Y = 9;
const TRACK_HEIGHT = 17;
const THUMB_Y = TRACK_Y + TRACK_HEIGHT + 2;
const MIN_SPAN = 0.5;
// Timelines up to this length open fully visible; longer ones open zoomed around the value.
const INITIAL_FIT_SECONDS = 30;
const INITIAL_MIN_SPAN = 10;
const SNAP_PIXELS = 4;
const EDGE_SCROLL_PIXELS = 6;

const MODE_SINGLE = 'single';
const MODE_RANGE = 'range';

// Animations interpolate between the two times, so an open end has no meaning there.
const FINITE_RANGE_OPCODES = new Set([
    'objects_animate',
    'objects_interpolateAngle',
    'objects_interpolateColor',
    'objects_interpolateVector'
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const svg = (tagName, attributes = {}, parent = null) => {
    const element = document.createElementNS(SVG_NS, tagName);
    for (const name of Object.keys(attributes)) element.setAttribute(name, attributes[name]);
    if (parent) parent.appendChild(element);
    return element;
};

const clearChildren = element => {
    while (element.firstChild) element.removeChild(element.firstChild);
};

const trimNumber = value => {
    const rounded = Math.round(value * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
};

const formatSeconds = value => {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '-∞';
    return trimNumber(value);
};

const parseSingleTime = text => {
    const range = parseTimeRange(String(text === null || typeof text === 'undefined' ? '' : text).split('~')[0]);
    return range.start;
};

const normalizeSingle = text => {
    const trimmed = String(text === null || typeof text === 'undefined' ? '' : text).trim();
    if (trimmed === '') return '0';
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed) && !/^[-+]?(∞|inf|infinity)$/i.test(trimmed)) {
        return null;
    }
    const value = parseSingleTime(trimmed);
    if (Number.isFinite(value)) return trimNumber(value);
    return value > 0 ? 'Infinity' : '-Infinity';
};

const normalizeRange = text => {
    const raw = String(text === null || typeof text === 'undefined' ? '' : text).trim();
    const parts = raw.split('~');
    if (parts.length > 2) return null;
    const isTime = part => {
        const trimmed = part.trim();
        return trimmed === '' ||
            /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed) ||
            /^[-+]?(∞|inf|infinity)$/i.test(trimmed);
    };
    if (!parts.every(isTime)) return null;
    const range = parseTimeRange(raw);
    const bound = value => (Number.isFinite(value) ? trimNumber(value) : value);
    return formatTimeRange(bound(range.start), bound(range.end));
};

const getTimeline = vm => {
    const manager = vm && vm.runtime && vm.runtime.movieAssetManager;
    const state = manager && typeof manager.getTimelineState === 'function' ?
        manager.getTimelineState() : null;
    const duration = state && Number(state.duration) > 0 ? Number(state.duration) : DEFAULT_DURATION;
    return {
        currentTime: state ? clamp(Number(state.currentTime) || 0, 0, duration) : 0,
        duration,
        keyframes: state && Array.isArray(state.keyframes) ?
            state.keyframes.filter(time => Number.isFinite(time) && time >= 0 && time <= duration) : []
    };
};

const getLabelStep = pixelsPerSecond => {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find(step => step * pixelsPerSecond >= 28) || steps[steps.length - 1];
};

const formatLabelTime = seconds => {
    if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remaining = Number((seconds - (minutes * 60)).toFixed(1));
        return `${minutes}:${remaining < 10 ? '0' : ''}${remaining}`;
    }
    return `${trimNumber(seconds)}s`;
};

const getDragStep = pixelsPerSecond => {
    if (pixelsPerSecond >= 150) return 0.01;
    if (pixelsPerSecond >= 40) return 0.05;
    if (pixelsPerSecond >= 15) return 0.1;
    if (pixelsPerSecond >= 4) return 0.5;
    return 1;
};

// Every live time field, so playhead, keyframe and duration changes redraw the timelines.
const liveFields = new Set();
let subscribedManager = null;
const handleTimelineChanged = () => {
    for (const field of liveFields) field.renderTimeline_();
};
let latestWaveform = null;
let waveformVm = null;
const subscribeToWaveform = vm => {
    if (!vm || waveformVm === vm) return;
    waveformVm = vm;
    subscribeTimelineWaveform(vm, waveform => {
        latestWaveform = waveform;
        for (const field of liveFields) field.renderTimeline_();
    });
};
const subscribeToTimeline = vm => {
    const manager = vm && vm.runtime && vm.runtime.movieAssetManager;
    if (!manager || manager === subscribedManager || typeof manager.on !== 'function') return;
    if (subscribedManager && typeof subscribedManager.removeListener === 'function') {
        subscribedManager.removeListener('timelineChanged', handleTimelineChanged);
    }
    subscribedManager = manager;
    manager.on('timelineChanged', handleTimelineChanged);
};

const createTimeFieldClass = (ScratchBlocks, vm, mode) => {
    const isRange = mode === MODE_RANGE;

    class TimeField extends ScratchBlocks.FieldTextInput {
        constructor (value) {
            const normalized = isRange ? normalizeRange(value) : normalizeSingle(value);
            super(normalized === null ? (isRange ? '0~Infinity' : '0') : normalized);
            this.addArgType('time');
            if (isRange) this.addArgType('timeRange');
            this.view_ = null;
        }

        static fromJson (options) {
            return new TimeField(options.value);
        }

        classValidator (text) {
            if (text === null) return null;
            return isRange ? normalizeRange(text) : normalizeSingle(text);
        }

        allowsInfinity_ () {
            if (!isRange) return false;
            const parentBlock = this.sourceBlock_ && this.sourceBlock_.getParent();
            return !(parentBlock && FINITE_RANGE_OPCODES.has(parentBlock.type));
        }

        getRange_ () {
            if (isRange) return parseTimeRange(this.getText());
            const time = parseSingleTime(this.getText());
            return {start: time, end: time};
        }

        getDisplayText_ () {
            const text = this.getText();
            if (this.classValidator(text) === null) return super.getDisplayText_();
            const range = this.getRange_();
            if (!isRange) return formatSeconds(range.start);
            return `${formatSeconds(range.start)} ~ ${formatSeconds(range.end)}`;
        }

        // ---- Layout ----

        trackWidth_ () {
            return this.allowsInfinity_() ? INLINE_WIDTH - INLINE_INFINITY_WIDTH : INLINE_WIDTH;
        }

        init () {
            if (this.fieldGroup_) return;
            super.init();
            liveFields.add(this);
            subscribeToTimeline(vm);
            subscribeToWaveform(vm);
            this.timelineGroup_ = svg('g', {class: styles.timeline}, this.fieldGroup_);
            this.timelineContent_ = svg('g', {}, this.timelineGroup_);
            // The hit area sits on top so every pointer event lands on the timeline group.
            svg('title', {}, svg('rect', {
                class: styles.hitArea,
                height: INLINE_HEIGHT + 4,
                width: INLINE_WIDTH + 4,
                x: -2,
                y: -2
            }, this.timelineGroup_)).textContent =
                'Drag to set the time · Wheel to scroll · Ctrl/⌘ + wheel or pinch to zoom · Shift to skip snapping';
            this.onPointerDown_ = event => this.handlePointerDown_(event);
            this.onWheel_ = event => this.handleWheel_(event);
            this.onBlockedEvent_ = event => {
                if (this.isInteractive_()) event.stopPropagation();
            };
            this.timelineGroup_.addEventListener('pointerdown', this.onPointerDown_);
            this.timelineGroup_.addEventListener('mousedown', this.onBlockedEvent_);
            this.timelineGroup_.addEventListener('touchstart', this.onBlockedEvent_, {passive: true});
            this.timelineGroup_.addEventListener('wheel', this.onWheel_, {passive: false});
            this.renderTimeline_();
            this.forceRerender();
        }

        dispose () {
            liveFields.delete(this);
            this.stopDrag_();
            this.timelineGroup_ = null;
            this.timelineContent_ = null;
            super.dispose();
        }

        // Called by Field.updateWidth: reserve room for the timeline right of the text.
        positionArrow (x) {
            if (!this.timelineGroup_) return 0;
            const padding = ScratchBlocks.BlockSvg.EDITABLE_FIELD_PADDING / 2;
            let left = x - padding + INLINE_GAP;
            // Keep the track still while dragging, even when the value text changes width.
            if (this.drag_) {
                this.frozenLeft_ = Math.max(this.frozenLeft_ || 0, left);
                left = this.frozenLeft_;
            }
            if (this.sourceBlock_ && this.sourceBlock_.RTL) left = INLINE_RIGHT_PADDING - padding;
            const top = ((this.size_.height - INLINE_HEIGHT) / 2) + ScratchBlocks.BlockSvg.FIELD_TOP_PADDING;
            this.timelineGroup_.setAttribute('transform', `translate(${left},${top})`);
            return (left - x) + INLINE_WIDTH + INLINE_RIGHT_PADDING;
        }

        setText (text) {
            super.setText(text);
            this.renderTimeline_();
        }

        // ---- View (zoom and scroll) ----

        getView_ (duration) {
            if (this.view_ && this.view_.duration === duration) return this.view_;
            const view = {duration, start: 0, span: duration};
            if (duration > INITIAL_FIT_SECONDS) {
                // Long movies: start zoomed around the value instead of squeezing minutes into a few pixels.
                const range = this.getRange_();
                const low = clamp(Math.min(range.start, range.end), 0, duration);
                const high = isRange && Number.isFinite(range.end) ?
                    clamp(Math.max(range.start, range.end), 0, duration) : low;
                view.span = clamp((high - low) * 1.5, INITIAL_MIN_SPAN, duration);
                view.start = clamp(((low + high) / 2) - (view.span / 2), 0, duration - view.span);
            }
            this.view_ = view;
            return view;
        }

        setView_ (start, span) {
            const {duration} = getTimeline(vm);
            const nextSpan = clamp(span, Math.min(MIN_SPAN, duration), duration);
            this.view_ = {duration, span: nextSpan, start: clamp(start, 0, duration - nextSpan)};
            this.renderTimeline_();
        }

        pixelsPerSecond_ () {
            return this.trackWidth_() / this.view_.span;
        }

        timeToX_ (time) {
            if (time === Infinity) {
                const trackWidth = this.trackWidth_();
                return this.allowsInfinity_() ? trackWidth + (INLINE_INFINITY_WIDTH / 2) + 1 : trackWidth;
            }
            return (time - this.view_.start) * this.pixelsPerSecond_();
        }

        // ---- Drawing ----

        renderTimeline_ () {
            const content = this.timelineContent_;
            if (!content) return;
            const parentBlock = this.sourceBlock_ && this.sourceBlock_.getParent();
            if (parentBlock) this.timelineGroup_.style.setProperty('--time-field-accent', parentBlock.getColour());
            const timeline = getTimeline(vm);
            const view = this.getView_(timeline.duration);
            const trackWidth = this.trackWidth_();
            const pixelsPerSecond = this.pixelsPerSecond_();
            const inView = x => x >= -0.5 && x <= trackWidth + 0.5;
            clearChildren(content);

            svg('rect', {
                class: styles.track,
                height: TRACK_HEIGHT,
                rx: 4,
                width: trackWidth,
                y: TRACK_Y
            }, content);
            const clipId = this.clipId_ || (this.clipId_ = `timeFieldClip${Math.random().toString(36)
                .slice(2)}`);
            const clip = svg('clipPath', {id: clipId}, content);
            svg('rect', {height: INLINE_HEIGHT, width: trackWidth, y: 0}, clip);
            const clipped = svg('g', {'clip-path': `url(#${clipId})`}, content);

            // Volume wave of the sound blocks, so timing can follow the audio.
            const wave = getWaveformPath(latestWaveform, {
                height: TRACK_HEIGHT - 2,
                pixelsPerSecond,
                start: view.start,
                step: 1,
                width: trackWidth,
                y: TRACK_Y + 1
            });
            if (wave) svg('path', {class: styles.waveform, d: wave}, clipped);

            // Time labels with a line per label and short ticks in between, like the main timeline.
            const labelStep = getLabelStep(pixelsPerSecond);
            const divisions = (labelStep / 5) * pixelsPerSecond >= 5 ? 5 : 2;
            const tickStep = labelStep / divisions;
            const firstTick = Math.ceil((view.start - 1e-9) / tickStep);
            for (let index = firstTick; index * tickStep <= view.start + view.span + 1e-9; index++) {
                const time = Number((index * tickStep).toFixed(6));
                const x = this.timeToX_(time);
                const major = index % divisions === 0;
                svg('line', {
                    class: major ? styles.tickMajor : styles.tick,
                    x1: x,
                    x2: x,
                    y1: major ? TRACK_Y - 1.5 : TRACK_Y,
                    y2: major ? TRACK_Y + TRACK_HEIGHT : TRACK_Y + 2.5
                }, clipped);
                if (major && x <= trackWidth - 10) {
                    svg('text', {
                        'class': styles.label,
                        'text-anchor': 'start',
                        'x': x + 1.5,
                        'y': LABEL_Y
                    }, content).textContent = formatLabelTime(time);
                }
            }

            const range = this.getRange_();
            const startX = this.timeToX_(range.start);
            const endX = this.timeToX_(range.end);
            if (isRange) {
                svg('rect', {
                    class: styles.selection,
                    height: TRACK_HEIGHT,
                    width: Math.abs(endX - startX),
                    x: Math.min(startX, endX),
                    y: TRACK_Y
                }, range.end === Infinity ? content : clipped);
            }
            for (const keyframe of timeline.keyframes) {
                const x = this.timeToX_(keyframe);
                if (!inView(x)) continue;
                svg('path', {
                    class: styles.keyframe,
                    d: `M ${x} ${TRACK_Y + TRACK_HEIGHT - 6} l 2.5 2.5 l -2.5 2.5 l -2.5 -2.5 z`
                }, clipped);
            }
            const playheadX = this.timeToX_(timeline.currentTime);
            if (inView(playheadX)) {
                svg('line', {
                    class: styles.playhead,
                    x1: playheadX,
                    x2: playheadX,
                    y1: TRACK_Y - 2,
                    y2: TRACK_Y + TRACK_HEIGHT + 1
                }, content);
            }

            if (this.allowsInfinity_()) {
                const infinity = svg('g', {
                    class: range.end === Infinity ? `${styles.infinity} ${styles.infinityActive}` : styles.infinity
                }, content);
                svg('rect', {
                    height: TRACK_HEIGHT,
                    rx: 4,
                    width: INLINE_INFINITY_WIDTH - 3,
                    x: trackWidth + 3,
                    y: TRACK_Y
                }, infinity);
                svg('text', {
                    'text-anchor': 'middle',
                    'x': trackWidth + 1.5 + (INLINE_INFINITY_WIDTH / 2),
                    'y': TRACK_Y + TRACK_HEIGHT - 5
                }, infinity).textContent = '∞';
            }

            // Handles scrolled out of view are hidden; the selection still shows where the range goes.
            const handle = x => {
                svg('rect', {
                    class: styles.handle,
                    height: TRACK_HEIGHT + 4,
                    rx: 1.25,
                    width: 2.5,
                    x: x - 1.25,
                    y: TRACK_Y - 2
                }, content);
                svg('rect', {
                    class: styles.handleGrip,
                    height: 7,
                    rx: 1.5,
                    width: 5,
                    x: x - 2.5,
                    y: TRACK_Y + (TRACK_HEIGHT / 2) - 3.5
                }, content);
            };
            if (range.start === Infinity || inView(startX)) handle(startX);
            if (isRange && (range.end === Infinity || inView(endX))) handle(endX);

            if (view.span < view.duration - 1e-9) {
                const thumbWidth = Math.max(8, trackWidth * (view.span / view.duration));
                const scrollable = view.duration - view.span;
                svg('rect', {
                    class: styles.scrollThumb,
                    height: 2,
                    rx: 1,
                    width: thumbWidth,
                    x: scrollable > 0 ? (trackWidth - thumbWidth) * (view.start / scrollable) : 0,
                    y: THUMB_Y
                }, content);
            }
        }

        // ---- Pointer input ----

        isInteractive_ () {
            const block = this.sourceBlock_;
            // In the palette the block must stay draggable, so the timeline only edits placed blocks.
            return Boolean(block && block.isEditable() && block.workspace && !block.workspace.isFlyout &&
                this.timelineGroup_);
        }

        clientXToLocalX_ (clientX) {
            const matrix = this.timelineGroup_.getScreenCTM();
            if (!matrix) return 0;
            return (clientX - matrix.e) / (matrix.a || 1);
        }

        localXToTime_ (x) {
            return this.view_.start + (x / this.pixelsPerSecond_());
        }

        eventToTime_ (event, allowInfinity, snap = !event.shiftKey) {
            const x = this.clientXToLocalX_(event.clientX);
            if (allowInfinity && x > this.trackWidth_() + 1) return Infinity;
            const {duration, currentTime, keyframes} = getTimeline(vm);
            let time = clamp(this.localXToTime_(x), 0, duration);
            if (snap) {
                // Snap to landmarks (start/end, playhead, keyframes), otherwise to a readable grid.
                const pixelsPerSecond = this.pixelsPerSecond_();
                const landmark = [0, duration, currentTime].concat(keyframes).reduce((best, candidate) => (
                    Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best
                ), Infinity);
                if (Math.abs(landmark - time) * pixelsPerSecond <= SNAP_PIXELS) {
                    time = landmark;
                } else {
                    const step = getDragStep(pixelsPerSecond);
                    time = Math.round(time / step) * step;
                }
            }
            return Number(trimNumber(time));
        }

        handlePointerDown_ (event) {
            if (!this.isInteractive_() || event.button > 0) return;
            event.preventDefault();
            event.stopPropagation();
            ScratchBlocks.hideChaff();
            this.getView_(getTimeline(vm).duration);
            const range = this.getRange_();
            const x = this.clientXToLocalX_(event.clientX);
            const time = this.eventToTime_(event, this.allowsInfinity_());
            let handle = 'start';
            if (isRange) {
                const startX = this.timeToX_(range.start);
                const endX = this.timeToX_(range.end);
                const nearStart = Math.abs(x - startX);
                const nearEnd = Math.abs(x - endX);
                if (Math.min(nearStart, nearEnd) <= 5) {
                    handle = nearStart <= nearEnd ? 'start' : 'end';
                } else if (time === Infinity) {
                    handle = 'end';
                } else if (range.end !== Infinity && x > Math.min(startX, endX) && x < Math.max(startX, endX)) {
                    handle = 'move';
                } else {
                    handle = nearStart <= nearEnd ? 'start' : 'end';
                }
            }
            this.drag_ = {handle, grabTime: this.eventToTime_(event, false, false), range};
            this.frozenLeft_ = null;
            ScratchBlocks.Events.setGroup(true);
            if (handle !== 'move') this.applyDrag_(event);
            this.onPointerMove_ = moveEvent => {
                moveEvent.preventDefault();
                this.applyDrag_(moveEvent);
            };
            this.onPointerUp_ = () => this.stopDrag_();
            document.addEventListener('pointermove', this.onPointerMove_);
            document.addEventListener('pointerup', this.onPointerUp_);
            document.addEventListener('pointercancel', this.onPointerUp_);
        }

        stopDrag_ () {
            this.stopEdgeScroll_();
            if (this.onPointerMove_) {
                document.removeEventListener('pointermove', this.onPointerMove_);
                document.removeEventListener('pointerup', this.onPointerUp_);
                document.removeEventListener('pointercancel', this.onPointerUp_);
                this.onPointerMove_ = null;
                this.onPointerUp_ = null;
                ScratchBlocks.Events.setGroup(false);
            }
            if (this.drag_) {
                this.drag_ = null;
                this.frozenLeft_ = null;
                // Let the track settle next to the final value text.
                if (this.sourceBlock_) this.forceRerender();
            }
        }

        applyDrag_ (event, fromEdgeScroll = false) {
            const drag = this.drag_;
            if (!drag || !this.timelineGroup_) return;
            if (drag.handle === 'move') {
                const now = this.eventToTime_(event, false, false);
                const length = drag.range.end - drag.range.start;
                const low = Math.min(drag.range.start, drag.range.end);
                const high = Math.max(drag.range.start, drag.range.end);
                let delta = clamp(now - drag.grabTime, -low, this.view_.duration - high);
                if (!event.shiftKey) {
                    const step = getDragStep(this.pixelsPerSecond_());
                    delta = Math.round(delta / step) * step;
                }
                const start = Number(trimNumber(drag.range.start + delta));
                this.commitRange_(start, Number(trimNumber(start + length)));
            } else {
                const time = this.eventToTime_(event, this.allowsInfinity_() && drag.handle === 'end');
                this.setBoundary_(drag.handle, time);
            }
            if (!fromEdgeScroll) this.updateEdgeScroll_(event);
        }

        // Holding a handle near either edge of the track keeps scrolling, so a zoomed-in timeline
        // can still reach any time. (Past the right edge is the ∞ zone, so scrolling starts inside.)
        updateEdgeScroll_ (event) {
            const x = this.clientXToLocalX_(event.clientX);
            const trackWidth = this.trackWidth_();
            const pastEnd = x > trackWidth + 1 && this.allowsInfinity_() && this.drag_.handle === 'end';
            let direction = 0;
            if (x < EDGE_SCROLL_PIXELS) direction = -1;
            else if (x > trackWidth - EDGE_SCROLL_PIXELS && !pastEnd) direction = 1;
            if (this.view_.span >= this.view_.duration - 1e-9) direction = 0;
            this.edgeScroll_ = direction ? {clientX: event.clientX, direction, shiftKey: event.shiftKey} : null;
            if (this.edgeScroll_ && !this.edgeScrollFrame_) {
                const step = () => {
                    this.edgeScrollFrame_ = null;
                    const scroll = this.edgeScroll_;
                    if (!scroll || !this.drag_ || !this.view_) return;
                    this.setView_(this.view_.start + (scroll.direction * this.view_.span * 0.02), this.view_.span);
                    this.applyDrag_({clientX: scroll.clientX, shiftKey: scroll.shiftKey}, true);
                    this.edgeScrollFrame_ = requestAnimationFrame(step);
                };
                this.edgeScrollFrame_ = requestAnimationFrame(step);
            }
        }

        stopEdgeScroll_ () {
            this.edgeScroll_ = null;
            if (this.edgeScrollFrame_) cancelAnimationFrame(this.edgeScrollFrame_);
            this.edgeScrollFrame_ = null;
        }

        handleWheel_ (event) {
            if (!this.isInteractive_()) return;
            const view = this.getView_(getTimeline(vm).duration);
            const zooming = event.ctrlKey || event.metaKey;
            // A fully visible timeline has nothing to scroll: let the workspace scroll instead.
            if (!zooming && view.span >= view.duration - 1e-9) return;
            event.preventDefault();
            event.stopPropagation();
            if (zooming) {
                // Trackpad pinch arrives as ctrl + wheel with small deltas; mouse wheels give ~100 per notch.
                const anchor = this.localXToTime_(this.clientXToLocalX_(event.clientX));
                const span = clamp(view.span * Math.exp(clamp(event.deltaY, -100, 100) * 0.01),
                    Math.min(MIN_SPAN, view.duration), view.duration);
                const ratio = (anchor - view.start) / view.span;
                this.setView_(anchor - (ratio * span), span);
                return;
            }
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            const scale = this.sourceBlock_.workspace.scale || 1;
            this.setView_(view.start + (delta / scale / this.pixelsPerSecond_()), view.span);
        }

        // ---- Value ----

        setBoundary_ (handle, time) {
            if (!isRange) {
                this.commitText_(trimNumber(time));
                return;
            }
            const range = this.getRange_();
            if (handle === 'start') {
                this.commitRange_(time, range.end);
            } else {
                this.commitRange_(range.start, time);
            }
        }

        commitRange_ (start, end) {
            this.commitText_(formatTimeRange(
                Number.isFinite(start) ? trimNumber(start) : start,
                Number.isFinite(end) ? trimNumber(end) : end
            ));
        }

        commitText_ (text) {
            const value = this.callValidator(text);
            if (value === null || value === this.getValue()) return;
            this.setValue(value);
        }
    }

    return TimeField;
};

const installTimeFields = (ScratchBlocks, vm) => {
    // Unit tests install block definitions into a bare ScratchBlocks stub without field classes.
    if (ScratchBlocks.Field && ScratchBlocks.FieldTextInput) {
        ScratchBlocks.Field.register('field_movie_time', createTimeFieldClass(ScratchBlocks, vm, MODE_SINGLE));
        ScratchBlocks.Field.register('field_movie_time_range', createTimeFieldClass(ScratchBlocks, vm, MODE_RANGE));
    }

    const shadowDefinition = (fieldType, fieldName, value) => ({
        message0: '%1',
        args0: [{type: fieldType, name: fieldName, value}],
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
        colour: ScratchBlocks.Colours.textField,
        colourSecondary: ScratchBlocks.Colours.textField,
        colourTertiary: ScratchBlocks.Colours.textField,
        colourQuaternary: ScratchBlocks.Colours.textField
    });

    ScratchBlocks.Blocks[TIME_SHADOW_OPCODE] = {
        init: function () {
            this.jsonInit(shadowDefinition('field_movie_time', TIME_FIELD, '0'));
        }
    };
    ScratchBlocks.Blocks[TIME_RANGE_SHADOW_OPCODE] = {
        init: function () {
            this.jsonInit(shadowDefinition('field_movie_time_range', TIME_RANGE_FIELD, '0~Infinity'));
        }
    };
};

export {
    createTimeFieldClass,
    normalizeRange,
    normalizeSingle
};
export default installTimeFields;
