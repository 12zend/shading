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
        this.state = {selected: null,
            name: '',
            error: null,
            busy: false,
            actualSize: false,
            mode: 'auto',
            size: 32,
            columns: 32,
            index: 1,
            flipGreen: false};
        this.handleLayoutChange = event => {
            const {name, value, checked, type} = event.target;
            this.setState({[name]: type === 'checkbox' ? checked : value});
        };
        this.handleApplyLayout = () => {
            try {
                this.manager.configure(this.state.selected, this.layoutSettings());
                this.setState({error: null});
            } catch (error) {
                this.setState({error: error.message});
            }
        };
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
        if (selected && selected.id !== this.state.selected) this.select(this.manager.items.indexOf(selected));
        else this.setState({selected: selected ? selected.id : null, name: selected ? selected.name : ''});
    }
    layoutSettings () {
        return {mode: this.state.mode,
            size: Number(this.state.size),
            columns: Number(this.state.columns),
            index: Number(this.state.index) - 1,
            flipGreen: this.state.flipGreen};
    }
    select (index) {
        const item = this.manager.items[index];
        if (item) {
            this.setState({selected: item.id,
                name: item.name,
                error: null,
                mode: item.mode || 'auto',
                size: item.size,
                columns: item.columns || item.size,
                index: (item.index || 0) + 1,
                flipGreen: item.flipGreen || false});
        }
    }
    async handleUpload (event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length || this.state.busy) return;
        this.setState({busy: true, error: null});
        try {
            for (const file of files) {
                const item = await this.manager.importFile(file, this.layoutSettings());
                if (this.mounted) this.select(this.manager.items.indexOf(item));
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
                    <fieldset
                        className={styles.layoutControls}
                        disabled={this.state.busy}
                    >
                        <legend>{this.text('layout', 'LUT image layout')}</legend>
                        <label>
                            {this.text('format', 'Format')}
                            <select
                                name="mode"
                                value={this.state.mode}
                                onChange={this.handleLayoutChange}
                            >
                                <option value="auto">{this.text('auto', 'Auto detect / ReShade MultiLUT')}</option>
                                <option value="tiles">{this.text('tiles', 'Custom tile atlas')}</option>
                                <option value="hald">{this.text('hald', 'Hald CLUT')}</option>
                            </select>
                        </label>
                        {this.state.mode === 'tiles' ? <React.Fragment>
                            <label>
                                {this.text('cubeSize', 'RGB size')}
                                <input
                                    min={2}
                                    max={256}
                                    name="size"
                                    step={1}
                                    type="number"
                                    value={this.state.size}
                                    onChange={this.handleLayoutChange}
                                />
                            </label>
                            <label>
                                {this.text('columns', 'Slice columns')}
                                <input
                                    min={1}
                                    max={256}
                                    name="columns"
                                    step={1}
                                    type="number"
                                    value={this.state.columns}
                                    onChange={this.handleLayoutChange}
                                />
                            </label>
                        </React.Fragment> : null}
                        <label>
                            {this.text('index', 'LUT number (from 1)')}
                            <input
                                min={1}
                                name="index"
                                step={1}
                                type="number"
                                value={this.state.index}
                                onChange={this.handleLayoutChange}
                            />
                        </label>
                        <label>
                            <input
                                checked={this.state.flipGreen}
                                name="flipGreen"
                                type="checkbox"
                                onChange={this.handleLayoutChange}
                            />
                            {this.text('flipGreen', 'Reverse green axis')}
                        </label>
                        <button
                            disabled={!selected}
                            type="button"
                            onClick={this.handleApplyLayout}
                        >
                            {this.text('applyLayout', 'Apply to selected LUT')}
                        </button>
                        <p>{this.text('layoutHelp', 'These settings also apply to new imports. ' +
                            'Multiple LUTs are numbered left to right, then top to bottom. ' +
                            'Choose Hald explicitly: square images can have different color ordering.')}</p>
                    </fieldset>
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
                                <span>{`${this.text('count', 'LUTs in image')}: ${selected.count || 1}`}</span>
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
                                'Horizontal/vertical strips, tile atlases, ReShade MultiLUT ' +
                                'and Hald CLUT are supported.')}</p>
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
