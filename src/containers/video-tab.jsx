import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import downloadBlob from '../lib/download-blob';
import DragConstants from '../lib/drag-constants';
import {formatBytes} from '../lib/tw-bytes-utils';

import styles from '../components/video-editor/video-editor.css';

const messages = defineMessages({
    addVideo: {
        defaultMessage: 'Upload Video',
        description: 'Button to upload a video asset',
        id: 'movie.video.upload'
    },
    emptyTitle: {
        defaultMessage: 'Add a video to this sprite',
        description: 'Title shown when a sprite has no video assets',
        id: 'movie.video.emptyTitle'
    },
    emptyDescription: {
        defaultMessage: 'Upload an MP4, WebM, OGV, or MOV file to render exact frames and stamp them in a scene.',
        description: 'Description shown when a sprite has no video assets',
        id: 'movie.video.emptyDescription'
    },
    name: {
        defaultMessage: 'Video name',
        description: 'Label for the video name input',
        id: 'movie.video.name'
    },
    stampHint: {
        defaultMessage: 'Use “render video … at frame …”, then Pen’s “stamp”. The render block waits for the ' +
            'exact frame, so it can be layered over an earlier 3D model stamp. Videos use a 30 fps timeline; ' +
            'frame 1 is the first frame.',
        description: 'Instructions for rendering a deterministic video frame as a stamp',
        id: 'movie.video.stampHint'
    }
});

class VideoTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDelete',
            'handleDrop',
            'handleExport',
            'handleManagerChange',
            'handleNameChange',
            'handleSelect',
            'handleUpload',
            'handleUploadClick',
            'setFileInput'
        ]);
        this.state = {
            error: null,
            selectedVideoIndex: 0,
            uploading: false
        };
    }

    componentDidMount () {
        this.manager = this.getManager();
        if (this.manager) {
            this.manager.on('videosChanged', this.handleManagerChange);
            this.handleManagerChange();
        }
    }

    componentDidUpdate (previousProps) {
        if (previousProps.editingTarget !== this.props.editingTarget) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({selectedVideoIndex: 0, error: null});
        }
    }

    componentWillUnmount () {
        if (this.manager) this.manager.off('videosChanged', this.handleManagerChange);
    }

    getManager () {
        return this.manager || this.props.vm.__movieAssetManager;
    }

    getVideos () {
        const manager = this.getManager();
        return manager ? manager.getVideos(this.props.editingTarget) : [];
    }

    handleManagerChange (targetId) {
        if (targetId && targetId !== this.props.editingTarget) return;
        const videos = this.getVideos();
        this.setState(state => ({
            selectedVideoIndex: Math.min(state.selectedVideoIndex, Math.max(0, videos.length - 1))
        }));
    }

    handleSelect (index) {
        const video = this.getVideos()[index];
        this.setState({selectedVideoIndex: index, error: null});
        if (video && this.props.vm.editingTarget) {
            this.manager.switchVideo(this.props.vm.editingTarget, video.name).catch(error => {
                this.setState({error: error.message});
            });
        }
    }

    handleDelete (index) {
        this.manager.deleteVideo(this.props.editingTarget, index);
    }

    handleDrop (dropInfo) {
        if (dropInfo.dragType === DragConstants.VIDEO) {
            this.manager.reorderVideo(this.props.editingTarget, dropInfo.index, dropInfo.newIndex);
            this.setState({selectedVideoIndex: dropInfo.newIndex});
        }
    }

    handleExport (index) {
        const video = this.getVideos()[index];
        if (!video) return;
        const blob = new Blob([video.asset.data], {type: video.mimeType});
        downloadBlob(`${video.name}.${video.dataFormat}`, blob);
    }

    handleNameChange (event) {
        const name = this.manager.renameVideo(
            this.props.editingTarget,
            this.state.selectedVideoIndex,
            event.target.value
        );
        if (event.target.value !== name) event.target.value = name;
    }

    async handleUpload (event) {
        const files = Array.from(event.target.files);
        event.target.value = null;
        if (!files.length) return;
        this.setState({uploading: true, error: null});
        try {
            for (const file of files) {
                await this.manager.addVideoFromFile(this.props.editingTarget, file);
            }
            const videos = this.getVideos();
            this.setState({selectedVideoIndex: Math.max(0, videos.length - 1)});
        } catch (error) {
            this.setState({error: error.message});
        } finally {
            this.setState({uploading: false});
        }
    }

    handleUploadClick () {
        this.fileInput.click();
    }

    setFileInput (input) {
        this.fileInput = input;
    }

    render () {
        if (!this.props.vm.editingTarget) return null;
        const videos = this.getVideos();
        const selectedVideo = videos[this.state.selectedVideoIndex];
        const items = videos.map(video => ({
            name: video.name,
            details: video.width && video.height ? `${video.width} × ${video.height}` : null,
            thumbnail: (
                <video
                    className={styles.tileVideo}
                    muted
                    playsInline
                    preload="metadata"
                    src={video.url}
                />
            )
        }));

        return (
            <AssetPanel
                buttons={[{
                    title: this.props.intl.formatMessage(messages.addVideo),
                    img: fileUploadIcon,
                    onClick: this.handleUploadClick
                }]}
                dragType={DragConstants.VIDEO}
                items={items}
                selectedItemIndex={this.state.selectedVideoIndex}
                onDeleteClick={this.handleDelete}
                onDrop={this.handleDrop}
                onExportClick={this.handleExport}
                onItemClick={this.handleSelect}
            >
                <input
                    accept=".mp4,.webm,.ogv,.mov,video/*"
                    className={styles.fileInput}
                    multiple
                    ref={this.setFileInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                {selectedVideo ? (
                    <div className={styles.editor}>
                        <div className={styles.toolbar}>
                            <label className={styles.nameLabel}>
                                <span>{this.props.intl.formatMessage(messages.name)}</span>
                                <input
                                    className={styles.nameInput}
                                    defaultValue={selectedVideo.name}
                                    key={selectedVideo.name}
                                    onBlur={this.handleNameChange}
                                />
                            </label>
                            <div className={styles.metadata}>
                                <span>{`${selectedVideo.width} × ${selectedVideo.height}`}</span>
                                <span>{`${selectedVideo.duration.toFixed(2)} s`}</span>
                                <span>{formatBytes(selectedVideo.asset.data.byteLength)}</span>
                            </div>
                        </div>
                        <div className={styles.previewArea}>
                            <video
                                className={styles.previewVideo}
                                controls
                                key={selectedVideo.assetId}
                                playsInline
                                preload="metadata"
                                src={selectedVideo.url}
                            />
                        </div>
                        <div className={styles.hint}>
                            {this.props.intl.formatMessage(messages.stampHint)}
                        </div>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>{'▶'}</div>
                        <h2>{this.props.intl.formatMessage(messages.emptyTitle)}</h2>
                        <p>{this.props.intl.formatMessage(messages.emptyDescription)}</p>
                        <button
                            disabled={this.state.uploading}
                            onClick={this.handleUploadClick}
                        >
                            {this.props.intl.formatMessage(messages.addVideo)}
                        </button>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                )}
            </AssetPanel>
        );
    }
}

VideoTab.propTypes = {
    editingTarget: PropTypes.string,
    intl: intlShape.isRequired,
    vm: PropTypes.shape({
        __movieAssetManager: PropTypes.shape({}),
        editingTarget: PropTypes.shape({}),
        runtime: PropTypes.shape({})
    }).isRequired
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget
});

export default injectIntl(connect(mapStateToProps)(VideoTab));
