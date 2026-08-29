import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import ShaderCodeEditor from '../components/shader-editor/shader-code-editor.jsx';
import blankShaderIcon from '../components/asset-panel/icon--add-blank-costume.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import shaderIcon from '../components/shader-editor/icon--shader.svg';
import downloadBlob from '../lib/download-blob';
import {inferShaderInputs} from '../lib/pen-fx/shader-uniforms';

import styles from '../components/shader-editor/shader-editor.css';

const AUTO_SAVE_DELAY = 700;

const messages = defineMessages({
    addShader: {
        defaultMessage: 'Paint a Shader',
        description: 'Button to create a new fragment shader',
        id: 'movie.shader.create'
    },
    uploadShader: {
        defaultMessage: 'Upload Shader',
        description: 'Button to upload a GLSL shader or shader package',
        id: 'movie.shader.upload'
    },
    emptyTitle: {
        defaultMessage: 'Create a PenFX shader',
        description: 'Title shown when a project has no editable shaders',
        id: 'movie.shader.emptyTitle'
    },
    emptyDescription: {
        defaultMessage: 'Write a WebGL 1 fragment shader or upload a .glsl file. ' +
            'Uniforms become PenFX block arguments automatically.',
        description: 'Description shown when a project has no editable shaders',
        id: 'movie.shader.emptyDescription'
    },
    name: {
        defaultMessage: 'Shader name',
        description: 'Label for the shader name input',
        id: 'movie.shader.name'
    },
    source: {
        defaultMessage: 'Fragment shader GLSL source',
        description: 'Accessible label for the fragment shader code editor',
        id: 'movie.shader.source'
    },
    apply: {
        defaultMessage: 'Apply',
        description: 'Button to compile and apply shader changes',
        id: 'movie.shader.apply'
    },
    compiled: {
        defaultMessage: 'Compiled',
        description: 'Status shown after a shader compiles successfully',
        id: 'movie.shader.compiled'
    },
    compiling: {
        defaultMessage: 'Compiling…',
        description: 'Status shown while a shader is compiling',
        id: 'movie.shader.compiling'
    },
    pending: {
        defaultMessage: 'Changes pending',
        description: 'Status shown before shader changes compile',
        id: 'movie.shader.pending'
    },
    compileError: {
        defaultMessage: 'Fix shader errors',
        description: 'Status shown when shader compilation fails',
        id: 'movie.shader.compileError'
    },
    arguments: {
        defaultMessage: 'Block arguments',
        description: 'Heading before automatically generated shader block arguments',
        id: 'movie.shader.arguments'
    },
    noArguments: {
        defaultMessage: 'No custom uniforms — the block has no arguments.',
        description: 'Message shown when a shader has no custom uniforms',
        id: 'movie.shader.noArguments'
    }
});

class ShaderTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleCreate',
            'handleDelete',
            'handleDuplicate',
            'handleExport',
            'handleManagerChange',
            'handleNameChange',
            'handleApply',
            'handleSelect',
            'handleSourceChange',
            'handleUpload',
            'handleUploadClick',
            'persistDraft',
            'setFileInput'
        ]);
        this.state = {
            busy: false,
            dirty: false,
            draftName: '',
            draftSource: '',
            error: null,
            revision: 0,
            saving: false,
            selectedShaderKey: null,
            status: 'saved'
        };
    }

    componentDidMount () {
        this.mounted = true;
        this.manager = this.getManager();
        if (this.manager) {
            this.manager.on('shadersChanged', this.handleManagerChange);
            this.handleManagerChange();
        }
    }

    componentWillUnmount () {
        this.mounted = false;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this.manager) this.manager.off('shadersChanged', this.handleManagerChange);
        if (this.manager && this.state.dirty && this.state.selectedShaderKey) {
            this.manager.updateShader(this.state.selectedShaderKey, {
                name: this.state.draftName,
                source: this.state.draftSource
            }).catch(error => console.error('[Shader editor] Could not save changes:', error));
        }
    }

    getManager () {
        const penFX = this.props.vm && this.props.vm.runtime && this.props.vm.runtime.penFX;
        return penFX && penFX.customShaders;
    }

    getShaders () {
        return this.manager ? this.manager.getShaders() : [];
    }

    getSelectedShader () {
        return this.getShaders().find(shader => shader.key === this.state.selectedShaderKey) || null;
    }

    getDraftInputs (selectedShader) {
        if (!selectedShader) return [];
        if (!selectedShader.autoInputs) return selectedShader.inputs;
        try {
            return inferShaderInputs(this.state.draftSource);
        } catch (error) {
            return selectedShader.inputs;
        }
    }

    loadShader (shader) {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.setState({
            dirty: false,
            draftName: shader ? shader.name : '',
            draftSource: shader ? shader.source : '',
            error: null,
            selectedShaderKey: shader ? shader.key : null,
            status: 'saved'
        });
    }

    handleManagerChange () {
        if (!this.mounted) return;
        const shaders = this.getShaders();
        const selectedShader = shaders.find(shader => shader.key === this.state.selectedShaderKey);
        if (!selectedShader) {
            this.loadShader(shaders[0] || null);
            return;
        }
        if (!this.state.dirty && !this.state.saving) {
            this.setState(state => ({
                draftName: selectedShader.name,
                draftSource: selectedShader.source,
                revision: state.revision + 1
            }));
        } else {
            this.setState(state => ({revision: state.revision + 1}));
        }
    }

    scheduleSave () {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(this.persistDraft, AUTO_SAVE_DELAY);
    }

    handleNameChange (event) {
        this.setState({
            draftName: event.target.value,
            dirty: true,
            error: null,
            status: 'dirty'
        }, () => this.scheduleSave());
    }

    handleSourceChange (source) {
        this.setState({
            draftSource: source,
            dirty: true,
            error: null,
            status: 'dirty'
        }, () => this.scheduleSave());
    }

    handleApply () {
        return this.persistDraft();
    }

    async persistDraft () {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (!this.manager || !this.state.selectedShaderKey || !this.state.dirty) return true;
        const snapshot = {
            key: this.state.selectedShaderKey,
            name: this.state.draftName,
            source: this.state.draftSource
        };
        this.setState({saving: true, status: 'saving'});
        try {
            await this.manager.updateShader(snapshot.key, {
                name: snapshot.name,
                source: snapshot.source
            });
            if (this.mounted && this.state.selectedShaderKey === snapshot.key &&
                this.state.draftName === snapshot.name && this.state.draftSource === snapshot.source) {
                this.setState({dirty: false, error: null, saving: false, status: 'saved'});
            } else if (this.mounted) {
                this.setState({saving: false, status: 'dirty'}, () => this.scheduleSave());
            }
            return true;
        } catch (error) {
            if (this.mounted && this.state.selectedShaderKey === snapshot.key) {
                this.setState({error: error.message, saving: false, status: 'error'});
            }
            return false;
        }
    }

    async handleSelect (index) {
        const shader = this.getShaders()[index];
        if (!shader || shader.key === this.state.selectedShaderKey) return;
        if (this.state.dirty && !(await this.persistDraft())) return;
        this.loadShader(shader);
    }

    async handleCreate () {
        if (!this.manager || this.state.busy) return;
        if (this.state.dirty && !(await this.persistDraft())) return;
        this.setState({busy: true, error: null});
        try {
            const shader = await this.manager.createShader();
            if (this.mounted) this.loadShader(shader);
        } catch (error) {
            if (this.mounted) this.setState({error: error.message});
        } finally {
            if (this.mounted) this.setState({busy: false});
        }
    }

    async handleUpload (event) {
        const files = Array.from(event.target.files || []);
        event.target.value = null;
        if (!files.length || !this.manager || this.state.busy) return;
        if (this.state.dirty && !(await this.persistDraft())) return;
        this.setState({busy: true, error: null});
        let lastShader = null;
        try {
            for (const file of files) {
                const imported = await this.manager.importFile(file);
                if (imported && imported.key) {
                    lastShader = imported;
                } else if (imported && imported.id) {
                    lastShader = this.getShaders().find(shader => shader.packageId === imported.id) || lastShader;
                }
            }
            if (this.mounted && lastShader) this.loadShader(lastShader);
        } catch (error) {
            if (this.mounted) this.setState({error: error.message});
        } finally {
            if (this.mounted) this.setState({busy: false});
        }
    }

    handleUploadClick () {
        if (this.fileInput) this.fileInput.click();
    }

    async handleDelete (index) {
        const shader = this.getShaders()[index];
        if (!shader || !this.manager) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        try {
            await this.manager.deleteShader(shader.key);
        } catch (error) {
            if (this.mounted) this.setState({error: error.message});
        }
    }

    async handleDuplicate (index) {
        const shader = this.getShaders()[index];
        if (!shader || !this.manager) return;
        if (shader.key === this.state.selectedShaderKey && this.state.dirty && !(await this.persistDraft())) return;
        try {
            const duplicate = await this.manager.duplicateShader(shader.key);
            if (this.mounted) this.loadShader(duplicate);
        } catch (error) {
            if (this.mounted) this.setState({error: error.message});
        }
    }

    handleExport (index) {
        const shader = this.getShaders()[index];
        if (!shader) return;
        downloadBlob(`${shader.name}.glsl`, new Blob([shader.source], {type: 'text/plain'}));
    }

    setFileInput (input) {
        this.fileInput = input;
    }

    renderStatus () {
        const labels = {
            dirty: messages.pending,
            error: messages.compileError,
            saved: messages.compiled,
            saving: messages.compiling
        };
        return this.props.intl.formatMessage(labels[this.state.status] || messages.compiled);
    }

    render () {
        const shaders = this.getShaders();
        const selectedShader = this.getSelectedShader();
        const selectedItemIndex = Math.max(0, shaders.findIndex(shader => shader.key === this.state.selectedShaderKey));
        const draftInputs = this.getDraftInputs(selectedShader);
        const items = shaders.map(shader => ({
            id: shader.key,
            name: shader.name,
            details: `${shader.inputs.length} ${shader.inputs.length === 1 ? 'argument' : 'arguments'}`,
            thumbnail: (
                <span className={styles.tileShader}>
                    <img
                        alt=""
                        draggable={false}
                        src={shaderIcon}
                    />
                </span>
            )
        }));
        const statusClassName = styles[`status${this.state.status[0].toUpperCase()}${this.state.status.slice(1)}`];

        return (
            <AssetPanel
                buttons={[{
                    title: this.props.intl.formatMessage(messages.addShader),
                    img: blankShaderIcon,
                    onClick: this.handleCreate
                }, {
                    title: this.props.intl.formatMessage(messages.uploadShader),
                    img: fileUploadIcon,
                    onClick: this.handleUploadClick
                }]}
                items={items}
                selectedItemIndex={selectedItemIndex}
                onDeleteClick={this.handleDelete}
                onDuplicateClick={this.handleDuplicate}
                onExportClick={this.handleExport}
                onItemClick={this.handleSelect}
            >
                <input
                    accept=".glsl,.zip,text/plain,application/zip,application/x-zip-compressed"
                    className={styles.fileInput}
                    multiple
                    ref={this.setFileInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                {selectedShader ? (
                    <div className={styles.editor}>
                        <div className={styles.toolbar}>
                            <label className={styles.nameLabel}>
                                <span>{this.props.intl.formatMessage(messages.name)}</span>
                                <input
                                    className={styles.nameInput}
                                    maxLength="64"
                                    value={this.state.draftName}
                                    onChange={this.handleNameChange}
                                />
                            </label>
                            <div
                                aria-live="polite"
                                className={`${styles.saveStatus} ${statusClassName || ''}`}
                            >
                                <span className={styles.statusDot} />
                                <span>{this.renderStatus()}</span>
                            </div>
                            <button
                                className={styles.applyButton}
                                disabled={!this.state.dirty || this.state.saving}
                                onClick={this.handleApply}
                            >
                                {this.props.intl.formatMessage(messages.apply)}
                            </button>
                        </div>
                        <ShaderCodeEditor
                            label={this.props.intl.formatMessage(messages.source)}
                            value={this.state.draftSource}
                            onChange={this.handleSourceChange}
                            onSave={this.handleApply}
                        />
                        <div className={styles.uniformBar}>
                            <span className={styles.uniformHeading}>
                                {this.props.intl.formatMessage(messages.arguments)}
                            </span>
                            <div className={styles.uniformList}>
                                {draftInputs.length ? draftInputs.map(input => (
                                    <span
                                        className={styles.uniformChip}
                                        key={input.id}
                                        title={`${input.uniform}${typeof input.component === 'undefined' ? '' :
                                            `.${'xyzw'[input.component]}`} · ${input.type}`}
                                    >
                                        {input.label}
                                    </span>
                                )) : (
                                    <span className={styles.uniformEmpty}>
                                        {this.props.intl.formatMessage(messages.noArguments)}
                                    </span>
                                )}
                            </div>
                        </div>
                        {this.state.error ? (
                            <div
                                className={styles.errorPanel}
                                role="alert"
                            >
                                {this.state.error}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <img
                            alt=""
                            src={shaderIcon}
                        />
                        <h2>{this.props.intl.formatMessage(messages.emptyTitle)}</h2>
                        <p>{this.props.intl.formatMessage(messages.emptyDescription)}</p>
                        <div className={styles.emptyActions}>
                            <button
                                disabled={this.state.busy}
                                onClick={this.handleCreate}
                            >
                                {this.props.intl.formatMessage(messages.addShader)}
                            </button>
                            <button
                                disabled={this.state.busy}
                                onClick={this.handleUploadClick}
                            >
                                {this.props.intl.formatMessage(messages.uploadShader)}
                            </button>
                        </div>
                        {this.state.error ? (
                            <div
                                className={styles.errorPanel}
                                role="alert"
                            >
                                {this.state.error}
                            </div>
                        ) : null}
                    </div>
                )}
            </AssetPanel>
        );
    }
}

ShaderTab.propTypes = {
    intl: intlShape.isRequired,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            penFX: PropTypes.shape({})
        }).isRequired
    }).isRequired
};

export {ShaderTab};
export default injectIntl(ShaderTab);
