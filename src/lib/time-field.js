import {
    TIME_FIELD,
    TIME_RANGE_FIELD,
    TIME_RANGE_SHADOW_OPCODE,
    TIME_SHADOW_OPCODE,
    formatTimeRange,
    parseTimeRange
} from '../../scratch-vm/src/lib/time-range';

import styles from './time-field.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_DURATION = 10;
const DEFAULT_FRAMERATE = 30;

// Inline mini timeline drawn inside the shadow block, right of the value.
const MINI_WIDTH = 36;
const MINI_HEIGHT = 12;
const MINI_GAP = 4;
const MINI_RIGHT_PADDING = 10;
const MINI_INFINITY_WIDTH = 5;

// Popup editor: a compact zoomable strip (ruler, track, scroll thumb).
const EDITOR_WIDTH = 288;
const EDITOR_PADDING = 8;
const EDITOR_INFINITY_WIDTH = 20;
const EDITOR_TRACK_WIDTH = EDITOR_WIDTH - (EDITOR_PADDING * 2) - EDITOR_INFINITY_WIDTH;
const EDITOR_TRACK_RIGHT = EDITOR_PADDING + EDITOR_TRACK_WIDTH;
const EDITOR_INFINITY_X = EDITOR_TRACK_RIGHT + 4 + ((EDITOR_INFINITY_WIDTH - 4) / 2);
const EDITOR_LABEL_Y = 8;
const EDITOR_TICK_Y = 9;
const EDITOR_TRACK_Y = 14;
const EDITOR_TRACK_HEIGHT = 16;
const EDITOR_SCROLL_Y = EDITOR_TRACK_Y + EDITOR_TRACK_HEIGHT + 4;
const EDITOR_SCROLL_HEIGHT = 3;
const EDITOR_HEIGHT = EDITOR_SCROLL_Y + EDITOR_SCROLL_HEIGHT + 3;
const EDITOR_MIN_SPAN = 0.5;
// Timelines up to this length open fully visible; longer ones open zoomed around the value.
const INITIAL_FIT_SECONDS = 30;
const INITIAL_MIN_SPAN = 10;
const SNAP_PIXELS = 6;
const EDGE_SCROLL_PIXELS = 10;
let editorClipId = 0;

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

const html = (tagName, className, parent = null, text = null) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== null) element.textContent = text;
    if (parent) parent.appendChild(element);
    return element;
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
        framerate: state && Number(state.framerate) > 0 ? Number(state.framerate) : DEFAULT_FRAMERATE,
        keyframes: state && Array.isArray(state.keyframes) ?
            state.keyframes.filter(time => Number.isFinite(time) && time >= 0 && time <= duration) : [],
        manager
    };
};

const getRulerStep = pixelsPerSecond => {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find(step => step * pixelsPerSecond >= 40) || steps[steps.length - 1];
};

