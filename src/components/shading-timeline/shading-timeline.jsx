import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';

import pauseIcon from './icon--pause.svg';
import playIcon from './icon--play.svg';
import settingsIcon from './icon--settings.svg';
import stopIcon from './icon--stop.svg';
import styles from './shading-timeline.css';

const ZOOM_MIN = 50;
const ZOOM_MAX = 1000;

const RENDER_PRESETS = [
    {label: 'HD 1280 × 720', width: 1280, height: 720},
    {label: 'Full HD 1920 × 1080', width: 1920, height: 1080},
    {label: 'QHD 2560 × 1440', width: 2560, height: 1440},
    {label: '4K 3840 × 2160', width: 3840, height: 2160}
];

const FRAMERATE_PRESETS = [24, 30, 60];

const MIN_RENDER_SIZE = 16;
const MAX_RENDER_SIZE = 7680;
const MIN_RENDER_FRAMERATE = 1;
const MAX_RENDER_FRAMERATE = 120;

const formatTime = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const remaining = value - (minutes * 60);
    return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`;
};

const niceTickStep = (duration, zoom) => {
    const target = duration / (Math.max(1, zoom / 100) * 6);
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find(value => value >= target) || candidates[candidates.length - 1];
};

const timelineTicks = (duration, zoom) => {
    const step = niceTickStep(duration, zoom);
    const result = [];
    for (let time = 0; time <= duration + (step / 2); time += step) {
        result.push(Math.min(time, duration));
    }
    if (result[result.length - 1] !== duration) result.push(duration);
    return result;
};

const tickLabel = time => (time < 60 ? `${Number(time.toFixed(2))}s` : formatTime(time));

const clampInt = (value, minimum, maximum, fallback) => {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
};

const presetKeyForSize = (width, height) => {
    const found = RENDER_PRESETS.find(preset => preset.width === width && preset.height === height);
    return found ? `${found.width}x${found.height}` : 'custom';
};

class ShadingTimelineComponent extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKeyDown',
            'handlePlayPause',
            'handleStop',
            'handleScrubberChange',
            'handleDurationBlur',
            'handleDurationKeyDown',
            'handleRulerMouseDown',
            'handleRulerMouseMove',
            'handleRulerMouseUp',
            'handleWheel',
            'handleOpenSettings',
            'handleCloseSettings',
            'handleOverlayMouseDown',
            'handlePresetChange',
            'handleDraftWidthChange',
            'handleDraftHeightChange',
            'handleDraftFramerateChange',
            'handleFrameratePreset',
            'handleSaveSettings',
            'handleRender',
            'handleCancelRender',
            'handleSettingsKeyDown'
        ]);
        this.rulerRef = React.createRef();
        this.viewportRef = React.createRef();
        this.rulerDragging = false;
        this.zoomAnchor = null;
        this.renderAbortController = null;
        this.state = {
            draftFramerate: props.renderFramerate,
            draftHeight: props.renderHeight,
            draftPreset: presetKeyForSize(props.renderWidth, props.renderHeight),
            draftWidth: props.renderWidth,
            isRendering: false,
            isSettingsOpen: false,
            renderCurrentTime: 0,
            renderError: null,
            renderProgress: 0
        };
    }

    componentDidMount () {
        // Pinch zoom uses ctrl/meta + wheel, which needs a non-passive listener.
        const viewport = this.viewportRef.current;
        if (viewport && typeof viewport.addEventListener === 'function') {
            viewport.addEventListener('wheel', this.handleWheel, {passive: false});
        }
    }

    componentDidUpdate (prevProps) {
        if (this.zoomAnchor && prevProps.zoom !== this.props.zoom) {
            const viewport = this.viewportRef.current;
            if (viewport) {
                viewport.scrollLeft =
                    (this.zoomAnchor.fraction * viewport.scrollWidth) - this.zoomAnchor.cursorX;
            }
            this.zoomAnchor = null;
        }
        if (!this.state.isSettingsOpen && !this.state.isRendering &&
            (prevProps.renderWidth !== this.props.renderWidth ||
                prevProps.renderHeight !== this.props.renderHeight ||
                prevProps.renderFramerate !== this.props.renderFramerate)) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({
                draftFramerate: this.props.renderFramerate,
                draftHeight: this.props.renderHeight,
                draftPreset: presetKeyForSize(this.props.renderWidth, this.props.renderHeight),
                draftWidth: this.props.renderWidth
            });
        }
    }

    componentWillUnmount () {
        this.handleRulerMouseUp();
        if (this.renderAbortController) {
            this.renderAbortController.abort();
            this.renderAbortController = null;
        }
        const viewport = this.viewportRef.current;
        if (viewport && typeof viewport.removeEventListener === 'function') {
            viewport.removeEventListener('wheel', this.handleWheel);
        }
    }

    handleWheel (event) {
        const viewport = this.viewportRef.current;
        if (!viewport) return;
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const factor = Math.exp(-event.deltaY * 0.01);
            const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.props.zoom * factor)));
            if (next !== this.props.zoom) {
                const rect = viewport.getBoundingClientRect();
                this.zoomAnchor = {
                    cursorX: event.clientX - rect.left,
                    fraction: (viewport.scrollLeft + event.clientX - rect.left) / viewport.scrollWidth
                };
                this.props.onChangeZoom(next);
            }
            return;
        }
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
            viewport.scrollWidth > viewport.clientWidth) {
            event.preventDefault();
            viewport.scrollLeft += event.deltaY;
        }
    }

    seekFromRulerEvent (event) {
        const ruler = this.rulerRef.current;
        if (!ruler || typeof ruler.getBoundingClientRect !== 'function') return;
        const rect = ruler.getBoundingClientRect();
        const fraction = (event.clientX - rect.left) / rect.width;
        this.props.onSeek(Math.min(1, Math.max(0, fraction)) * this.props.duration);
    }

    handleRulerMouseDown (event) {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        this.rulerDragging = true;
        this.seekFromRulerEvent(event);
        window.addEventListener('mousemove', this.handleRulerMouseMove);
        window.addEventListener('mouseup', this.handleRulerMouseUp);
    }

    handleRulerMouseMove (event) {
        if (this.rulerDragging) this.seekFromRulerEvent(event);
    }

    handleRulerMouseUp () {
        if (!this.rulerDragging) return;
        this.rulerDragging = false;
        window.removeEventListener('mousemove', this.handleRulerMouseMove);
        window.removeEventListener('mouseup', this.handleRulerMouseUp);
    }

    handleKeyDown (event) {
        if (this.state.isSettingsOpen) {
            if (event.key === 'Escape' && !this.state.isRendering) this.handleCloseSettings();
            return;
        }
        const target = event.target || {};
        const tagName = String(target.tagName || '').toLowerCase();
        const isTextInput = tagName === 'textarea' ||
            (tagName === 'input' && target.type !== 'range');
        if (isTextInput || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === ' ' && tagName !== 'button') {
            event.preventDefault();
            this.props.onPlayPause();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            this.props.onStep(-1);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            this.props.onStep(1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            this.props.onSeek(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            this.props.onSeek(this.props.duration);
        }
    }

    handlePlayPause () {
        if (!this.state.isRendering) this.props.onPlayPause();
    }

    handleStop () {
        if (!this.state.isRendering) this.props.onStop();
    }

    handleScrubberChange (event) {
        if (!this.state.isRendering) this.props.onSeek(event.target.value);
    }

    handleDurationBlur (event) {
        this.props.onChangeDuration(event.target.value);
    }

    handleDurationKeyDown (event) {
        if (event.key === 'Enter') event.currentTarget.blur();
    }

    handleOpenSettings () {
        this.setState({
            draftFramerate: this.props.renderFramerate,
            draftHeight: this.props.renderHeight,
            draftPreset: presetKeyForSize(this.props.renderWidth, this.props.renderHeight),
            draftWidth: this.props.renderWidth,
            isSettingsOpen: true,
            renderCurrentTime: 0,
            renderError: null,
            renderProgress: 0
        });
    }

    handleCloseSettings () {
        if (!this.state.isRendering) this.setState({isSettingsOpen: false, renderError: null});
    }

    handleOverlayMouseDown (event) {
        if (event.target === event.currentTarget) this.handleCloseSettings();
    }

    handlePresetChange (event) {
        const value = event.target.value;
        if (value === 'custom') {
            this.setState({draftPreset: value});
            return;
        }
        const [width, height] = value.split('x').map(Number);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            this.setState({draftHeight: height, draftPreset: value, draftWidth: width});
        }
    }

    handleDraftWidthChange (event) {
        const width = clampInt(event.target.value, MIN_RENDER_SIZE, MAX_RENDER_SIZE, this.state.draftWidth);
        this.setState({
            draftPreset: presetKeyForSize(width, this.state.draftHeight),
            draftWidth: width
        });
    }

    handleDraftHeightChange (event) {
        const height = clampInt(event.target.value, MIN_RENDER_SIZE, MAX_RENDER_SIZE, this.state.draftHeight);
        this.setState({
            draftHeight: height,
            draftPreset: presetKeyForSize(this.state.draftWidth, height)
        });
    }

    handleDraftFramerateChange (event) {
        this.setState({
            draftFramerate: clampInt(
                event.target.value,
                MIN_RENDER_FRAMERATE,
                MAX_RENDER_FRAMERATE,
                this.state.draftFramerate
            )
        });
    }

    handleFrameratePreset (event) {
        const framerate = Number(event.currentTarget.getAttribute('data-framerate'));
        if (Number.isFinite(framerate)) this.setState({draftFramerate: framerate});
    }

    handleSaveSettings () {
        if (this.state.isRendering) return;
        this.props.onChangeRenderSettings({
            framerate: this.state.draftFramerate,
            height: this.state.draftHeight,
            width: this.state.draftWidth
        });
        this.setState({isSettingsOpen: false});
    }

    handleRender () {
        if (this.state.isRendering || typeof this.props.onRender !== 'function') return;
        const width = clampInt(
            this.state.draftWidth,
            MIN_RENDER_SIZE,
            MAX_RENDER_SIZE,
            this.props.renderWidth
        );
        const height = clampInt(
            this.state.draftHeight,
            MIN_RENDER_SIZE,
            MAX_RENDER_SIZE,
            this.props.renderHeight
        );
        const framerate = clampInt(
            this.state.draftFramerate,
            MIN_RENDER_FRAMERATE,
            MAX_RENDER_FRAMERATE,
            this.props.renderFramerate
        );
        this.props.onChangeRenderSettings({framerate, height, width});
        const abortController = typeof AbortController === 'undefined' ? null : new AbortController();
        this.renderAbortController = abortController;
        this.setState({
            draftFramerate: framerate,
            draftHeight: height,
            draftPreset: presetKeyForSize(width, height),
            draftWidth: width,
            isRendering: true,
            renderCurrentTime: 0,
            renderError: null,
            renderProgress: 0
        });

        const onProgress = progress => this.setState({
            renderCurrentTime: progress.currentTime,
            renderProgress: progress.progress
        });
        let renderPromise;
        try {
            renderPromise = this.props.onRender({
                framerate,
                height,
                onProgress,
                signal: abortController ? abortController.signal : null,
                width
            });
        } catch (error) {
            this.renderAbortController = null;
            this.setState({
                isRendering: false,
                renderError: (error && error.message) || 'Rendering failed'
            });
            return;
        }
        Promise.resolve(renderPromise)
            .then(() => {
                this.renderAbortController = null;
                this.setState({isRendering: false, isSettingsOpen: false, renderProgress: 1});
            })
            .catch(error => {
                this.renderAbortController = null;
                if (error && error.name === 'AbortError') {
                    this.setState({isRendering: false, renderError: null});
                    return;
                }
                this.setState({
                    isRendering: false,
                    renderError: (error && error.message) || 'Rendering failed'
                });
            });
    }

    handleCancelRender () {
        if (this.renderAbortController) this.renderAbortController.abort();
    }

    handleSettingsKeyDown (event) {
        if (event.key === 'Escape' && !this.state.isRendering) this.handleCloseSettings();
        event.stopPropagation();
    }

    renderSettingsDialog () {
        const {duration} = this.props;
        const {draftFramerate, draftHeight, draftPreset, draftWidth, isRendering} = this.state;
        const totalFrames = Math.max(1, Math.round(Number(duration || 0) * Number(draftFramerate || 0)));
        const progressPercent = Math.round(this.state.renderProgress * 100);
        return (
            <div
                className={styles.settingsOverlay}
                onMouseDown={this.handleOverlayMouseDown}
            >
                <div
                    aria-label="Render settings"
                    aria-modal="true"
                    className={styles.settingsDialog}
                    role="dialog"
                    onKeyDown={this.handleSettingsKeyDown}
                >
                    <div className={styles.settingsHeader}>
                        <span className={styles.settingsTitle}>{'Output and render settings'}</span>
                        <button
                            aria-label="Close render settings"
                            className={styles.settingsClose}
                            disabled={isRendering}
                            type="button"
                            onClick={this.handleCloseSettings}
                        >
                            {'×'}
                        </button>
                    </div>
                    <div className={styles.settingsBody}>
                        <label className={styles.settingsRow}>
                            <span className={styles.settingsLabel}>{'Output resolution'}</span>
                            <select
                                aria-label="Output resolution preset"
                                className={styles.settingsSelect}
                                disabled={isRendering}
                                value={draftPreset}
                                onChange={this.handlePresetChange}
                            >
                                {RENDER_PRESETS.map(preset => (
                                    <option
                                        key={`${preset.width}x${preset.height}`}
                                        value={`${preset.width}x${preset.height}`}
                                    >
                                        {preset.label}
                                    </option>
                                ))}
                                <option value="custom">{'Custom'}</option>
                            </select>
                        </label>
                        <div className={styles.settingsRow}>
                            <span className={styles.settingsLabel}>{'Width × height'}</span>
                            <span className={styles.sizeInputs}>
                                <input
                                    aria-label="Output width in pixels"
                                    className={styles.settingsInput}
                                    disabled={isRendering}
                                    max={MAX_RENDER_SIZE}
                                    min={MIN_RENDER_SIZE}
                                    step="1"
                                    type="number"
                                    value={draftWidth}
                                    onChange={this.handleDraftWidthChange}
                                />
                                <span>{'×'}</span>
                                <input
                                    aria-label="Output height in pixels"
                                    className={styles.settingsInput}
                                    disabled={isRendering}
                                    max={MAX_RENDER_SIZE}
                                    min={MIN_RENDER_SIZE}
                                    step="1"
                                    type="number"
                                    value={draftHeight}
                                    onChange={this.handleDraftHeightChange}
                                />
                                <span>{'px'}</span>
                            </span>
                        </div>
                        <div className={styles.settingsRow}>
                            <span className={styles.settingsLabel}>
                                {'Framerate'}
                                <span className={styles.settingsHint}>{' (export)'}</span>
                            </span>
                            <span className={styles.framerateInputs}>
                                <span className={styles.frameratePresets}>
                                    {FRAMERATE_PRESETS.map(value => (
                                        <button
                                            className={draftFramerate === value ?
                                                styles.frameratePresetActive : styles.frameratePreset}
                                            data-framerate={value}
                                            disabled={isRendering}
                                            key={value}
                                            type="button"
                                            onClick={this.handleFrameratePreset}
                                        >
                                            {value}
                                        </button>
                                    ))}
                                </span>
                                <span className={styles.framerateCustom}>
                                    <input
                                        aria-label="Output framerate"
                                        className={styles.settingsInput}
                                        disabled={isRendering}
                                        max={MAX_RENDER_FRAMERATE}
                                        min={MIN_RENDER_FRAMERATE}
                                        step="1"
                                        type="number"
                                        value={draftFramerate}
                                        onChange={this.handleDraftFramerateChange}
                                    />
                                    <span>{'fps'}</span>
                                </span>
                            </span>
                        </div>
                        <div className={styles.settingsSummary}>
                            {`Output: ${draftWidth}×${draftHeight} / ${draftFramerate}fps / ` +
                                `${formatTime(duration)} / ${totalFrames} frames`}
                        </div>
                        {this.state.renderError ? (
                            <div className={styles.settingsError}>{this.state.renderError}</div>
                        ) : null}
                        {isRendering ? (
                            <div className={styles.renderProgress}>
                                <div className={styles.renderProgressTrack}>
                                    <div
                                        className={styles.renderProgressBar}
                                        style={{transform: `scaleX(${this.state.renderProgress})`}}
                                    />
                                </div>
                                <span className={styles.renderProgressLabel}>
                                    {`Rendering ${progressPercent}% ` +
                                        `(${formatTime(this.state.renderCurrentTime)} / ${formatTime(duration)})`}
                                </span>
                            </div>
                        ) : null}
                    </div>
                    <div className={styles.settingsFooter}>
                        {isRendering ? (
                            <button
                                className={styles.settingsCancel}
                                type="button"
                                onClick={this.handleCancelRender}
                            >
                                {'Cancel'}
                            </button>
                        ) : (
                            <button
                                className={styles.settingsCancel}
                                type="button"
                                onClick={this.handleCloseSettings}
                            >
                                {'Close'}
                            </button>
                        )}
                        {isRendering ? null : (
                            <button
                                className={styles.settingsGhost}
                                type="button"
                                onClick={this.handleSaveSettings}
                            >
                                {'Save'}
                            </button>
                        )}
                        <button
                            className={styles.settingsRender}
                            disabled={isRendering}
                            type="button"
                            onClick={this.handleRender}
                        >
                            {isRendering ? 'Rendering…' : 'Render MP4'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    render () {
        const {currentTime, duration, isPlaying, zoom} = this.props;
        const ticks = timelineTicks(duration, zoom);
        const timelineWidth = `${Math.max(100, zoom)}%`;
        return (
            <section
                aria-label="Timeline"
                className={styles.timeline}
                tabIndex={0}
                onKeyDown={this.handleKeyDown}
            >
                <div className={styles.toolbar}>
                    <div className={styles.transport}>
                        <button
                            aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
                            className={styles.primaryButton}
                            disabled={this.state.isRendering}
                            title={isPlaying ? 'Pause' : 'Play'}
                            type="button"
                            onClick={this.handlePlayPause}
                        >
                            <img
                                alt=""
                                draggable={false}
                                src={isPlaying ? pauseIcon : playIcon}
                            />
                        </button>
                        <button
                            aria-label="Stop and return to start"
                            className={styles.iconButton}
                            disabled={this.state.isRendering}
                            title="Stop and return to start"
                            type="button"
                            onClick={this.handleStop}
                        >
                            <img
                                alt=""
                                draggable={false}
                                src={stopIcon}
                            />
                        </button>
                    </div>
                    <div className={styles.readout}>
                        <span className={styles.liveDot} />
                        <span>{formatTime(currentTime)}</span>
                        <span className={styles.readoutDivider}>{'/'}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                    <label className={styles.durationControl}>
                        <span>{'Duration'}</span>
                        <input
                            aria-label="Timeline duration in seconds"
                            defaultValue={duration}
                            key={duration}
                            max="3600"
                            min="0.1"
                            step="0.1"
                            type="number"
                            onBlur={this.handleDurationBlur}
                            onKeyDown={this.handleDurationKeyDown}
                        />
                        <span>{'s'}</span>
                    </label>
                    <button
                        aria-label="Open render settings"
                        className={styles.settingsButton}
                        title="Output and render settings"
                        type="button"
                        onClick={this.handleOpenSettings}
                    >
                        <img
                            alt=""
                            draggable={false}
                            src={settingsIcon}
                        />
                    </button>
                </div>
                <div
                    className={styles.timelineViewport}
                    ref={this.viewportRef}
                >
                    <div
                        className={styles.timelineContent}
                        style={{width: timelineWidth}}
                    >
                        <div
                            className={styles.ruler}
                            ref={this.rulerRef}
                            onMouseDown={this.handleRulerMouseDown}
                        >
                            {ticks.map(time => (
                                <span
                                    className={styles.tickLabel}
                                    key={time}
                                    style={{left: `${(time / duration) * 100}%`}}
                                >
                                    {tickLabel(time)}
                                </span>
                            ))}
                        </div>
                        <div className={styles.track}>
                            <div
                                className={styles.elapsed}
                                style={{width: `${(currentTime / duration) * 100}%`}}
                            />
                            <input
                                aria-label="Timeline position"
                                className={styles.scrubber}
                                dir="ltr"
                                max={duration}
                                min="0"
                                step="0.001"
                                type="range"
                                value={currentTime}
                                onChange={this.handleScrubberChange}
                            />
                        </div>
                    </div>
                </div>
                {this.state.isSettingsOpen ? this.renderSettingsDialog() : null}
            </section>
        );
    }
}

ShadingTimelineComponent.propTypes = {
    currentTime: PropTypes.number.isRequired,
    duration: PropTypes.number.isRequired,
    isPlaying: PropTypes.bool.isRequired,
    onChangeDuration: PropTypes.func.isRequired,
    onChangeRenderSettings: PropTypes.func,
    onChangeZoom: PropTypes.func.isRequired,
    onPlayPause: PropTypes.func.isRequired,
    onRender: PropTypes.func,
    onSeek: PropTypes.func.isRequired,
    onStep: PropTypes.func.isRequired,
    onStop: PropTypes.func.isRequired,
    renderFramerate: PropTypes.number,
    renderHeight: PropTypes.number,
    renderWidth: PropTypes.number,
    zoom: PropTypes.number.isRequired
};

ShadingTimelineComponent.defaultProps = {
    onChangeRenderSettings: () => {},
    onRender: null,
    renderFramerate: 30,
    renderHeight: 1080,
    renderWidth: 1920
};

export {
    formatTime,
    niceTickStep,
    timelineTicks
};
export default ShadingTimelineComponent;
