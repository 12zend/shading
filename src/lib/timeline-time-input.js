// While a time value is being typed, the main timeline previews it: the playhead jumps to the value, dragging the
// playhead writes its time back into the value, and finishing the edit returns the playhead to where it was.

const TIME_EPSILON = 1e-9;

let activeSession = null;

const parseTime = text => {
    const trimmed = String(text === null || typeof text === 'undefined' ? '' : text).trim();
    if (!trimmed) return null;
    const time = Number(trimmed);
    return Number.isFinite(time) ? time : null;
};

/**
 * Format a frame time for a number input in whole milliseconds. Frame k shows [k / fps, (k + 1) / fps), so the
 * first millisecond at or after the frame start stays on that frame when the value is typed or reopened.
 * @param {number} seconds Frame time in seconds.
 * @returns {string} The value text.
 */
const formatTimeInputValue = seconds => {
    // The tolerance keeps 4.2 s (4200.000000000001 ms in floating point) from moving up a millisecond.
    const rounded = Math.ceil(((Number(seconds) || 0) * 1000) - 1e-6) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
};

class TimelineTimeInputSession {
    constructor (manager, editor) {
        this.manager = manager;
        this.editor = editor;
        this.ended = false;
        const timeline = manager.getTimelineState();
        this.restoreTime = timeline.currentTime;
        this.resumePlayback = timeline.playing;
        this.shownTime = timeline.currentTime;
        this.handleTimelineChanged = this.handleTimelineChanged.bind(this);
        if (timeline.playing) manager.pauseTimeline();
        manager.on('timelineChanged', this.handleTimelineChanged);
        this.preview(editor.read());
    }

    /**
     * Move the playhead to the value being typed. Text that is not a number leaves the playhead where it is.
     * @param {string} text The current input text.
     */
    preview (text) {
        if (this.ended) return;
        const time = parseTime(text);
        if (time === null) return;
        const duration = Number(this.manager.getTimelineState().duration) || 0;
        // The seek's own change event must not rewrite the text: a value past the end stays as typed.
        this.seeking = true;
        try {
            this.manager.seekTimeline(Math.max(0, Math.min(duration, time)));
        } finally {
            this.seeking = false;
        }
        this.shownTime = this.manager.getTimelineState().currentTime;
    }

    handleTimelineChanged (timeline) {
        if (this.ended || this.seeking || timeline.playing || timeline.recording) return;
        if (Math.abs(timeline.currentTime - this.shownTime) <= TIME_EPSILON) return;
        this.shownTime = timeline.currentTime;
        this.editor.write(formatTimeInputValue(timeline.currentTime));
    }

    /**
     * Finish the edit and put the playhead back where it was before the edit started.
     */
    end () {
        if (this.ended) return;
        this.ended = true;
        if (activeSession === this) activeSession = null;
        this.manager.removeListener('timelineChanged', this.handleTimelineChanged);
        const timeline = this.manager.getTimelineState();
        if (timeline.recording) return;
        this.manager.seekTimeline(this.restoreTime);
        if (this.resumePlayback) this.manager.playTimeline();
    }
}

/**
 * Start previewing a time value on the timeline. Only one value is edited at a time; starting another finishes
 * the previous edit first.
 * @param {object} manager The Movie asset manager.
 * @param {{read: function(): string, write: function(string)}} editor Reads and replaces the input text.
 * @returns {?TimelineTimeInputSession} The session, or null while the timeline is rendering.
 */
const beginTimelineTimeInput = (manager, editor) => {
    if (activeSession) activeSession.end();
    if (!manager || manager.getTimelineState().recording) return null;
    activeSession = new TimelineTimeInputSession(manager, editor);
    return activeSession;
};

/**
 * @returns {boolean} Whether a time value is being edited with the timeline as its preview.
 */
const isEditingTimelineTimeInput = () => Boolean(activeSession);

export {
    beginTimelineTimeInput,
    formatTimeInputValue,
    isEditingTimelineTimeInput
};
