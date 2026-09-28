import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../lib/movie-asset-manager';
import formatTimecode from '../../lib/timecode';

import styles from './osd-readout.css';

const TALLY = {
    rec: 'REC',
    play: 'PLAY',
    run: 'RUN',
    standby: 'STBY'
};

/**
 * The monitor's on-screen display: timecode, format and transport state,
 * read at a glance from the top bar.
 */
class OsdReadout extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            playing: false,
            recording: false
        };
        this.timecodeRef = React.createRef();
        this.handleTimelineChanged = this.handleTimelineChanged.bind(this);
    }

    componentDidMount () {
        if (!this.props.vm) return;
        this.manager = installMovieAssetManager(this.props.vm);
        this.manager.on('timelineChanged', this.handleTimelineChanged);
        this.handleTimelineChanged(this.manager.getTimelineState());
    }

    componentWillUnmount () {
        if (this.manager) {
            this.manager.removeListener('timelineChanged', this.handleTimelineChanged);
        }
    }

    handleTimelineChanged (timeline) {
        if (!timeline) return;
        this.framerate = timeline.framerate;
        // Timecode updates every frame during playback; write it directly rather than re-rendering.
        if (this.timecodeRef.current) {
            this.timecodeRef.current.textContent = formatTimecode(timeline.currentTime, timeline.framerate);
        }
        const playing = !!timeline.playing;
        const recording = !!timeline.recording;
        if (playing !== this.state.playing || recording !== this.state.recording) {
            this.setState({playing, recording});
        }
    }

    render () {
        const {framerate, running, stageHeight, stageWidth, turbo} = this.props;
        let tally = 'standby';
        if (this.state.recording) tally = 'rec';
        else if (this.state.playing) tally = 'play';
        else if (running) tally = 'run';

        return (
            <div
                className={styles.readout}
                aria-label="Monitor status"
                role="status"
            >
                <span
                    className={classNames(styles.tally, styles[tally])}
                    title={tally === 'rec' ? 'Rendering' : null}
                >
                    <span className={styles.tallyLamp} />
                    {TALLY[tally]}
                </span>
                <span
                    className={styles.timecode}
                    ref={this.timecodeRef}
                >
                    {formatTimecode(0, framerate)}
                </span>
                <span className={styles.field}>
                    <span className={styles.value}>{framerate}</span>
                    <span className={styles.unit}>{'fps'}</span>
                </span>
                <span className={styles.field}>
                    <span className={styles.value}>{`${stageWidth}×${stageHeight}`}</span>
                </span>
                {turbo ? (
                    <span className={classNames(styles.field, styles.flag)}>{'TURBO'}</span>
                ) : null}
            </div>
        );
    }
}

OsdReadout.propTypes = {
    framerate: PropTypes.number,
    running: PropTypes.bool,
    stageHeight: PropTypes.number,
    stageWidth: PropTypes.number,
    turbo: PropTypes.bool,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    framerate: state.scratchGui.tw.framerate,
    running: state.scratchGui.vmStatus.running,
    stageHeight: state.scratchGui.customStageSize.height,
    stageWidth: state.scratchGui.customStageSize.width,
    turbo: state.scratchGui.vmStatus.turbo,
    vm: state.scratchGui.vm
});

export default connect(mapStateToProps)(OsdReadout);
