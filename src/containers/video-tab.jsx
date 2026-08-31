import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import VideoEditor from '../components/video-editor/video-editor.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import playIcon from '../components/sound-editor/icon--play.svg';
import downloadBlob from '../lib/download-blob';
import DragConstants from '../lib/drag-constants';

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
            'handleTrim',
            'handleUpload',
            'handleUploadClick',
            'handleVideoError',
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

    handleTrim (trimStart, trimEnd) {
        const manager = this.getManager();
        if (!manager || !this.getVideos()[this.state.selectedVideoIndex]) return;
        try {
            manager.trimVideo(
                this.props.editingTarget,
                this.state.selectedVideoIndex,
                trimStart,
                trimEnd
            );
            this.setState({error: null});
        } catch (error) {
            this.setState({error: error.message});
        }
    }

    handleVideoError (error) {
        this.setState({error: error && error.message ? error.message : String(error)});
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
                    <VideoEditor
                        error={this.state.error}
                        video={selectedVideo}
                        onChangeName={this.handleNameChange}
                        onError={this.handleVideoError}
                        onTrim={this.handleTrim}
                    />
                ) : (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>
                            <img
                                alt=""
                                draggable={false}
                                src={playIcon}
                            />
                        </div>
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
