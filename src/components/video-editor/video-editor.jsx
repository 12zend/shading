import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import styles from './video-editor.css';

import playIcon from '../sound-editor/icon--play.svg';
import stopIcon from '../sound-editor/icon--stop.svg';

const messages = defineMessages({
    video: {
        defaultMessage: 'Video',
        description: 'Label for the name of a video',
        id: 'movie.video.editor.video'
    },
    cutRange: {
        defaultMessage: 'Cut range',
        description: 'Heading for the video cut range controls',
        id: 'movie.video.editor.cutRange'
    },
    play: {
        defaultMessage: 'Play selection',
        description: 'Title of the button to play the selected video range',
        id: 'movie.video.editor.play'
    },
    stop: {
        defaultMessage: 'Stop',
        description: 'Title of the button to stop video playback',
        id: 'movie.video.editor.stop'
    },
    setStart: {
        defaultMessage: 'Set start',
        description: 'Button to set the start of a video cut at the playhead',
        id: 'movie.video.editor.setStart'
    },
    setEnd: {
        defaultMessage: 'Set end',
        description: 'Button to set the end of a video cut at the playhead',
        id: 'movie.video.editor.setEnd'
    },
    keepRange: {
        defaultMessage: 'Keep selection',
        description: 'Button to save the selected video range',
        id: 'movie.video.editor.keepRange'
    },
    resetCut: {
        defaultMessage: 'Reset cut',
        description: 'Button to restore the full video range',
        id: 'movie.video.editor.resetCut'
    },
    start: {
        defaultMessage: 'Start',
        description: 'Label for the start of a video cut',
        id: 'movie.video.editor.start'
    },
    end: {
        defaultMessage: 'End',
        description: 'Label for the end of a video cut',
        id: 'movie.video.editor.end'
    },
    original: {
        defaultMessage: 'Original',
        description: 'Label for the original video duration',
        id: 'movie.video.editor.original'
    },
    selection: {
        defaultMessage: 'Selection',
        description: 'Label for the selected video duration',
        id: 'movie.video.editor.selection'
    },
    selected: {
        defaultMessage: 'selected',
        description: 'Text shown after the selected video duration',
        id: 'movie.video.editor.selected'
    },
    help: {
        defaultMessage: 'Set the start and end points, then keep the selection. The cut is saved without ' +
            'changing the source file.',
        description: 'Help text for the video editor',
        id: 'movie.video.editor.help'
    }
});

