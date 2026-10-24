import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import {
    COLOR_UNIFORM_TYPES,
    MENU_UNIFORM_TYPES,
    setUniformInputType
} from '../../lib/pen-fx/shader-uniforms';

import styles from './shader-editor.css';

const messages = defineMessages({
    arguments: {
        defaultMessage: 'Block arguments',
        description: 'Heading before automatically generated shader block arguments',
        id: 'movie.shader.arguments'
    },
    noArguments: {
        defaultMessage: 'No custom uniforms — the block has no arguments.',
        description: 'Message shown when a shader has no custom uniforms',
        id: 'movie.shader.noArguments'
    },
    inputType: {
        defaultMessage: 'Input',
        description: 'Label for the choice of how a shader uniform appears as a block argument',
        id: 'movie.shader.inputType'
    },
    typeNumber: {
        defaultMessage: 'Number',
        description: 'Shader block argument type: a number field',
        id: 'movie.shader.typeNumber'
    },
    typeColor: {
        defaultMessage: 'Color',
        description: 'Shader block argument type: a color picker',
        id: 'movie.shader.typeColor'
    },
    typeMenu: {
        defaultMessage: 'Menu',
        description: 'Shader block argument type: a dropdown menu',
        id: 'movie.shader.typeMenu'
    },
    color: {
        defaultMessage: 'Default color',
        description: 'Label for the default color of a color shader block argument',
        id: 'movie.shader.defaultColor'
    },
    menuItems: {
        defaultMessage: 'Items',
        description: 'Label for the comma-separated items of a menu shader block argument',
        id: 'movie.shader.menuItems'
    },
    menuItemsPlaceholder: {
        defaultMessage: 'soft, hard',
        description: 'Example comma-separated menu items for a shader block argument',
        id: 'movie.shader.menuItemsPlaceholder'
    },
    menuDefault: {
        defaultMessage: 'Default',
        description: 'Label for the default item of a menu shader block argument',
        id: 'movie.shader.menuDefault'
    },
    menuIndexHint: {
        defaultMessage: 'The uniform receives the index of the chosen item, starting at 0.',
        description: 'Explains what value a menu shader block argument passes to GLSL',
        id: 'movie.shader.menuIndexHint'
    },
    close: {
        defaultMessage: 'Close',
        description: 'Button to close the shader block argument editor',
        id: 'movie.shader.closeArgument'
    }
});

const DEFAULT_MENU_ITEMS = ['option 1', 'option 2'];

// The input types the editor offers for a uniform, or null when it can only be a number/boolean field.
const typeChoicesFor = uniformType => {
    if (COLOR_UNIFORM_TYPES.has(uniformType)) return ['number', 'color'];
    if (MENU_UNIFORM_TYPES.has(uniformType)) return ['number', 'menu'];
    return null;
};

const splitItems = text => String(text || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length);

const inputTitle = input => `${input.uniform}${typeof input.component === 'undefined' ? '' :
    `.${'xyzw'[input.component]}`} · ${input.type}`;

