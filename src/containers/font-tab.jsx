import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import downloadBlob from '../lib/download-blob';
import DragConstants from '../lib/drag-constants';
import {formatBytes} from '../lib/tw-bytes-utils';

import styles from '../components/font-editor/font-editor.css';

const messages = defineMessages({
    addFont: {
        defaultMessage: 'Upload Font',
        description: 'Button to upload a font asset',
        id: 'movie.font.upload'
    },
    emptyTitle: {
        defaultMessage: 'Add a font to this project',
        description: 'Title shown when a project has no custom fonts',
        id: 'movie.font.emptyTitle'
    },
    emptyDescription: {
        defaultMessage: 'Upload a TTF, OTF, WOFF, or WOFF2 file to preview it and use it in Looks blocks.',
        description: 'Description shown when a project has no custom fonts',
        id: 'movie.font.emptyDescription'
    },
    previewText: {
        defaultMessage: 'The quick brown fox jumps over the lazy dog. 文字のプレビュー 123',
        description: 'Default text shown in the font preview',
        id: 'movie.font.previewText'
    },
    previewLabel: {
        defaultMessage: 'Preview text',
        description: 'Label for the editable font preview text',
        id: 'movie.font.previewLabel'
    },
    sizeLabel: {
        defaultMessage: 'Size',
        description: 'Label for the font preview size control',
        id: 'movie.font.sizeLabel'
    }
});

class FontTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDelete',
            'handleDrop',
            'handleExport',
            'handleFontsChanged',
            'handlePreviewTextChange',
            'handleSelect',
            'handleSizeChange',
            'handleUpload',
            'handleUploadClick',
            'setFileInput'
        ]);
        this.state = {
            error: null,
            previewSize: 48,
            previewText: props.intl.formatMessage(messages.previewText),
            selectedFontIndex: 0,
            uploading: false
        };
    }

    componentDidMount () {
        this.manager = this.props.vm.__movieAssetManager;
        this.manager.on('fontsChanged', this.handleFontsChanged);
    }

    componentWillUnmount () {
        this.manager.off('fontsChanged', this.handleFontsChanged);
    }

    getFonts () {
        return this.props.vm.runtime.fontManager.getFonts();
    }

    handleFontsChanged () {
        const fonts = this.getFonts();
        this.setState(state => ({
            selectedFontIndex: Math.min(state.selectedFontIndex, Math.max(0, fonts.length - 1))
        }));
    }

    handleSelect (index) {
        this.setState({selectedFontIndex: index, error: null});
    }

    handleDelete (index) {
        this.manager.deleteFont(index);
    }

    handleDrop (dropInfo) {
        if (dropInfo.dragType === DragConstants.FONT) {
            this.manager.reorderFont(dropInfo.index, dropInfo.newIndex);
            this.setState({selectedFontIndex: dropInfo.newIndex});
        }
    }

    handleExport (index) {
        const font = this.getFonts()[index];
        if (!font || !font.data) return;
        downloadBlob(`${font.name}.${font.format}`, new Blob([font.data], {type: `font/${font.format}`}));
    }

    handlePreviewTextChange (event) {
        this.setState({previewText: event.target.value});
    }

    handleSizeChange (event) {
        this.setState({previewSize: Number(event.target.value)});
    }

    async handleUpload (event) {
        const files = Array.from(event.target.files);
        event.target.value = null;
        if (!files.length) return;
        this.setState({uploading: true, error: null});
        try {
            for (const file of files) await this.manager.addFontFromFile(file);
            const fonts = this.getFonts();
            this.setState({selectedFontIndex: Math.max(0, fonts.length - 1)});
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
        const fonts = this.getFonts();
        const selectedFont = fonts[this.state.selectedFontIndex];
        const items = fonts.map(font => ({
            name: font.name,
            details: font.system ? 'System' : font.format.toUpperCase(),
            thumbnail: (
                <span
                    className={styles.tileGlyph}
                    style={{fontFamily: font.family}}
                >
                    {'Aa'}
                </span>
            )
        }));

        return (
            <AssetPanel
                buttons={[{
                    title: this.props.intl.formatMessage(messages.addFont),
                    img: fileUploadIcon,
                    onClick: this.handleUploadClick
                }]}
                dragType={DragConstants.FONT}
                items={items}
                selectedItemIndex={this.state.selectedFontIndex}
                onDeleteClick={this.handleDelete}
                onDrop={this.handleDrop}
                onExportClick={this.handleExport}
                onItemClick={this.handleSelect}
            >
                <input
                    accept=".ttf,.otf,.woff,.woff2"
                    className={styles.fileInput}
                    multiple
                    ref={this.setFileInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                {selectedFont ? (
                    <div className={styles.editor}>
                        <div className={styles.toolbar}>
                            <label className={styles.previewInputLabel}>
                                <span>{this.props.intl.formatMessage(messages.previewLabel)}</span>
                                <input
                                    className={styles.previewInput}
                                    value={this.state.previewText}
                                    onChange={this.handlePreviewTextChange}
                                />
                            </label>
                            <label className={styles.sizeControl}>
                                <span>{this.props.intl.formatMessage(messages.sizeLabel)}</span>
                                <input
                                    max="96"
                                    min="16"
                                    type="range"
                                    value={this.state.previewSize}
                                    onChange={this.handleSizeChange}
                                />
                                <output>{`${this.state.previewSize}px`}</output>
                            </label>
                        </div>
                        <div
                            className={styles.previewArea}
                            style={{
                                fontFamily: selectedFont.family,
                                fontSize: `${this.state.previewSize}px`
                            }}
                        >
                            {this.state.previewText || ' '}
                        </div>
                        <div className={styles.details}>
                            <strong>{selectedFont.name}</strong>
                            <span>{selectedFont.system ? 'System font' : selectedFont.format.toUpperCase()}</span>
                            {selectedFont.system ? null : <span>{formatBytes(selectedFont.data.byteLength)}</span>}
                        </div>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>{'Aa'}</div>
                        <h2>{this.props.intl.formatMessage(messages.emptyTitle)}</h2>
                        <p>{this.props.intl.formatMessage(messages.emptyDescription)}</p>
                        <button
                            disabled={this.state.uploading}
                            onClick={this.handleUploadClick}
                        >
                            {this.props.intl.formatMessage(messages.addFont)}
                        </button>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                )}
            </AssetPanel>
        );
    }
}

FontTab.propTypes = {
    intl: intlShape.isRequired,
    vm: PropTypes.shape({
        __movieAssetManager: PropTypes.shape({}),
        runtime: PropTypes.shape({
            fontManager: PropTypes.shape({
                getFonts: PropTypes.func.isRequired
            }).isRequired
        }).isRequired
    }).isRequired
};

export default injectIntl(FontTab);
