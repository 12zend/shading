import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import ShadingTimelineComponent from '../components/shading-timeline/shading-timeline.jsx';
import downloadBlob from '../lib/download-blob';
import {
    DEFAULT_RENDER_FRAMERATE,
    DEFAULT_RENDER_HEIGHT,
    DEFAULT_RENDER_WIDTH,
    installShadingTimeline
} from '../lib/shading/runtime/timeline';
import exportTimelineVideo from '../lib/shading/export-video';

class ShadingTimeline extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            currentTime: 0,
            duration: 10,
            isPlaying: false,
            renderFramerate: DEFAULT_RENDER_FRAMERATE,
            renderHeight: DEFAULT_RENDER_HEIGHT,
            renderWidth: DEFAULT_RENDER_WIDTH,
            zoom: 100
        };
        this.timeline = null;
        this.mounted = false;
        bindAll(this, [
            'attachTimeline',
            'handleChangeDuration',
            'handleChangeRenderSettings',
            'handleChangeZoom',
            'handlePlayPause',
            'handleRender',
            'handleSeek',
            'handleStep',
            'handleStop',
            'handleTimelineUpdate'
        ]);
    }

    componentDidMount () {
        this.mounted = true;
        // Let the current mount pass finish before installing the shared
        // controller. This also makes the component safe to remount while
        // the VM itself remains alive.
        Promise.resolve().then(this.attachTimeline);
    }

    componentWillUnmount () {
        this.mounted = false;
        this.props.vm.runtime.off('SHADING_TIMELINE_UPDATE', this.handleTimelineUpdate);
    }

    attachTimeline () {
        if (!this.mounted) return;
        this.timeline = installShadingTimeline(this.props.vm);
        if (!this.timeline) return;
        this.props.vm.runtime.on('SHADING_TIMELINE_UPDATE', this.handleTimelineUpdate);
        this.handleTimelineUpdate(this.timeline.snapshot());
    }

    handleTimelineUpdate (snapshot) {
        if (this.mounted) this.setState(snapshot);
    }

    handlePlayPause () {
        if (!this.timeline) return;
        if (this.timeline.isPlaying) this.timeline.pause();
        else this.timeline.play();
    }

    handleStop () {
        if (this.timeline) this.timeline.stop();
    }

    handleSeek (time) {
        if (this.timeline) this.timeline.seek(Number(time));
    }

    handleStep (direction) {
        if (this.timeline) this.timeline.step(direction);
    }

    handleChangeDuration (duration) {
        if (this.timeline) this.timeline.setDuration(Number(duration));
    }

    handleChangeRenderSettings (settings) {
        if (this.timeline) this.timeline.setRenderSettings(settings);
    }

    handleChangeZoom (zoom) {
        const value = Number(zoom);
        if (Number.isFinite(value)) this.setState({zoom: Math.min(1000, Math.max(50, value))});
    }

    handleRender (options) {
        if (!this.timeline) return Promise.reject(new Error('The timeline is not installed'));
        return exportTimelineVideo(this.props.vm, {
            ...options,
            onProgress: options.onProgress
        }).then(output => {
            const duration = Math.max(0, Number(output.duration) || 0);
            const seconds = duration.toFixed(2).replace(/\.00$/, '');
            downloadBlob(
                `timeline-${output.width}x${output.height}-${output.framerate}fps-${seconds}s.mp4`,
                output.blob
            );
            return output;
        });
    }

    render () {
        return (
            <ShadingTimelineComponent
                {...this.state}
                onChangeDuration={this.handleChangeDuration}
                onChangeRenderSettings={this.handleChangeRenderSettings}
                onChangeZoom={this.handleChangeZoom}
                onPlayPause={this.handlePlayPause}
                onRender={this.handleRender}
                onSeek={this.handleSeek}
                onStep={this.handleStep}
                onStop={this.handleStop}
            />
        );
    }
}

ShadingTimeline.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ShadingTimeline;
