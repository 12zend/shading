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
    addModelFolder: {
        defaultMessage: 'Upload Model Folder',
        description: 'Button to upload a 3D model together with texture files in its folder',
        id: 'movie.model.uploadFolder'
    },
    emptyTitle: {
        defaultMessage: 'Add a 3D model to this sprite',
        description: 'Title shown when a sprite has no model assets',
        id: 'movie.model.emptyTitle'
    },
    emptyDescription: {
        defaultMessage: 'Upload GLB, PMX, FBX, or OBJ/MTL files. For a textured PMX, upload its model folder. ' +
            'Movie keeps each model type and stores a unified GLB asset.',
        description: 'Description shown when a sprite has no model assets',
        id: 'movie.model.emptyDescription'
    },
    name: {
        defaultMessage: 'Model name',
        description: 'Label for the model name input',
        id: 'movie.model.name'
    },
    importMotion: {
        defaultMessage: 'Import VMD / VPD',
        description: 'Button to import a motion or pose for a 3D model',
        id: 'movie.model.importMotion'
    },
    motion: {
        defaultMessage: 'Motion or pose',
        description: 'Label for a model motion selection',
        id: 'movie.model.motion'
    },
    noMotion: {
        defaultMessage: 'Original pose',
        description: 'Option shown when no model motion is selected',
        id: 'movie.model.noMotion'
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
            'handleMotionChange',
            'handleMotionUpload',
            'handleMotionUploadClick',
            'handleNameChange',
            'handlePreviewError',
            'handleSelect',
            'handleUpload',
            'handleUploadClick',
            'handleUploadFolderClick',
            'setFolderInput',
            'setFileInput',
            'setMotionFileInput'
        ]);
        this.state = {
            error: null,
            importingMotion: false,
            selectedModelIndex: 0,
            uploading: false
        };
    }

    componentDidMount () {
        this.manager = this.getManager();
        if (this.manager) {
            this.manager.on('modelsChanged', this.handleManagerChange);
            this.handleManagerChange();
        }
    }

    componentDidUpdate (previousProps) {
        if (previousProps.editingTarget !== this.props.editingTarget) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({selectedModelIndex: 0, error: null});
        }
    }

    componentWillUnmount () {
        if (this.manager) this.manager.off('modelsChanged', this.handleManagerChange);
    }

    getManager () {
        return this.manager || this.props.vm.__movieAssetManager;
    }

    getModels () {
        const manager = this.getManager();
        return manager ? manager.getModels(this.props.editingTarget) : [];
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
            this.manager.replaceModelScene(this.props.vm.editingTarget, model.name).catch(this.handlePreviewError);
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
                await this.manager.replaceModelScene(this.props.vm.editingTarget, models[selectedModelIndex].name);
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

    handleUploadFolderClick () {
        this.folderInput.click();
    }

    async handleMotionUpload (event) {
        const files = Array.from(event.target.files);
        event.target.value = null;
        if (!files.length) return;
        this.setState({importingMotion: true, error: null});
        try {
            await this.manager.addModelMotionsFromFiles(
                this.props.editingTarget,
                this.state.selectedModelIndex,
                files
            );
        } catch (error) {
            this.setState({error: error.message});
        } finally {
            this.setState({importingMotion: false});
        }
    }

    handleMotionUploadClick () {
        this.motionFileInput.click();
    }

    handleMotionChange (event) {
        this.manager.selectModelMotion(
            this.props.editingTarget,
            this.state.selectedModelIndex,
            event.target.value
        );
    }

    setFileInput (input) {
        this.fileInput = input;
    }

    setFolderInput (input) {
        this.folderInput = input;
    }

    setMotionFileInput (input) {
        this.motionFileInput = input;
    }

    render () {
        if (!this.props.vm.editingTarget) return null;
        const models = this.getModels();
        const selectedModel = models[this.state.selectedModelIndex];
        const items = models.map(model => ({
            details: `${(model.modelFormat || model.sourceFormat).toUpperCase()} · ${model.vertices} vertices`,
            name: model.name,
            thumbnail: <span className={styles.tileModel}>{'◇'}</span>
        }));

        return (
            <AssetPanel
                buttons={[{
                    title: this.props.intl.formatMessage(messages.addModel),
                    img: fileUploadIcon,
                    onClick: this.handleUploadClick
                }, {
                    title: this.props.intl.formatMessage(messages.addModelFolder),
                    img: fileUploadIcon,
                    onClick: this.handleUploadFolderClick
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
                    accept=".glb,.pmx,.fbx,.obj,.mtl,.bmp,.gif,.jpeg,.jpg,.png,.spa,.sph,.tga,.webp,model/gltf-binary"
                    className={styles.fileInput}
                    multiple
                    ref={this.setFileInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                <input
                    className={styles.fileInput}
                    multiple
                    ref={this.setFolderInput}
                    type="file"
                    webkitdirectory=""
                    onChange={this.handleUpload}
                />
                <input
                    accept=".vmd,.vpd"
                    className={styles.fileInput}
                    ref={this.setMotionFileInput}
                    type="file"
                    onChange={this.handleMotionUpload}
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
                                <span>{
                                    `${(selectedModel.modelFormat || selectedModel.sourceFormat).toUpperCase()} model`
                                }</span>
                                <span>{'Stored as GLB'}</span>
                                <span>{`${selectedModel.vertices} vertices`}</span>
                                <span>{`${selectedModel.triangles} triangles`}</span>
                                <span>{`${selectedModel.animationCount} animations`}</span>
                                <span>{formatBytes(selectedModel.asset.data.byteLength)}</span>
                            </div>
                        </div>
                        <div className={styles.previewArea}>
                            <ModelPreview
                                manager={this.getManager()}
                                model={selectedModel}
                                onError={this.handlePreviewError}
                            />
                        </div>
                        <div className={styles.motionPanel}>
                            <label className={styles.motionLabel}>
                                <span>{this.props.intl.formatMessage(messages.motion)}</span>
                                <select
                                    className={styles.motionSelect}
                                    value={selectedModel.activeMotion || ''}
                                    onChange={this.handleMotionChange}
                                >
                                    <option value="">{this.props.intl.formatMessage(messages.noMotion)}</option>
                                    {(selectedModel.motions || []).map(motion => (
                                        <option
                                            key={motion.name}
                                            value={motion.name}
                                        >
                                            {`${motion.name} · ${motion.format.toUpperCase()} · ` +
                                                `${motion.frameCount} frames`}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                className={styles.motionButton}
                                disabled={this.state.importingMotion}
                                onClick={this.handleMotionUploadClick}
                            >
                                {this.props.intl.formatMessage(messages.importMotion)}
                            </button>
                        </div>
                        <div className={styles.hint}>
                            {'Use “set model frame to”, then “render model”. VMD motions and VPD poses are ' +
                                'evaluated by frame without exposing bones as blocks.'}
                        </div>
                        {this.state.error ? <div className={styles.error}>{this.state.error}</div> : null}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>{'◇'}</div>
                        <h2>{this.props.intl.formatMessage(messages.emptyTitle)}</h2>
                        <p>{this.props.intl.formatMessage(messages.emptyDescription)}</p>
                        <div className={styles.emptyActions}>
                            <button
                                disabled={this.state.uploading}
                                onClick={this.handleUploadClick}
                            >
                                {this.props.intl.formatMessage(messages.addModel)}
                            </button>
                            <button
                                disabled={this.state.uploading}
                                onClick={this.handleUploadFolderClick}
                            >
                                {this.props.intl.formatMessage(messages.addModelFolder)}
                            </button>
                        </div>
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
