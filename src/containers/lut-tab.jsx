import PropTypes from 'prop-types';
import React from 'react';
import {injectIntl, intlShape} from 'react-intl';
import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import downloadBlob from '../lib/download-blob';
import styles from '../components/lut-editor/lut-editor.css';

class LUTTab extends React.Component {
    constructor (props) {
        super(props);
        this.state = {selected: null, name: '', error: null, busy: false, actualSize: false};
        this.handleChange = this.handleChange.bind(this);
        this.handleUpload = this.handleUpload.bind(this);
        this.handleOpenPicker = () => this.input && this.input.click();
        this.handleDelete = index => this.manager.remove(this.manager.items[index].id);
        this.handleExport = index => this.export(index);
        this.handleSelect = index => this.select(index);
        this.handleSetInput = input => {
            this.input = input;
        };
        this.handleRename = () => this.manager.rename(this.state.selected, this.state.name);
        this.handleNameChange = event => this.setState({name: event.target.value});
        this.handleSubmit = event => {
            event.preventDefault();
            this.handleRename();
        };
        this.handleToggleSize = () => this.setState(state => ({actualSize: !state.actualSize}));
        this.handleExportSelected = () => this.export(this.manager.items.findIndex(
            item => item.id === this.state.selected
        ));
    }
    componentDidMount () {
        this.mounted = true;
        this.manager = this.props.vm.runtime.penFX.luts;
        this.manager.on('changed', this.handleChange);
        this.handleChange();
    }
    componentWillUnmount () {
        this.mounted = false;
        this.manager.off('changed', this.handleChange);
    }
    text (key, fallback) {
        return this.props.intl.formatMessage({id: `movie.lut.${key}`, defaultMessage: fallback});
    }
    handleChange () {
        if (!this.mounted) return;
        const selected = this.manager.find(this.state.selected) || this.manager.items[0];
        this.setState({selected: selected ? selected.id : null, name: selected ? selected.name : ''});
    }
    select (index) {
        const item = this.manager.items[index];
        if (item) this.setState({selected: item.id, name: item.name, error: null});
    }
    async handleUpload (event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length || this.state.busy) return;
        this.setState({busy: true, error: null});
        try {
            for (const file of files) {
                const item = await this.manager.importFile(file);
                if (this.mounted) this.setState({selected: item.id, name: item.name});
            }
        } catch (error) {
            if (this.mounted) this.setState({error: error.message});
        } finally {
            if (this.mounted) this.setState({busy: false});
        }
    }
    export (index) {
        const item = this.manager.items[index];
        if (!item) return;
        const bytes = Uint8Array.from(atob(item.data.slice(22)), character => character.charCodeAt(0));
        downloadBlob(`${item.name}.png`, new Blob([bytes], {type: 'image/png'}));
    }
    render () {
        const items = this.manager ? this.manager.items : [];
        const selected = items.find(item => item.id === this.state.selected);
        const uploadLabel = this.text('upload', 'Upload LUT');
        return (
            <AssetPanel
                buttons={[{title: uploadLabel, img: fileUploadIcon, onClick: this.handleOpenPicker}]}
                items={items.map(item => ({
                    id: item.id,
                    name: item.name,
                    details: `${item.width} × ${item.height}`,
                    thumbnail: <img
                        alt=""
                        className={styles.thumbnail}
                        src={item.data}
                    />
                }))}
                selectedItemIndex={Math.max(0, items.indexOf(selected))}
                onDeleteClick={this.handleDelete}
                onExportClick={this.handleExport}
                onItemClick={this.handleSelect}
            >
                <input
                    accept=".png,image/png"
                    className={styles.fileInput}
                    disabled={this.state.busy}
                    multiple
                    ref={this.handleSetInput}
                    type="file"
                    onChange={this.handleUpload}
                />
                <section
                    aria-label="LUT"
                    className={styles.editor}
                >
                    {selected ? (
                        <React.Fragment>
                            <form
                                className={styles.toolbar}
                                onSubmit={this.handleSubmit}
                            >
                                <label className={styles.nameLabel}>
                                    {this.text('name', 'LUT name')}
                                    <input
                                        maxLength={64}
                                        value={this.state.name}
                                        onBlur={this.handleRename}
                                        onChange={this.handleNameChange}
                                    />
                                </label>
                                <button
                                    aria-pressed={this.state.actualSize}
                                    type="button"
                                    onClick={this.handleToggleSize}
                                >
                                    {this.state.actualSize ? this.text('fit', 'Fit preview') :
                                        this.text('actualSize', 'View at 100%')}
                                </button>
                                <button
                                    type="button"
                                    onClick={this.handleExportSelected}
                                >
                                    {this.text('export', 'Export PNG')}
                                </button>
                            </form>
                            <div className={styles.metadata}>
                                <strong>{`${selected.width} × ${selected.height} px`}</strong>
                                <span>{`${selected.size} × ${selected.size} × ${selected.size} RGB`}</span>
                                <span>{this.text('original', 'Original PNG preserved')}</span>
                            </div>
                            <div
                                className={styles.preview}
                                tabIndex={0}
                            >
                                <img
                                    alt={selected.name}
                                    className={this.state.actualSize ? styles.actualSize : styles.fit}
                                    height={selected.height}
                                    src={selected.data}
                                    width={selected.width}
                                />
                            </div>
                            <p className={styles.help}>
                                {this.text('help',
                                    'Choose this LUT in the PenFX LUT block and set its mix from 0 to 100%. ' +
                                    'Preview scaling does not change the image used by the effect.')}
                            </p>
                        </React.Fragment>
                    ) : (
                        <div className={styles.empty}>
                            <h2>{this.text('title', 'Add a color LUT')}</h2>
                            <p>{this.text('description', 'Import a PNG LUT without resizing it. ' +
                                'Horizontal strips, vertical strips, and square tile atlases are supported.')}</p>
                            <button
                                disabled={this.state.busy}
                                type="button"
                                onClick={this.handleOpenPicker}
                            >
                                {uploadLabel}
                            </button>
                        </div>
                    )}
                    {this.state.busy ? <p role="status">{this.text('loading', 'Loading original PNG…')}</p> : null}
                    {this.state.error ? <p
                        className={styles.error}
                        role="alert"
                    >{this.state.error}</p> : null}
                </section>
            </AssetPanel>
        );
    }
}
LUTTab.propTypes = {
    intl: intlShape.isRequired,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({penFX: PropTypes.shape({luts: PropTypes.object})}).isRequired
    }).isRequired
};
export {LUTTab};
export default injectIntl(LUTTab);