const MIN_RANGE_SECONDS = 1 / 30;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const formatTime = timeSeconds => {
    const time = Number.isFinite(Number(timeSeconds)) ? Math.max(0, Number(timeSeconds)) : 0;
    const minutes = Math.floor(time / 60).toString()
        .padStart(2, '0');
    const seconds = (time % 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds}`;
};

const getSourceDuration = video => {
    const sourceDuration = Number(video && video.sourceDuration);
    if (Number.isFinite(sourceDuration) && sourceDuration >= 0) return sourceDuration;
    const duration = Number(video && video.duration);
    return Number.isFinite(duration) && duration >= 0 ? duration : 0;
};

const getVideoBounds = video => {
    const sourceDuration = getSourceDuration(video);
    const requestedStart = Number(video && video.trimStart);
    const requestedEnd = Number(video && video.trimEnd);
    const trimStart = clamp(
        Number.isFinite(requestedStart) ? requestedStart : 0,
        0,
        sourceDuration
    );
    const trimEnd = clamp(
        Number.isFinite(requestedEnd) ? requestedEnd : sourceDuration,
        trimStart,
        sourceDuration
    );
    return {sourceDuration, trimEnd, trimStart};
};

class VideoEditor extends React.Component {
    constructor (props) {
        super(props);
        const bounds = getVideoBounds(props.video);
        this.state = {
            playhead: bounds.trimStart,
            playing: false,
            trimEnd: bounds.trimEnd,
            trimStart: bounds.trimStart
        };
        this.videoElement = null;
        this.setVideoRef = this.setVideoRef.bind(this);
        this.handleEnded = this.handleEnded.bind(this);
        this.handleLoadedMetadata = this.handleLoadedMetadata.bind(this);
        this.handlePause = this.handlePause.bind(this);
        this.handlePlay = this.handlePlay.bind(this);
        this.handlePlaying = this.handlePlaying.bind(this);
        this.handlePlayheadChange = this.handlePlayheadChange.bind(this);
        this.handleSetEnd = this.handleSetEnd.bind(this);
        this.handleSetStart = this.handleSetStart.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.handleTrim = this.handleTrim.bind(this);
        this.handleTrimEndChange = this.handleTrimEndChange.bind(this);
        this.handleTrimStartChange = this.handleTrimStartChange.bind(this);
        this.handleResetTrim = this.handleResetTrim.bind(this);
    }

    componentDidMount () {
        this.setVideoPosition(this.state.playhead);
    }

    componentDidUpdate (previousProps) {
        const previousBounds = getVideoBounds(previousProps.video);
        const bounds = getVideoBounds(this.props.video);
        const assetChanged = previousProps.video.assetId !== this.props.video.assetId;
        const editChanged = previousBounds.sourceDuration !== bounds.sourceDuration ||
            previousBounds.trimStart !== bounds.trimStart || previousBounds.trimEnd !== bounds.trimEnd;
        if (assetChanged || editChanged) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({
                playhead: bounds.trimStart,
                playing: false,
                trimEnd: bounds.trimEnd,
                trimStart: bounds.trimStart
            });
            if (this.videoElement) {
                this.videoElement.pause();
                this.setVideoPosition(bounds.trimStart);
            }
        }
    }

    componentWillUnmount () {
        if (this.videoElement) this.videoElement.pause();
    }

    getSourceDuration () {
        return getSourceDuration(this.props.video);
    }

    getMinimumRange () {
        return Math.min(MIN_RANGE_SECONDS, this.getSourceDuration());
    }

    setVideoRef (element) {
        this.videoElement = element;
    }

    setVideoPosition (time) {
        const duration = this.getSourceDuration();
        const position = clamp(Number(time) || 0, 0, duration);
        if (this.videoElement && Math.abs(Number(this.videoElement.currentTime) - position) > 0.001) {
            this.videoElement.currentTime = position;
        }
    }

    handleLoadedMetadata () {
        this.setVideoPosition(this.state.playhead);
    }

    handlePlay () {
        if (!this.videoElement) return;
        const {trimEnd, trimStart} = this.state;
        const playhead = this.state.playhead < trimStart || this.state.playhead >= trimEnd ?
            trimStart : this.state.playhead;
        this.setVideoPosition(playhead);
        const playResult = this.videoElement.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(error => {
                if (error && error.name !== 'AbortError' && this.props.onError) this.props.onError(error);
                this.setState({playing: false});
            });
        }
        this.setState({playhead, playing: true});
    }

    handlePause (event) {
        if (!event && this.videoElement) this.videoElement.pause();
        this.setState({playing: false});
    }

    handlePlaying () {
        const {playhead, trimEnd, trimStart} = this.state;
        if (this.videoElement && (playhead < trimStart || playhead >= trimEnd)) {
            this.setVideoPosition(trimStart);
            this.setState({playhead: trimStart, playing: true});
            return;
        }
        this.setState({playing: true});
    }

    handleTimeUpdate (event) {
        const currentTime = Number(event.currentTarget.currentTime) || 0;
        if (currentTime >= this.state.trimEnd && this.state.trimEnd > this.state.trimStart) {
            event.currentTarget.pause();
            this.setVideoPosition(this.state.trimEnd);
            this.setState({playhead: this.state.trimEnd, playing: false});
            return;
        }
        this.setState({playhead: currentTime});
    }

    handleEnded () {
        this.setState({playhead: this.state.trimEnd, playing: false});
    }

    handlePlayheadChange (event) {
        const playhead = clamp(Number(event.target.value) || 0, 0, this.getSourceDuration());
        this.setVideoPosition(playhead);
        this.setState({playhead});
    }

    handleTrimStartChange (event) {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        const maximum = Math.max(0, this.state.trimEnd - this.getMinimumRange());
        const trimStart = clamp(value, 0, maximum);
        this.setState({trimStart});
        this.handlePause();
    }

    handleTrimEndChange (event) {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        const minimum = Math.min(
            this.getSourceDuration(),
            this.state.trimStart + this.getMinimumRange()
        );
        const trimEnd = clamp(value, minimum, this.getSourceDuration());
        this.setState({trimEnd});
        this.handlePause();
    }

    handleSetStart () {
        const maximum = Math.max(0, this.state.trimEnd - this.getMinimumRange());
        this.setState({trimStart: clamp(this.state.playhead, 0, maximum)});
        this.handlePause();
    }

    handleSetEnd () {
        const minimum = Math.min(
            this.getSourceDuration(),
            this.state.trimStart + this.getMinimumRange()
        );
        this.setState({trimEnd: clamp(this.state.playhead, minimum, this.getSourceDuration())});
        this.handlePause();
    }

    handleTrim () {
        if (!this.props.onTrim) return;
        this.handlePause();
        this.props.onTrim(this.state.trimStart, this.state.trimEnd);
    }

    handleResetTrim () {
        const sourceDuration = this.getSourceDuration();
        this.handlePause();
        this.setState({playhead: 0, trimEnd: sourceDuration, trimStart: 0});
        if (this.props.onTrim) this.props.onTrim(0, sourceDuration);
    }

    render () {
        const {intl, onChangeName, video} = this.props;
        const {playhead, playing, trimEnd, trimStart} = this.state;
        const sourceDuration = this.getSourceDuration();
        const selectedDuration = Math.max(0, trimEnd - trimStart);
        const selectionLeft = sourceDuration > 0 ? (trimStart / sourceDuration) * 100 : 0;
        const selectionWidth = sourceDuration > 0 ? (selectedDuration / sourceDuration) * 100 : 100;
        const playheadPosition = sourceDuration > 0 ? (playhead / sourceDuration) * 100 : 0;
        const isFullRange = trimStart <= 0.001 && trimEnd >= sourceDuration - 0.001;
        const rangeStep = sourceDuration > 0 ? 0.01 : 1;

        return (
            <div className={styles.editorContainer}>
                <div className={styles.toolbar}>
                    <label className={styles.nameLabel}>
                        <span>{intl.formatMessage(messages.video)}</span>
                        <input
                            className={styles.nameInput}
                            defaultValue={video.name}
                            key={video.name}
                            onBlur={onChangeName}
                        />
                    </label>
                    <div className={styles.toolbarMeta}>
                        <span>{`${video.width} × ${video.height}`}</span>
                        <span>{`${formatTime(selectedDuration)} ${intl.formatMessage(messages.selected)}`}</span>
                    </div>
                </div>

                <div className={styles.previewArea}>
                    <video
                        className={styles.previewVideo}
                        controls
                        key={video.assetId}
                        playsInline
                        preload="metadata"
                        ref={this.setVideoRef}
                        src={video.url}
                        onEnded={this.handleEnded}
                        onLoadedMetadata={this.handleLoadedMetadata}
                        onPause={this.handlePause}
                        onPlay={this.handlePlaying}
                        onTimeUpdate={this.handleTimeUpdate}
                    />
                </div>

                <div className={styles.editArea}>
                    <div className={styles.sectionHeader}>
                        <strong>{intl.formatMessage(messages.cutRange)}</strong>
                        <span>{`${formatTime(playhead)} / ${formatTime(sourceDuration)}`}</span>
                    </div>
                    <div className={styles.timelineTrack}>
                        <div className={styles.trackBase} />
                        <div
                            className={styles.selectedTrack}
                            style={{left: `${selectionLeft}%`, width: `${selectionWidth}%`}}
                        />
                        <div
                            aria-hidden="true"
                            className={styles.playhead}
                            style={{left: `${playheadPosition}%`}}
                        />
                    </div>
                    <input
                        aria-label={intl.formatMessage(messages.play)}
                        className={styles.scrubber}
                        max={sourceDuration}
                        min="0"
                        step={rangeStep}
                        type="range"
                        value={playhead}
                        onChange={this.handlePlayheadChange}
                    />
                    <div className={styles.rangeControls}>
                        <label className={styles.timeInput}>
                            <span>{intl.formatMessage(messages.start)}</span>
                            <input
                                max={Math.max(0, trimEnd - this.getMinimumRange())}
                                min="0"
                                step={rangeStep}
                                type="range"
                                value={trimStart}
                                onChange={this.handleTrimStartChange}
                            />
                            <output>{formatTime(trimStart)}</output>
                        </label>
                        <label className={styles.timeInput}>
                            <span>{intl.formatMessage(messages.end)}</span>
                            <input
                                max={sourceDuration}
                                min={Math.min(sourceDuration, trimStart + this.getMinimumRange())}
                                step={rangeStep}
                                type="range"
                                value={trimEnd}
                                onChange={this.handleTrimEndChange}
                            />
                            <output>{formatTime(trimEnd)}</output>
                        </label>
                    </div>

                    <div className={styles.controls}>
                        <button
                            aria-label={intl.formatMessage(playing ? messages.stop : messages.play)}
                            className={styles.roundButton}
                            onClick={playing ? this.handlePause : this.handlePlay}
                        >
                            <img
                                alt=""
                                draggable={false}
                                src={playing ? stopIcon : playIcon}
                            />
                        </button>
                        <button
                            className={styles.secondaryButton}
                            onClick={this.handleSetStart}
                        >
                            {intl.formatMessage(messages.setStart)}
                        </button>
                        <button
                            className={styles.secondaryButton}
                            onClick={this.handleSetEnd}
                        >
                            {intl.formatMessage(messages.setEnd)}
                        </button>
                        <button
                            className={styles.primaryButton}
                            disabled={isFullRange}
                            onClick={this.handleTrim}
                        >
                            {intl.formatMessage(messages.keepRange)}
                        </button>
                        <button
                            className={styles.secondaryButton}
                            disabled={isFullRange}
                            onClick={this.handleResetTrim}
                        >
                            {intl.formatMessage(messages.resetCut)}
                        </button>
                    </div>

                    <div className={styles.infoRow}>
                        <span>{`${intl.formatMessage(messages.selection)}: ${formatTime(selectedDuration)}`}</span>
                        <span>{`${intl.formatMessage(messages.original)}: ${formatTime(sourceDuration)}`}</span>
                    </div>
                    <div className={styles.hint}>{intl.formatMessage(messages.help)}</div>
                    {this.props.error ? <div className={styles.error}>{this.props.error}</div> : null}
                </div>
            </div>
        );
    }
}

VideoEditor.propTypes = {
    intl: intlShape.isRequired,
    onChangeName: PropTypes.func.isRequired,
    onError: PropTypes.func,
    onTrim: PropTypes.func.isRequired,
    error: PropTypes.string,
    video: PropTypes.shape({
        assetId: PropTypes.string.isRequired,
        duration: PropTypes.number.isRequired,
        name: PropTypes.string.isRequired,
        url: PropTypes.string.isRequired,
        width: PropTypes.number,
        height: PropTypes.number
    }).isRequired
};

export {VideoEditor as UnwrappedVideoEditor};
export default injectIntl(VideoEditor);
