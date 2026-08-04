import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import ModelPreview from '../components/model-editor/model-preview.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import downloadBlob from '../lib/download-blob';
import DragConstants from '../lib/drag-constants';
import {formatBytes} from '../lib/tw-bytes-utils';

import styles from '../components/model-editor/model-editor.css';

const messages = defineMessages({
    addModel: {
        defaultMessage: 'Upload Model',
        description: 'Button to upload a 3D model asset',
        id: 'movie.model.upload'
    },
    emptyTitle: {
        defaultMessage: 'Add a 3D model to this sprite',
        description: 'Title shown when a sprite has no model assets',
        id: 'movie.model.emptyTitle'
    },
    emptyDescription: {
        defaultMessage: 'Upload GLB, FBX, or OBJ/MTL files. Movie converts every import to a unified GLB asset.',
        description: 'Description shown when a sprite has no model assets',
        id: 'movie.model.emptyDescription'
    },
    name: {
        defaultMessage: 'Model name',
        description: 'Label for the model name input',
        id: 'movie.model.name'
    }
});

class ModelTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDelete',
            'handleDrop',
            'handleExport',
            'handleManagerChange',
            'handleNameChange',
            'handlePreviewError',
            'handleSelect',
            'handleUpload',
            'handleUploadClick',
            'setFileInput'
        ]);
        this.state = {
            error: null,
            selectedModelIndex: 0,
            uploading: false
        };
    }

    componentDidMount () {
        this.manager = this.props.vm.__movieAssetManager;
        this.manager.on('modelsChanged', this.handleManagerChange);
    }

    componentDidUpdate (previousProps) {
        if (previousProps.editingTarget !== this.props.editingTarget) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({selectedModelIndex: 0, error: null});
        }
    }

    componentWillUnmount () {
        this.manager.off('modelsChanged', this.handleManagerChange);
    }

    getModels () {
        return this.manager ? this.manager.getModels(this.props.editingTarget) : [];
    }

    handleManagerChange (targetId) {
        if (targetId && targetId !== this.props.editingTarget) return;
        const models = this.getModels();
        this.setState(state => ({
            selectedModelIndex: Math.min(state.selectedModelIndex, Math.max(0, models.length - 1))
        }));
    }

    handleSelect (index) {
        const model = this.getModels()[index];
        this.setState({selectedModelIndex: index, error: null});
        if (model && this.props.vm.editingTarget) {
            this.manager.switchModel(this.props.vm.editingTarget, model.name).catch(this.handlePreviewError);
        }
    }

    handleDelete (index) {
        this.manager.deleteModel(this.props.editingTarget, index);
    }

    handleDrop (dropInfo) {
        if (dropInfo.dragType !== DragConstants.MODEL) return;
        this.manager.reorderModel(this.props.editingTarget, dropInfo.index, dropInfo.newIndex);
        this.setState({selectedModelIndex: dropInfo.newIndex});
    }

    handleExport (index) {
        const model = this.getModels()[index];
        if (!model) return;
        downloadBlob(`${model.name}.glb`, new Blob([model.asset.data], {type: 'model/gltf-binary'}));
    }

    handleNameChange (event) {
        const name = this.manager.renameModel(
            this.props.editingTarget,
            this.state.selectedModelIndex,
            event.target.value
        );
        if (event.target.value !== name) event.target.value = name;
    }

    handlePreviewError (error) {
        this.setState({error: error.message});
    }

    async handleUpload (event) {
        const files = Array.from(event.target.files);
        event.target.value = null;
        if (!files.length) return;
        this.setState({uploading: true, error: null});
        try {
            await this.manager.addModelsFromFiles(this.props.editingTarget, files);
            const models = this.getModels();
            const selectedModelIndex = Math.max(0, models.length - 1);
            this.setState({selectedModelIndex});
            if (models[selectedModelIndex]) {
                await this.manager.switchModel(this.props.vm.editingTarget, models[selectedModelIndex].name);
            }
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
        const models = this.getModels();
        const selectedModel = models[this.state.selectedModelIndex];
        const items = models.map(model => ({
            details: `GLB · ${model.vertices} vertices`,
            name: model.name,
            thumbnail: <span className={styles.tileModel}>{'◇'}</span>
        }));

        return (
            <AssetPanel
                buttons={[{
                    title: this.props.intl.formatMessage(messages.addModel),
                    img: fileUploadIcon,
                    onClick: this.handleUploadClick
                }]}
                dragType={DragConstants.MODEL}
                items={items}
                selectedItemIndex={this.state.selectedModelIndex}
                onDeleteClick={this.handleDelete}
                onDrop={this.handleDrop}
                onExportClick={this.handleExport}
                onItemClick={this.handleSelect}
            >
                <input
                    accept=".glb,.fbx,.obj,.mtl,model/gltf-binary"
                    className={styles.fileInput}
                    multiple
                    ref={this.setFileInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                {selectedModel ? (
                    <div className={styles.editor}>
                        <div className={styles.toolbar}>
                            <label className={styles.nameLabel}>
                                <span>{this.props.intl.formatMessage(messages.name)}</span>
                                <input
                                    className={styles.nameInput}
                                    defaultValue={selectedModel.name}
                                    key={selectedModel.name}
                                    onBlur={this.handleNameChange}
                                />
                            </label>
                            <div className={styles.metadata}>
                                <span>{`${selectedModel.sourceFormat.toUpperCase()} → GLB`}</span>
                                <span>{`${selectedModel.vertices} vertices`}</span>
                                <span>{`${selectedModel.triangles} triangles`}</span>
                                <span>{`${selectedModel.animationCount} animations`}</span>
                                <span>{formatBytes(selectedModel.asset.data.byteLength)}</span>
                            </div>
                        </div>
                        <div className={styles.previewArea}>
                            <ModelPreview
                                manager={this.manager}
                                model={selectedModel}
                                onError={this.handlePreviewError}
                            />
                        </div>
                        <div className={styles.hint}>
                            {'Models are normalized on import and stored as GLB. Use “switch model to” in Looks.'}
                        </div>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>{'◇'}</div>
                        <h2>{this.props.intl.formatMessage(messages.emptyTitle)}</h2>
                        <p>{this.props.intl.formatMessage(messages.emptyDescription)}</p>
                        <button
                            disabled={this.state.uploading}
                            onClick={this.handleUploadClick}
                        >
                            {this.props.intl.formatMessage(messages.addModel)}
                        </button>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                )}
            </AssetPanel>
        );
    }
}

ModelTab.propTypes = {
    editingTarget: PropTypes.string,
    intl: intlShape.isRequired,
    vm: PropTypes.shape({
        __movieAssetManager: PropTypes.shape({}),
        editingTarget: PropTypes.shape({})
    }).isRequired
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget
});

export default injectIntl(connect(mapStateToProps)(ModelTab));
