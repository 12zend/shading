import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../lib/movie-asset-manager';

import styles from './timeline.css';

const formatTime = seconds => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remaining = safeSeconds - (minutes * 60);
    const minuteText = minutes < 10 ? `0${minutes}` : String(minutes);
    const secondText = remaining < 10 ? `0${remaining.toFixed(2)}` : remaining.toFixed(2);
    return `${minuteText}:${secondText}`;
};

class Timeline extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            draft: null,
            exporting: false,
            settingsOpen: false,
            timeline: {
                currentTime: 0,
                duration: 10,
                frameCount: 0,
                framerate: props.framerate,
                height: props.customStageSize.height,
                playing: false,
                recording: false,
                sound: '',
                width: props.customStageSize.width
            }
        };
        this.handleTimelineChanged = this.handleTimelineChanged.bind(this);
        this.handleRenderingFramesChanged = this.handleRenderingFramesChanged.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handlePlayPause = this.handlePlayPause.bind(this);
        this.handleStepFrame = this.handleStepFrame.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleSeek = this.handleSeek.bind(this);
        this.handleToggleSettings = this.handleToggleSettings.bind(this);
        this.handleDraftChange = this.handleDraftChange.bind(this);
        this.handleSaveSettings = this.handleSaveSettings.bind(this);
        this.handleClearFrames = this.handleClearFrames.bind(this);
        this.handleRenderFrames = this.handleRenderFrames.bind(this);
        this.handleExport = this.handleExport.bind(this);
    }

    componentDidMount () {
        this.manager = installMovieAssetManager(this.props.vm);
        this.manager.on('timelineChanged', this.handleTimelineChanged);
        this.manager.on('renderingFramesChanged', this.handleRenderingFramesChanged);
        document.addEventListener('keydown', this.handleKeyDown);
        this.handleTimelineChanged(this.manager.getTimelineState());
    }

    componentWillUnmount () {
        if (!this.manager) return;
        this.manager.removeListener('timelineChanged', this.handleTimelineChanged);
        this.manager.removeListener('renderingFramesChanged', this.handleRenderingFramesChanged);
        document.removeEventListener('keydown', this.handleKeyDown);
    }

    handleTimelineChanged (timeline) {
        this.setState({timeline});
    }

    handleRenderingFramesChanged (frameCount) {
        this.setState(state => ({
            timeline: Object.assign({}, state.timeline, {frameCount})
        }));
    }

    handleKeyDown (event) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

        const isSpace = event.key === ' ' || event.code === 'Space';
        const isArrowLeft = event.key === 'ArrowLeft' || event.keyCode === 37;
        const isArrowRight = event.key === 'ArrowRight' || event.keyCode === 39;
        if (!isSpace && !isArrowLeft && !isArrowRight) return;

        const target = event.target;
        const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
        const isTimelineTarget = Boolean(
            this.timelineElement && target && this.timelineElement.contains(target)
        );
        const isTimelineScrubber = isTimelineTarget && target === this.scrubberElement;
        const isFormControl = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isEditingText = (isFormControl && !isTimelineScrubber) || (target && target.isContentEditable);

        if (isSpace) {
            if (event.repeat || isEditingText) return;
            event.preventDefault();
            this.handlePlayPause();
            return;
        }

        const hasNoFocusedControl = !target || target === document || target === document.body;
        if (this.state.timeline.recording || isEditingText ||
            (!hasNoFocusedControl && !isTimelineTarget)) return;
        event.preventDefault();
        this.handleStepFrame(isArrowLeft ? -1 : 1);
    }

    handlePlayPause () {
        if (this.state.timeline.playing) {
            this.manager.pauseTimeline();
        } else {
            this.manager.playTimeline();
        }
    }

    handleStepFrame (direction) {
        const timeline = this.state.timeline;
        const framerate = Math.max(1, Number(timeline.framerate) || 1);
        const currentFrame = Math.round(timeline.currentTime * framerate);
        const nextTime = (currentFrame + direction) / framerate;
        this.manager.seekTimeline(Math.max(0, Math.min(timeline.duration, nextTime)));
    }

    handleStop () {
        this.manager.stopTimeline();
    }

    handleSeek (event) {
        this.manager.seekTimeline(Number(event.target.value));
    }

    handleToggleSettings () {
        this.setState(state => {
            if (state.settingsOpen) return {settingsOpen: false};
            return {
                draft: Object.assign({}, state.timeline, {
                    framerate: this.props.framerate,
                    height: this.props.customStageSize.height,
                    width: this.props.customStageSize.width
                }),
                settingsOpen: true
            };
        });
    }

    handleDraftChange (event) {
        const property = event.target.name;
        const value = event.target.value;
        this.setState(state => ({
            draft: Object.assign({}, state.draft, {[property]: value})
        }));
    }

    handleSaveSettings () {
        const draft = this.state.draft;
        this.manager.updateTimelineSettings({
            duration: Number(draft.duration),
            framerate: Number(draft.framerate),
            height: Number(draft.height),
            sound: draft.sound,
            width: Number(draft.width)
        });
        this.setState({settingsOpen: false});
    }

    handleClearFrames () {
        this.manager.clearRenderingFrames();
    }

    handleRenderFrames () {
        this.manager.updateTimelineSettings({
            duration: Number(this.state.draft.duration),
            framerate: Number(this.state.draft.framerate),
            height: Number(this.state.draft.height),
            sound: this.state.draft.sound,
            width: Number(this.state.draft.width)
        });
        this.manager.renderTimeline();
        this.setState({settingsOpen: false});
    }

    handleExport () {
        this.setState({exporting: true});
        this.manager.exportTimeline()
            .catch(error => this.manager.emit('renderError', error))
            .then(() => this.setState({exporting: false}));
    }

    renderSettings () {
        if (!this.state.settingsOpen || !this.state.draft) return null;
        const sounds = this.manager.getTimelineSounds();
        return (
            <div className={styles.settingsPanel}>
                <div className={styles.settingsHeading}>
                    <div>
                        <strong>{'Rendering settings'}</strong>
                        <span>{'Defaults follow Advanced Settings.'}</span>
                    </div>
                    <button
                        aria-label="Close rendering settings"
                        className={styles.closeButton}
                        type="button"
                        onClick={this.handleToggleSettings}
                    >{'×'}</button>
                </div>
                <div className={styles.settingsGrid}>
                    <label>
                        <span>{'Width'}</span>
                        <input
                            max="4096"
                            min="1"
                            name="width"
                            type="number"
                            value={this.state.draft.width}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Height'}</span>
                        <input
                            max="4096"
                            min="1"
                            name="height"
                            type="number"
                            value={this.state.draft.height}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Frame rate'}</span>
                        <input
                            max="120"
                            min="1"
                            name="framerate"
                            step="1"
                            type="number"
                            value={this.state.draft.framerate}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Max time (sec)'}</span>
                        <input
                            max="3600"
                            min="0.1"
                            name="duration"
                            step="0.1"
                            type="number"
                            value={this.state.draft.duration}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label className={styles.soundField}>
                        <span>{'Audio'}</span>
                        <select
                            name="sound"
                            value={this.state.draft.sound}
                            onChange={this.handleDraftChange}
                        >
                            <option value="">{'No audio'}</option>
                            {sounds.map(sound => (
                                <option
                                    key={sound}
                                    value={sound}
                                >
                                    {sound}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className={styles.settingsActions}>
                    <button
                        className={styles.secondaryButton}
                        disabled={this.state.timeline.recording || this.state.timeline.frameCount === 0}
                        type="button"
                        onClick={this.handleClearFrames}
                    >{'Clear frames'}</button>
                    <button
                        className={styles.secondaryButton}
                        disabled={this.state.timeline.recording}
                        type="button"
                        onClick={this.handleRenderFrames}
                    >{this.state.timeline.recording ? 'Rendering…' : 'Render frames'}</button>
                    <button
                        className={styles.secondaryButton}
                        disabled={
                            this.state.timeline.frameCount === 0 ||
                            this.state.timeline.recording ||
                            this.state.exporting
                        }
                        type="button"
                        onClick={this.handleExport}
                    >{this.state.exporting ? 'Exporting…' : 'Export MP4'}</button>
                    <button
                        className={styles.primaryButton}
                        disabled={this.state.timeline.recording}
                        type="button"
                        onClick={this.handleSaveSettings}
                    >{'Apply'}</button>
                </div>
            </div>
        );
    }

    render () {
        const timeline = this.state.timeline;
        const progress = timeline.duration ? (timeline.currentTime / timeline.duration) * 100 : 0;
        const frame = Math.round(timeline.currentTime * timeline.framerate);
        return (
            <section
                aria-label="Timeline"
                className={styles.timeline}
                ref={element => {
                    this.timelineElement = element;
                }}
            >
                {this.renderSettings()}
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <strong>{'Timeline'}</strong>
                        <span>{timeline.framerate}{' FPS · frame '}{frame}</span>
                    </div>
                    <div className={styles.headerActions}>
                        <div
                            className={styles.addonControls}
                            data-movie-timeline-addons
                        />
                        <output
                            aria-live="off"
                            className={styles.timecode}
                        >
                            {formatTime(timeline.currentTime)} <span>{'/ '}{formatTime(timeline.duration)}</span>
                        </output>
                        <button
                            aria-expanded={this.state.settingsOpen}
                            className={classNames(styles.iconButton, {
                                [styles.isActive]: this.state.settingsOpen
                            })}
                            disabled={timeline.recording}
                            title="Rendering settings"
                            type="button"
                            onClick={this.handleToggleSettings}
                        >{'⚙'}</button>
                    </div>
                </div>
                <div className={styles.scrubber}>
                    <input
                        aria-label="Current timeline position"
                        max={timeline.duration}
                        min="0"
                        disabled={timeline.recording}
                        step="0.001"
                        style={{backgroundSize: `${progress}% 100%`}}
                        type="range"
                        value={timeline.currentTime}
                        onChange={this.handleSeek}
                        ref={element => {
                            this.scrubberElement = element;
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className={styles.ruler}
                    >
                        {[0, 0.25, 0.5, 0.75, 1].map(position => (
                            <span key={position}>{(timeline.duration * position).toFixed(1)}{'s'}</span>
                        ))}
                    </div>
                </div>
                <div className={styles.transport}>
                    <button
                        aria-label={timeline.playing ? 'Pause' : 'Play'}
                        className={styles.playButton}
                        title={timeline.playing ? 'Pause (Space)' : 'Play (Space)'}
                        type="button"
                        onClick={this.handlePlayPause}
                    >{timeline.playing ? 'Ⅱ' : '▶'}</button>
                    <button
                        aria-label="Stop and return to start"
                        className={styles.stopButton}
                        type="button"
                        onClick={this.handleStop}
                    ><span /></button>
                    <span className={styles.status}>
                        {timeline.recording ? (timeline.playing ? 'Rendering' : 'Render paused') :
                            (timeline.playing ? 'Playing' : 'Paused')}
                        {' at '}{timeline.currentTime.toFixed(2)}{'s'}
                    </span>
                    <span className={styles.frameCount}>{timeline.frameCount}{' rendered frames'}</span>
                </div>
            </section>
        );
    }
}

Timeline.propTypes = {
    customStageSize: PropTypes.shape({
        height: PropTypes.number.isRequired,
        width: PropTypes.number.isRequired
    }).isRequired,
    framerate: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export {Timeline};
export default Timeline;