class ShaderArguments extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChipClick',
            'handleClose',
            'handleColorChange',
            'handleMenuDefaultChange',
            'handleMenuItemsBlur',
            'handleMenuItemsChange',
            'handleTypeClick'
        ]);
        this.state = {
            error: null,
            menuDraft: null,
            selectedUniform: null
        };
    }

    getSelectedInput () {
        if (!this.state.selectedUniform) return null;
        return this.props.inputs.find(input => input.uniform === this.state.selectedUniform) || null;
    }

    applySpec (spec) {
        try {
            const source = setUniformInputType(this.props.source, this.state.selectedUniform, spec);
            this.setState({error: null});
            if (source !== this.props.source) this.props.onSourceChange(source);
            return true;
        } catch (error) {
            this.setState({error: error.message});
            return false;
        }
    }

    handleChipClick (event) {
        const uniform = event.currentTarget.dataset.uniform;
        this.setState(state => ({
            error: null,
            menuDraft: null,
            selectedUniform: state.selectedUniform === uniform ? null : uniform
        }));
    }

    handleClose () {
        this.setState({error: null, menuDraft: null, selectedUniform: null});
    }

    handleTypeClick (event) {
        const type = event.currentTarget.dataset.type;
        const input = this.getSelectedInput();
        if (!input || input.type === type) return;
        this.setState({menuDraft: null});
        if (type === 'color') this.applySpec({type, defaultValue: '#ffffff'});
        else if (type === 'menu') this.applySpec({type, items: DEFAULT_MENU_ITEMS});
        else this.applySpec({type: 'number'});
    }

    handleColorChange (event) {
        this.applySpec({type: 'color', defaultValue: event.target.value});
    }

    handleMenuItemsChange (event) {
        const menuDraft = event.target.value;
        this.setState({menuDraft});
        const input = this.getSelectedInput();
        const items = splitItems(menuDraft);
        if (!input || !items.length) return;
        const spec = {type: 'menu', items};
        if (items.indexOf(input.defaultValue) !== -1) spec.defaultValue = input.defaultValue;
        this.applySpec(spec);
    }

    handleMenuItemsBlur () {
        this.setState({menuDraft: null});
    }

    handleMenuDefaultChange (event) {
        const input = this.getSelectedInput();
        if (!input) return;
        this.applySpec({type: 'menu', items: input.items, defaultValue: event.target.value});
    }

    renderChip (input) {
        const {intl, editable} = this.props;
        const choices = editable && typeChoicesFor(input.uniformType);
        const content = (
            <React.Fragment>
                {input.type === 'color' ? (
                    <span
                        className={styles.uniformSwatch}
                        style={{background: input.defaultValue}}
                    />
                ) : null}
                <span>{input.label}</span>
                {input.type === 'menu' ? <span className={styles.uniformMenuMark}>{'▾'}</span> : null}
            </React.Fragment>
        );
        if (!choices) {
            return (
                <span
                    className={styles.uniformChip}
                    key={input.id}
                    title={inputTitle(input)}
                >
                    {content}
                </span>
            );
        }
        const selected = this.state.selectedUniform === input.uniform;
        return (
            <button
                aria-expanded={selected}
                className={classNames(styles.uniformChip, styles.uniformChipButton, {
                    [styles.uniformChipSelected]: selected
                })}
                data-uniform={input.uniform}
                key={input.id}
                title={`${inputTitle(input)} — ${intl.formatMessage(messages.inputType)}`}
                type="button"
                onClick={this.handleChipClick}
            >
                {content}
            </button>
        );
    }

    renderEditor (input) {
        const {intl} = this.props;
        const typeLabels = {
            color: messages.typeColor,
            menu: messages.typeMenu,
            number: messages.typeNumber
        };
        return (
            <div
                className={styles.argumentEditor}
                role="group"
                aria-label={input.uniform}
            >
                <code className={styles.argumentUniform}>
                    {`${input.uniformType} ${input.uniform}`}
                </code>
                <div
                    aria-label={intl.formatMessage(messages.inputType)}
                    className={styles.argumentTypes}
                    role="radiogroup"
                >
                    {typeChoicesFor(input.uniformType).map(type => {
                        const checked = type === 'number' ? input.type !== 'color' && input.type !== 'menu' :
                            input.type === type;
                        return (
                            <button
                                aria-checked={checked}
                                className={classNames(styles.argumentType, {
                                    [styles.argumentTypeSelected]: checked
                                })}
                                data-type={type}
                                key={type}
                                role="radio"
                                type="button"
                                onClick={this.handleTypeClick}
                            >
                                {intl.formatMessage(typeLabels[type])}
                            </button>
                        );
                    })}
                </div>
                {input.type === 'color' ? (
                    <label className={styles.argumentField}>
                        <span>{intl.formatMessage(messages.color)}</span>
                        <input
                            className={styles.argumentColor}
                            type="color"
                            value={input.defaultValue}
                            onChange={this.handleColorChange}
                        />
                    </label>
                ) : null}
                {input.type === 'menu' ? (
                    <React.Fragment>
                        <label className={classNames(styles.argumentField, styles.argumentItemsField)}>
                            <span>{intl.formatMessage(messages.menuItems)}</span>
                            <input
                                className={styles.argumentText}
                                placeholder={intl.formatMessage(messages.menuItemsPlaceholder)}
                                title={intl.formatMessage(messages.menuIndexHint)}
                                type="text"
                                value={this.state.menuDraft === null ? input.items.join(', ') : this.state.menuDraft}
                                onBlur={this.handleMenuItemsBlur}
                                onChange={this.handleMenuItemsChange}
                            />
                        </label>
                        <label className={styles.argumentField}>
                            <span>{intl.formatMessage(messages.menuDefault)}</span>
                            <select
                                className={styles.argumentSelect}
                                value={input.defaultValue}
                                onChange={this.handleMenuDefaultChange}
                            >
                                {input.items.map(item => (
                                    <option
                                        key={item}
                                        value={item}
                                    >
                                        {item}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </React.Fragment>
                ) : null}
                <button
                    aria-label={intl.formatMessage(messages.close)}
                    className={styles.argumentClose}
                    title={intl.formatMessage(messages.close)}
                    type="button"
                    onClick={this.handleClose}
                >
                    {'×'}
                </button>
            </div>
        );
    }

    render () {
        const {intl, inputs} = this.props;
        const selectedInput = this.props.editable ? this.getSelectedInput() : null;
        return (
            <React.Fragment>
                <div className={styles.uniformBar}>
                    <span className={styles.uniformHeading}>
                        {intl.formatMessage(messages.arguments)}
                    </span>
                    <div className={styles.uniformList}>
                        {inputs.length ? inputs.map(input => this.renderChip(input)) : (
                            <span className={styles.uniformEmpty}>
                                {intl.formatMessage(messages.noArguments)}
                            </span>
                        )}
                    </div>
                </div>
                {selectedInput && typeChoicesFor(selectedInput.uniformType) ? this.renderEditor(selectedInput) : null}
                {selectedInput && this.state.error ? (
                    <div
                        className={styles.argumentError}
                        role="alert"
                    >
                        {this.state.error}
                    </div>
                ) : null}
            </React.Fragment>
        );
    }
}

ShaderArguments.propTypes = {
    editable: PropTypes.bool,
    inputs: PropTypes.arrayOf(PropTypes.shape({
        component: PropTypes.number,
        defaultValue: PropTypes.oneOfType([PropTypes.bool, PropTypes.number, PropTypes.string]),
        id: PropTypes.string.isRequired,
        items: PropTypes.arrayOf(PropTypes.string),
        label: PropTypes.string.isRequired,
        type: PropTypes.string.isRequired,
        uniform: PropTypes.string,
        uniformType: PropTypes.string
    })).isRequired,
    intl: intlShape.isRequired,
    source: PropTypes.string.isRequired,
    onSourceChange: PropTypes.func.isRequired
};

ShaderArguments.defaultProps = {
    editable: true
};

export {ShaderArguments};
export default injectIntl(ShaderArguments);
