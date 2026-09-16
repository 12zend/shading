import React from 'react';
import PropTypes from 'prop-types';
import bindAll from 'lodash.bindall';
import {FormattedMessage, injectIntl, intlShape} from 'react-intl';
import AssetPanel from '../asset-panel/asset-panel.jsx';
import VideoEditor from '../video-editor/video-editor.jsx';
import uploadIcon from '../action-menu/icon--file-upload.svg';
import videoIcon from '!../../lib/tw-recolor/build!../gui/icon--videos.svg';
import fontIcon from '!../../lib/tw-recolor/build!../gui/icon--fonts.svg';
import downloadBlob from '../../lib/download-blob';
import styles from './shading-assets.css';

class ShadingAssets extends React.Component {
    constructor (props) {
        super(props);
        this.state = {items: [],
            busy: false,
            error: '',
            selected: '',
            size: 48,
            preview: 'The quick brown fox jumps over the lazy dog.\n文字のプレビュー 123'};
        bindAll(this, ['refresh', 'handleImportFiles', 'handleError', 'handleSelect', 'handleRemove',
            'handleUploadClick', 'setFileInput', 'handleExport', 'handleDrop', 'handleNameChange',
            'handleTrim', 'handlePreviewChange', 'handleSizeChange']);
    }
    componentDidMount () {
        this.props.vm.runtime.on('SHADING_ASSETS_CHANGED', this.refresh);
        this.props.vm.runtime.on('SHADING_MEDIA_ERROR', this.handleError);
        this.refresh();
    }
    componentWillUnmount () {
        this.unmounted = true;
        this.props.vm.runtime.off('SHADING_ASSETS_CHANGED', this.refresh);
        this.props.vm.runtime.off('SHADING_MEDIA_ERROR', this.handleError);
    }
    get library () {
        return this.props.vm.runtime.shadingScene.assets;
    }
    get selected () {
        return this.state.items.find(item => item.id === this.state.selected);
    }
    handleSelect (index) {
        this.setState({selected: this.state.items[index].id, error: ''});
    }
    handleRemove (index) {
        this.library.remove(this.state.items[index].id);
    }
    handleError (error) {
        this.setState({error: error.message || String(error)});
    }
    handleUploadClick () {
        if (!this.state.busy) this.fileInput.click();
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    handlePreviewChange (event) {
        this.setState({preview: event.target.value});
    }
    handleSizeChange (event) {
        this.setState({size: Number(event.target.value)});
    }
    handleNameChange (event) {
        if (this.selected) event.target.value = this.library.rename(this.selected.id, event.target.value);
    }
    handleTrim (start, end) {
        if (this.selected) this.library.trim(this.selected.id, start, end);
    }
    handleDrop (info) {
        if (info.dragType !== this.props.kind.toUpperCase()) return;
        const item = this.state.items[info.index];
        this.library.reorder(this.props.kind, info.index, info.newIndex);
        this.setState({selected: item.id});
    }
    handleExport (index) {
        const item = this.state.items[index];
        const encoded = item.data.slice(item.data.indexOf(',') + 1);
        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        downloadBlob(`${item.name}.${item.format || (item.kind === 'video' ? 'mp4' : 'woff2')}`,
            new Blob([bytes], {type: item.data.slice(5, item.data.indexOf(';'))}));
    }
    refresh () {
        const items = this.library.list(this.props.kind);
        this.setState(state => ({items,
            selected: items.some(item => item.id === state.selected) ?
                state.selected : (items[0] ? items[0].id : '')}));
    }
    async handleImportFiles (event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        this.setState({busy: true, error: ''});
        const errors = [];
        for (const file of files) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const item = await this.library.importFile(file, this.props.kind);
                if (!this.unmounted) this.setState({selected: item.id});
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }
        if (!this.unmounted) this.setState({busy: false, error: errors.join('\n')});
    }
    render () {
        const {kind, intl} = this.props;
        const {items, selected, busy, error, size, preview} = this.state;
        const item = this.selected;
        const video = kind === 'video';
        const uploadLabel = intl.formatMessage({id: 'shade.assets.upload', defaultMessage: 'Upload {kind}'},
            {kind: video ? 'Video' : 'Font'});
        const tiles = items.map(asset => {
            const thumbnail = video ? (
                <video
                    className={styles.tileVideo}
                    muted
                    playsInline
                    preload="metadata"
                    src={asset.data}
                />
            ) : (
                <span
                    className={styles.tileGlyph}
                    style={{fontFamily: asset.family}}
                >{'Aa'}</span>
            );
            return {name: asset.name,
                thumbnail,
                details: video ? `${asset.width} × ${asset.height}` : (asset.format || 'font').toUpperCase()};
        });
        return (
            <div className={styles.panel}>
                <AssetPanel
                    buttons={[{title: uploadLabel, img: uploadIcon, onClick: this.handleUploadClick}]}
                    dragType={kind.toUpperCase()}
                    items={tiles}
                    selectedItemIndex={Math.max(0, items.findIndex(asset => asset.id === selected))}
                    onDeleteClick={this.handleRemove}
                    onDrop={this.handleDrop}
                    onExportClick={this.handleExport}
                    onItemClick={this.handleSelect}
                >
                    <input
                        className={styles.fileInput}
                        aria-label={uploadLabel}
                        type="file"
                        accept={video ? '.mp4,.webm,.mov,.m4v,.ogv' : '.ttf,.otf,.woff,.woff2'}
                        multiple
                        disabled={busy}
                        ref={this.setFileInput}
                        onChange={this.handleImportFiles}
                    />
                    {item ? (video ? <VideoEditor
                        video={{...item, assetId: item.id, url: item.data, sourceDuration: item.duration}}
                        onChangeName={this.handleNameChange}
                        onTrim={this.handleTrim}
                        onError={this.handleError}
                    /> : <div className={styles.editor}>
                        <div className={styles.toolbar}>
                            <label className={styles.previewInputLabel}>
                                <span><FormattedMessage
                                    id="shade.assets.previewText"
                                    defaultMessage="Preview text"
                                /></span>
                                <input
                                    className={styles.previewInput}
                                    value={preview}
                                    onChange={this.handlePreviewChange}
                                />
                            </label>
                            <label className={styles.sizeControl}>
                                <span><FormattedMessage
                                    id="shade.assets.size"
                                    defaultMessage="Size"
                                /></span>
                                <input
                                    type="range"
                                    min="16"
                                    max="120"
                                    value={size}
                                    onChange={this.handleSizeChange}
                                />
                                <output>{`${size}px`}</output>
                            </label>
                        </div>
                        <div
                            className={styles.previewArea}
                            style={{fontFamily: item.family, fontSize: `${size}px`}}
                        >
                            {preview || ' '}
                        </div>
                        <div className={styles.details}>
                            <strong>{item.name}</strong>
                            <span>{(item.format || 'font').toUpperCase()}</span>
                            <span>{`${Math.round((item.bytes || item.data.length * 0.75) / 1024)} KB`}</span>
                        </div>
                    </div>) : <div className={styles.emptyState}>
                        <img
                            className={styles.emptyIcon}
                            src={video ? videoIcon() : fontIcon()}
                            alt=""
                        />
                        <h2><FormattedMessage
                            id="shade.assets.emptyTitle"
                            defaultMessage="Add a {kind} to this project"
                            values={{kind: video ? 'video' : 'font'}}
                        /></h2>
                        <p><FormattedMessage
                            id="shade.assets.emptyHelp"
                            defaultMessage="Upload {formats} files, then choose them in the {block} block."
                            values={{formats: video ? 'MP4, WebM, OGV, or MOV' : 'TTF, OTF, WOFF, or WOFF2',
                                block: video ? 'add footage' : 'add text'}}
                        /></p>
                        <button
                            disabled={busy}
                            onClick={this.handleUploadClick}
                        >{uploadLabel}</button>
                    </div>}
                </AssetPanel>
                {busy && <div
                    className={styles.status}
                    role="status"
                >
                    <FormattedMessage
                        id="shade.assets.loading"
                        defaultMessage="Loading…"
                    />
                </div>}
                {error && <div
                    className={styles.error}
                    role="alert"
                >{error}</div>}
            </div>
        );
    }
}
ShadingAssets.propTypes = {
    vm: PropTypes.object.isRequired,
    kind: PropTypes.oneOf(['video', 'font']).isRequired,
    intl: intlShape.isRequired
};
export default injectIntl(ShadingAssets);