const formatRulerTime = seconds => {
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

// Every live time field, so an edited timeline duration redraws the mini timelines.
const liveFields = new Set();
let subscribedManager = null;
const handleTimelineChanged = () => {
    for (const field of liveFields) field.updateMiniTimeline_();
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

        init () {
            if (this.fieldGroup_) return;
            super.init();
            liveFields.add(this);
            subscribeToTimeline(vm);
            this.miniGroup_ = svg('g', {
                'class': styles.miniTimeline,
                'aria-hidden': 'true'
            }, this.fieldGroup_);
            this.miniTrack_ = svg('rect', {
                class: styles.miniTrack,
                height: 4,
                rx: 2,
                width: MINI_WIDTH - MINI_INFINITY_WIDTH,
                x: 0,
                y: (MINI_HEIGHT / 2) - 2
            }, this.miniGroup_);
            this.miniInfinity_ = svg('rect', {
                class: styles.miniInfinity,
                height: 4,
                rx: 2,
                width: MINI_INFINITY_WIDTH - 1,
                x: MINI_WIDTH - MINI_INFINITY_WIDTH + 1,
                y: (MINI_HEIGHT / 2) - 2
            }, this.miniGroup_);
            this.miniRange_ = svg('rect', {
                class: styles.miniRange,
                height: 4,
                rx: 2,
                y: (MINI_HEIGHT / 2) - 2
            }, this.miniGroup_);
            this.miniStart_ = svg('rect', {
                class: styles.miniMarker,
                height: MINI_HEIGHT,
                rx: 1,
                width: 2,
                y: 0
            }, this.miniGroup_);
            this.miniEnd_ = svg('rect', {
                class: styles.miniMarker,
                height: MINI_HEIGHT,
                rx: 1,
                width: 2,
                y: 0
            }, this.miniGroup_);
            this.updateMiniTimeline_();
            this.forceRerender();
        }

        dispose () {
            liveFields.delete(this);
            this.stopDrag_();
            this.miniGroup_ = null;
            super.dispose();
        }

        // Called by Field.updateWidth: reserve room for the mini timeline right of the text.
        positionArrow (x) {
            if (!this.miniGroup_) return 0;
            const size = this.size_;
            const left = this.sourceBlock_ && this.sourceBlock_.RTL ?
                MINI_RIGHT_PADDING - (ScratchBlocks.BlockSvg.EDITABLE_FIELD_PADDING / 2) :
                x - (ScratchBlocks.BlockSvg.EDITABLE_FIELD_PADDING / 2) + MINI_GAP;
            const top = ((size.height - MINI_HEIGHT) / 2) + ScratchBlocks.BlockSvg.FIELD_TOP_PADDING;
            this.miniGroup_.setAttribute('transform', `translate(${left},${top})`);
            return MINI_WIDTH + MINI_GAP + MINI_RIGHT_PADDING - (ScratchBlocks.BlockSvg.EDITABLE_FIELD_PADDING / 2);
        }

        setText (text) {
            super.setText(text);
            this.updateMiniTimeline_();
            this.updateEditor_();
        }

        timeToMiniX_ (time, duration) {
            const trackWidth = this.allowsInfinity_() ? MINI_WIDTH - MINI_INFINITY_WIDTH : MINI_WIDTH;
            if (time === Infinity) return this.allowsInfinity_() ? MINI_WIDTH - 1 : trackWidth - 1;
            return clamp(time / duration, 0, 1) * (trackWidth - 1);
        }

        updateMiniTimeline_ () {
            if (!this.miniGroup_) return;
            const parentBlock = this.sourceBlock_ && this.sourceBlock_.getParent();
            if (parentBlock) this.miniGroup_.style.setProperty('--time-field-accent', parentBlock.getColour());
            const {duration} = getTimeline(vm);
            const range = this.getRange_();
            const start = this.timeToMiniX_(range.start, duration);
            const end = this.timeToMiniX_(range.end, duration);
            const left = Math.min(start, end);
            this.miniRange_.setAttribute('x', left);
            this.miniRange_.setAttribute('width', Math.max(0, Math.abs(end - start)));
            this.miniRange_.style.display = isRange ? '' : 'none';
            this.miniStart_.setAttribute('x', start - 0.5);
            this.miniEnd_.setAttribute('x', end - 0.5);
            this.miniEnd_.style.display = isRange ? '' : 'none';
            const allowsInfinity = this.allowsInfinity_();
            this.miniTrack_.setAttribute('width', allowsInfinity ? MINI_WIDTH - MINI_INFINITY_WIDTH : MINI_WIDTH);
            this.miniInfinity_.style.display = allowsInfinity ? '' : 'none';
            this.miniInfinity_.classList.toggle(styles.miniInfinityActive, isRange && range.end === Infinity);
        }

        // ---- Popup editor ----
        // A compact strip: ruler + track + scroll thumb. Ctrl/⌘ + wheel (or pinch) zooms around the
        // pointer, the wheel scrolls sideways, so long movies stay easy to aim at.

        showEditor_ () {
            super.showEditor_(this.useTouchInteraction_);
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
            ScratchBlocks.DropDownDiv.clearContent();
            const parentBlock = this.sourceBlock_.getParent() || this.sourceBlock_;
            const content = ScratchBlocks.DropDownDiv.getContentDiv();
            this.buildEditor_(content);
            ScratchBlocks.DropDownDiv.setColour(parentBlock.getColour(), parentBlock.getColourTertiary());
            ScratchBlocks.DropDownDiv.setCategory(parentBlock.getCategory());
            ScratchBlocks.DropDownDiv.showPositionedByBlock(this, this.sourceBlock_, () => {
                this.stopDrag_();
                if (this.editor_) this.lastView_ = this.editor_.view;
                this.editor_ = null;
            });
            this.updateEditor_();
        }

        getInitialView_ (duration) {
            if (this.lastView_ && this.lastView_.duration === duration) return this.lastView_;
            const view = {duration, start: 0, span: duration};
            if (duration <= INITIAL_FIT_SECONDS) return view;
            // Long movies: open zoomed around the current value instead of squeezing minutes into 260px.
            const range = this.getRange_();
            const low = clamp(Math.min(range.start, range.end), 0, duration);
            const high = Number.isFinite(range.end) && isRange ?
                clamp(Math.max(range.start, range.end), 0, duration) :
                low;
            const span = clamp((high - low) * 1.5, INITIAL_MIN_SPAN, duration);
            view.span = span;
            view.start = clamp(((low + high) / 2) - (span / 2), 0, duration - span);
            return view;
        }

        buildEditor_ (content) {
            const timeline = getTimeline(vm);
            const root = html('div', styles.editor, content);
            const graph = svg('svg', {
                class: styles.graph,
                height: EDITOR_HEIGHT,
                viewBox: `0 0 ${EDITOR_WIDTH} ${EDITOR_HEIGHT}`,
                width: EDITOR_WIDTH
            }, root);
            svg('title', {}, graph).textContent =
                'Drag to set the time · Wheel to scroll · Ctrl/⌘ + wheel or pinch to zoom · Shift to skip snapping';
            const clipId = `timeFieldClip${++editorClipId}`;
            const clip = svg('clipPath', {id: clipId}, svg('defs', {}, graph));
            svg('rect', {
                height: EDITOR_HEIGHT,
                width: EDITOR_TRACK_WIDTH + 2,
                x: EDITOR_PADDING - 1,
                y: 0
            }, clip);
            svg('rect', {
                class: styles.track,
                height: EDITOR_TRACK_HEIGHT,
                rx: 3,
                width: EDITOR_TRACK_WIDTH,
                x: EDITOR_PADDING,
                y: EDITOR_TRACK_Y
            }, graph);
            let infinityZone = null;
            if (this.allowsInfinity_()) {
                infinityZone = svg('g', {class: styles.infinityZone}, graph);
                svg('rect', {
                    height: EDITOR_TRACK_HEIGHT,
                    rx: 3,
                    width: EDITOR_INFINITY_WIDTH - 4,
                    x: EDITOR_TRACK_RIGHT + 4,
                    y: EDITOR_TRACK_Y
                }, infinityZone);
                svg('text', {
                    'text-anchor': 'middle',
                    'x': EDITOR_INFINITY_X,
                    'y': EDITOR_TRACK_Y + (EDITOR_TRACK_HEIGHT / 2) + 4
                }, infinityZone).textContent = '∞';
            }
            const scrollTrack = svg('rect', {
                class: styles.scrollTrack,
                height: EDITOR_SCROLL_HEIGHT,
                rx: EDITOR_SCROLL_HEIGHT / 2,
                width: EDITOR_TRACK_WIDTH,
                x: EDITOR_PADDING,
                y: EDITOR_SCROLL_Y
            }, graph);
            const scrollThumb = svg('rect', {
                'class': styles.scrollThumb,
                'data-scroll': 'thumb',
                'height': EDITOR_SCROLL_HEIGHT + 4,
                'rx': (EDITOR_SCROLL_HEIGHT + 4) / 2,
                'y': EDITOR_SCROLL_Y - 2
            }, graph);
            const layer = svg('g', {'clip-path': `url(#${clipId})`}, graph);
            const handles = svg('g', {}, graph);

            this.editor_ = {
                duration: timeline.duration,
                graph,
                handles,
                infinityZone,
                keyframes: timeline.keyframes,
                layer,
                playhead: timeline.currentTime,
                scrollThumb,
                scrollTrack,
                snapTimes: [0, timeline.duration, timeline.currentTime].concat(timeline.keyframes),
                view: this.getInitialView_(timeline.duration)
            };
            graph.addEventListener('mousedown', event => this.onGraphMouseDown_(event));
            graph.addEventListener('touchstart', event => this.onGraphMouseDown_(event), {passive: false});
            graph.addEventListener('wheel', event => this.onGraphWheel_(event), {passive: false});
        }

        pixelsPerSecond_ () {
            return EDITOR_TRACK_WIDTH / this.editor_.view.span;
        }

        setView_ (start, span) {
            const editor = this.editor_;
            const nextSpan = clamp(span, Math.min(EDITOR_MIN_SPAN, editor.duration), editor.duration);
            editor.view = {
                duration: editor.duration,
                span: nextSpan,
                start: clamp(start, 0, editor.duration - nextSpan)
            };
            this.updateEditor_();
        }

        onGraphWheel_ (event) {
            if (!this.editor_) return;
            event.preventDefault();
            event.stopPropagation();
            const view = this.editor_.view;
            if (event.ctrlKey || event.metaKey) {
                // Trackpad pinch arrives as ctrl + wheel with small deltas; mouse wheels give ~100 per notch.
                const anchor = this.clientXToTime_(event.clientX, false);
                const span = view.span * Math.exp(clamp(event.deltaY, -100, 100) * 0.01);
                const ratio = (anchor - view.start) / view.span;
                const nextSpan = clamp(span, Math.min(EDITOR_MIN_SPAN, this.editor_.duration), this.editor_.duration);
                this.setView_(anchor - (ratio * nextSpan), nextSpan);
                return;
            }
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            this.setView_(view.start + (delta / this.pixelsPerSecond_()), view.span);
        }

        timeToEditorX_ (time) {
            const editor = this.editor_;
            if (time === Infinity) return EDITOR_INFINITY_X;
            return EDITOR_PADDING + ((clamp(time, 0, editor.duration) - editor.view.start) * this.pixelsPerSecond_());
        }

        renderRuler_ () {
            const editor = this.editor_;
            const layer = editor.layer;
            while (layer.firstChild) layer.removeChild(layer.firstChild);
            const pixelsPerSecond = this.pixelsPerSecond_();
            const view = editor.view;
            const step = getRulerStep(pixelsPerSecond);
            const minor = step / 2;
            const first = Math.floor(view.start / minor) * minor;
            for (let time = first; time <= view.start + view.span + 1e-9; time += minor) {
                if (time < -1e-9) continue;
                const major = Math.abs((time / step) - Math.round(time / step)) < 1e-6;
                const x = this.timeToEditorX_(time);
                svg('line', {
                    class: major ? styles.tickMajor : styles.tickMinor,
                    x1: x,
                    x2: x,
                    y1: major ? EDITOR_TICK_Y : EDITOR_TICK_Y + 3,
                    y2: EDITOR_TRACK_Y
                }, layer);
                if (major) {
                    svg('text', {
                        'class': styles.tickLabel,
                        'text-anchor': 'start',
                        'x': x + 2,
                        'y': EDITOR_LABEL_Y
                    }, layer).textContent = formatRulerTime(time);
                }
            }
            for (const keyframe of editor.keyframes) {
                const x = this.timeToEditorX_(keyframe);
                svg('path', {
                    class: styles.keyframe,
                    d: `M ${x} ${EDITOR_TRACK_Y + EDITOR_TRACK_HEIGHT - 6} l 2.5 2.5 l -2.5 2.5 l -2.5 -2.5 z`
                }, layer);
            }
            const playheadX = this.timeToEditorX_(editor.playhead);
            svg('line', {
                class: styles.playhead,
                x1: playheadX,
                x2: playheadX,
                y1: EDITOR_TICK_Y,
                y2: EDITOR_TRACK_Y + EDITOR_TRACK_HEIGHT
            }, layer);
            editor.selection = svg('rect', {
                class: styles.selection,
                height: EDITOR_TRACK_HEIGHT,
                y: EDITOR_TRACK_Y
            }, layer);
        }

        renderHandle_ (name, x) {
            const group = svg('g', {
                'class': styles.handle,
                'data-handle': name,
                'transform': `translate(${x},0)`
            }, this.editor_.handles);
            svg('rect', {
                class: styles.handleHit,
                height: EDITOR_TRACK_HEIGHT + 8,
                width: 12,
                x: -6,
                y: EDITOR_TRACK_Y - 4
            }, group);
            svg('line', {
                class: styles.handleLine,
                x1: 0,
                x2: 0,
                y1: EDITOR_TRACK_Y - 2,
                y2: EDITOR_TRACK_Y + EDITOR_TRACK_HEIGHT + 2
            }, group);
            svg('rect', {
                class: styles.handleGrip,
                height: 8,
                rx: 2,
                width: 5,
                x: -2.5,
                y: EDITOR_TRACK_Y + (EDITOR_TRACK_HEIGHT / 2) - 4
            }, group);
        }

        updateEditor_ () {
            const editor = this.editor_;
            if (!editor) return;
            this.renderRuler_();
            const range = this.getRange_();
            const startX = this.timeToEditorX_(range.start);
            const endX = this.timeToEditorX_(range.end);
            const handles = editor.handles;
            while (handles.firstChild) handles.removeChild(handles.firstChild);
            // Handles scrolled out of view are hidden; the selection band still shows where the range goes.
            const visible = (time, x) => time === Infinity ||
                (x >= EDITOR_PADDING - 1 && x <= EDITOR_TRACK_RIGHT + 1);
            if (visible(range.start, startX)) this.renderHandle_('start', startX);
            if (isRange && visible(range.end, endX)) this.renderHandle_('end', endX);
            if (isRange) {
                const left = Math.min(startX, endX);
                editor.selection.setAttribute('x', left);
                editor.selection.setAttribute('width', Math.abs(endX - startX));
            } else {
                editor.selection.style.display = 'none';
            }
            if (editor.infinityZone) {
                editor.infinityZone.classList.toggle(styles.infinityActive, range.end === Infinity);
            }
            const fullyVisible = editor.view.span >= editor.duration - 1e-9;
            editor.scrollTrack.style.display = fullyVisible ? 'none' : '';
            editor.scrollThumb.style.display = fullyVisible ? 'none' : '';
            const thumbWidth = Math.max(12, EDITOR_TRACK_WIDTH * (editor.view.span / editor.duration));
            const travel = EDITOR_TRACK_WIDTH - thumbWidth;
            const scrollable = editor.duration - editor.view.span;
            editor.scrollThumb.setAttribute('width', thumbWidth);
            editor.scrollThumb.setAttribute('x',
                EDITOR_PADDING + (scrollable > 0 ? travel * (editor.view.start / scrollable) : 0));
        }

        clientXToGraphX_ (clientX) {
            const bounds = this.editor_.graph.getBoundingClientRect();
            const scale = bounds.width / EDITOR_WIDTH || 1;
            return (clientX - bounds.left) / scale;
        }

        clientXToTime_ (clientX, clampToTimeline = true) {
            const editor = this.editor_;
            const x = this.clientXToGraphX_(clientX);
            const time = editor.view.start + ((x - EDITOR_PADDING) / this.pixelsPerSecond_());
            return clampToTimeline ? clamp(time, 0, editor.duration) : time;
        }

        eventPoint_ (event) {
            if (event.touches && event.touches.length) return event.touches[0];
            if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0];
            return event;
        }

        eventToTime_ (event, allowInfinity, snap = !event.shiftKey) {
            const editor = this.editor_;
            const point = this.eventPoint_(event);
            if (allowInfinity && this.clientXToGraphX_(point.clientX) > EDITOR_TRACK_RIGHT + 2) return Infinity;
            let time = this.clientXToTime_(point.clientX);
            if (snap) {
                // Snap to landmarks (start/end, playhead, keyframes), otherwise to a readable grid.
                const pixelsPerSecond = this.pixelsPerSecond_();
                const snapDistance = SNAP_PIXELS / pixelsPerSecond;
                const landmark = editor.snapTimes.reduce((best, candidate) => (
                    Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best
                ), Infinity);
                if (Math.abs(landmark - time) <= snapDistance) {
                    time = landmark;
                } else {
                    const step = getDragStep(pixelsPerSecond);
                    time = Math.round(time / step) * step;
                }
            }
            return Number(trimNumber(time));
        }

        onGraphMouseDown_ (event) {
            if (!this.editor_ || (event.button && event.button !== 0)) return;
            event.preventDefault();
            event.stopPropagation();
            const point = this.eventPoint_(event);
            const target = event.target && event.target.closest ?
                event.target.closest('[data-handle],[data-scroll]') : null;
            if (target && target.getAttribute('data-scroll')) {
                this.drag_ = {handle: 'scroll', grabX: point.clientX, view: this.editor_.view};
                this.startDrag_(false);
                return;
            }
            const range = this.getRange_();
            let handle = target ? target.getAttribute('data-handle') : null;
            const time = this.eventToTime_(event, this.allowsInfinity_());
            if (!handle) {
                if (!isRange) {
                    handle = 'start';
                } else if (time === Infinity) {
                    handle = 'end';
                } else if (range.end !== Infinity && time > Math.min(range.start, range.end) &&
                    time < Math.max(range.start, range.end)) {
                    handle = 'move';
                } else {
                    const endTime = range.end === Infinity ? this.editor_.duration + 1 : range.end;
                    handle = Math.abs(time - range.start) <= Math.abs(time - endTime) ? 'start' : 'end';
                }
            }
            this.drag_ = {
                handle,
                grabTime: this.eventToTime_(event, false, false),
                range
            };
            if (handle !== 'move') this.applyDrag_(event);
            this.startDrag_(true);
        }

        startDrag_ (changesValue) {
            this.stopDragListeners_();
            this.handleDragMove_ = event => {
                if (event.cancelable) event.preventDefault();
                this.applyDrag_(event);
            };
            this.handleDragEnd_ = () => this.stopDrag_();
            document.addEventListener('mousemove', this.handleDragMove_);
            document.addEventListener('mouseup', this.handleDragEnd_);
            document.addEventListener('touchmove', this.handleDragMove_, {passive: false});
            document.addEventListener('touchend', this.handleDragEnd_);
            this.dragGroup_ = changesValue;
            if (changesValue) ScratchBlocks.Events.setGroup(true);
        }

        stopDragListeners_ () {
            if (!this.handleDragMove_) return;
            document.removeEventListener('mousemove', this.handleDragMove_);
            document.removeEventListener('mouseup', this.handleDragEnd_);
            document.removeEventListener('touchmove', this.handleDragMove_);
            document.removeEventListener('touchend', this.handleDragEnd_);
            this.handleDragMove_ = null;
            this.handleDragEnd_ = null;
        }

        stopDrag_ () {
            if (this.handleDragMove_ && this.dragGroup_) ScratchBlocks.Events.setGroup(false);
            this.stopEdgeScroll_();
            this.stopDragListeners_();
            this.drag_ = null;
            this.dragGroup_ = false;
        }

        // Holding a handle near either edge of the track keeps scrolling, so a zoomed-in strip can
        // still reach any time. (Past the right edge is the ∞ zone, so edge scrolling starts inside.)
        updateEdgeScroll_ (event) {
            const x = this.clientXToGraphX_(this.eventPoint_(event).clientX);
            const pastEnd = x > EDITOR_TRACK_RIGHT + 2 && this.allowsInfinity_() && this.drag_.handle === 'end';
            let direction = 0;
            if (x < EDITOR_PADDING + EDGE_SCROLL_PIXELS) direction = -1;
            else if (x > EDITOR_TRACK_RIGHT - EDGE_SCROLL_PIXELS && !pastEnd) direction = 1;
            this.edgeScroll_ = direction ? {
                clientX: this.eventPoint_(event).clientX,
                direction,
                shiftKey: event.shiftKey
            } : null;
            if (this.edgeScroll_ && !this.edgeScrollFrame_) {
                const step = () => {
                    this.edgeScrollFrame_ = null;
                    const scroll = this.edgeScroll_;
                    if (!scroll || !this.drag_ || !this.editor_) return;
                    const view = this.editor_.view;
                    this.setView_(view.start + (scroll.direction * view.span * 0.02), view.span);
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

        applyDrag_ (event, fromEdgeScroll = false) {
            const drag = this.drag_;
            if (!drag || !this.editor_) return;
            if (drag.handle === 'scroll') {
                const dx = this.clientXToGraphX_(this.eventPoint_(event).clientX) -
                    this.clientXToGraphX_(drag.grabX);
                const secondsPerPixel = this.editor_.duration / EDITOR_TRACK_WIDTH;
                this.setView_(drag.view.start + (dx * secondsPerPixel), drag.view.span);
                return;
            }
            if (drag.handle === 'move') {
                const now = this.eventToTime_(event, false, false);
                const length = drag.range.end - drag.range.start;
                const low = Math.min(drag.range.start, drag.range.end);
                const high = Math.max(drag.range.start, drag.range.end);
                let delta = clamp(now - drag.grabTime, -low, this.editor_.duration - high);
                if (!event.shiftKey) {
                    const step = getDragStep(this.pixelsPerSecond_());
                    delta = Math.round(delta / step) * step;
                }
                const start = Number(trimNumber(drag.range.start + delta));
                this.commitRange_(start, Number(trimNumber(start + length)));
                return;
            }
            const time = this.eventToTime_(event, this.allowsInfinity_() && drag.handle === 'end');
            this.setBoundary_(drag.handle, time);
            if (!fromEdgeScroll) this.updateEdgeScroll_(event);
        }

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
            if (value === null) return;
            const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
            if (htmlInput) {
                htmlInput.value = value;
                htmlInput.oldValue_ = value;
            }
            this.setValue(value);
            if (htmlInput) {
                this.validate_();
                this.resizeEditor_();
            }
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
