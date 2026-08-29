import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {
    getEditorKeyEdit,
    normalizeEditorKey
} from '../../lib/shader-editor-commands';
import styles from './shader-editor.css';

const KEYWORDS = new Set([
    'attribute', 'break', 'case', 'const', 'continue', 'default', 'discard', 'do', 'else', 'for',
    'if', 'in', 'inout', 'out', 'precision', 'return', 'struct', 'switch', 'uniform', 'varying', 'while'
]);
const TYPES = new Set([
    'bool', 'bvec2', 'bvec3', 'bvec4', 'float', 'int', 'ivec2', 'ivec3', 'ivec4', 'mat2', 'mat3',
    'mat4', 'sampler2D', 'samplerCube', 'vec2', 'vec3', 'vec4', 'void'
]);
const BUILT_INS = new Set([
    'clamp', 'cos', 'cross', 'distance', 'dot', 'exp', 'floor', 'fract', 'gl_FragColor', 'length',
    'max', 'min', 'mix', 'mod', 'normalize', 'pow', 'reflect', 'refract', 'sin', 'smoothstep', 'sqrt',
    'step', 'texture2D'
]);
// Kept as one expression so token precedence remains visible and deterministic.
// eslint-disable-next-line max-len
const TOKEN_PATTERN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

const tokenClassName = token => {
    if (token.indexOf('//') === 0 || token.indexOf('/*') === 0) return styles.tokenComment;
    if (token[0] === '#') return styles.tokenPreprocessor;
    if (token[0] === '"' || token[0] === "'") return styles.tokenString;
    if (/^(?:\d|\.)/.test(token)) return styles.tokenNumber;
    if (KEYWORDS.has(token)) return styles.tokenKeyword;
    if (TYPES.has(token)) return styles.tokenType;
    if (BUILT_INS.has(token) || /^gl_/.test(token)) return styles.tokenBuiltIn;
    return null;
};

const highlightGLSL = source => {
    const result = [];
    let previousIndex = 0;
    TOKEN_PATTERN.lastIndex = 0;
    let match = TOKEN_PATTERN.exec(source);
    let key = 0;
    while (match) {
        if (match.index > previousIndex) result.push(source.slice(previousIndex, match.index));
        const className = tokenClassName(match[0]);
        result.push(className ? (
            <span
                className={className}
                key={key++}
            >
                {match[0]}
            </span>
        ) : match[0]);
        previousIndex = TOKEN_PATTERN.lastIndex;
        match = TOKEN_PATTERN.exec(source);
    }
    if (previousIndex < source.length) result.push(source.slice(previousIndex));
    return result;
};

class ShaderCodeEditor extends React.PureComponent {
    constructor (props) {
        super(props);
        this.applyEdit = this.applyEdit.bind(this);
        this.handleBeforeInput = this.handleBeforeInput.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.setHighlight = this.setHighlight.bind(this);
        this.setLineNumbers = this.setLineNumbers.bind(this);
        this.setTextarea = this.setTextarea.bind(this);
        this.pendingSelection = null;
    }

    componentDidUpdate () {
        this.handleScroll();
    }

    handleChange (event) {
        const nativeEvent = event.nativeEvent || {};
        const character = nativeEvent.data;
        const pendingSelection = this.pendingSelection;
        this.pendingSelection = null;
        if (nativeEvent.inputType === 'insertText' && character && character.length === 1 && pendingSelection) {
            const edit = getEditorKeyEdit(
                this.props.value,
                pendingSelection.start,
                pendingSelection.end,
                character
            );
            if (edit) {
                this.applyEdit(edit, true);
                return;
            }
        }
        this.props.onChange(event.target.value);
    }

    applyEdit (edit, forceChange = false) {
        if (forceChange || edit.value !== this.props.value) this.props.onChange(edit.value);
        requestAnimationFrame(() => {
            if (!this.textarea) return;
            this.textarea.selectionStart = edit.selectionStart;
            this.textarea.selectionEnd = edit.selectionEnd;
        });
    }

    handleBeforeInput (event) {
        if (this.props.readOnly) return;
        const character = event.data || (event.nativeEvent && event.nativeEvent.data);
        if (!character || character.length !== 1) return;
        const edit = getEditorKeyEdit(
            this.props.value,
            event.target.selectionStart,
            event.target.selectionEnd,
            character
        );
        if (!edit) return;
        event.preventDefault();
        this.pendingSelection = null;
        this.applyEdit(edit);
    }

    handleKeyDown (event) {
        this.pendingSelection = {
            end: event.target.selectionEnd,
            start: event.target.selectionStart
        };
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            this.props.onSave();
            return;
        }
        if (this.props.readOnly || event.metaKey || event.ctrlKey || event.altKey) return;
        const edit = getEditorKeyEdit(
            this.props.value,
            event.target.selectionStart,
            event.target.selectionEnd,
            normalizeEditorKey(event.key, event.code, event.shiftKey, event.keyCode)
        );
        if (!edit) return;
        event.preventDefault();
        this.pendingSelection = null;
        this.applyEdit(edit);
    }

    handleScroll () {
        if (!this.textarea) return;
        if (this.highlight) {
            this.highlight.scrollTop = this.textarea.scrollTop;
            this.highlight.scrollLeft = this.textarea.scrollLeft;
        }
        if (this.lineNumbers) this.lineNumbers.scrollTop = this.textarea.scrollTop;
    }

    setHighlight (element) {
        this.highlight = element;
    }

    setLineNumbers (element) {
        this.lineNumbers = element;
    }

    setTextarea (element) {
        this.textarea = element;
    }

    render () {
        const lineCount = Math.max(1, this.props.value.split('\n').length);
        const lines = Array(lineCount)
            .fill(0)
            .map((_, index) => (
                <span key={index}>{index + 1}</span>
            ));
        return (
            <div className={classNames(styles.codeEditor, this.props.className)}>
                <div
                    aria-hidden="true"
                    className={styles.lineNumbers}
                    ref={this.setLineNumbers}
                >
                    {lines}
                </div>
                <div className={styles.codeViewport}>
                    <pre
                        aria-hidden="true"
                        className={styles.highlight}
                        ref={this.setHighlight}
                    ><code>{highlightGLSL(this.props.value)}{'\n'}</code></pre>
                    <textarea
                        aria-label={this.props.label}
                        autoCapitalize="off"
                        autoComplete="off"
                        className={styles.textarea}
                        readOnly={this.props.readOnly}
                        ref={this.setTextarea}
                        spellCheck={false}
                        value={this.props.value}
                        onBeforeInput={this.handleBeforeInput}
                        onChange={this.handleChange}
                        onKeyDown={this.handleKeyDown}
                        onScroll={this.handleScroll}
                    />
                </div>
            </div>
        );
    }
}

ShaderCodeEditor.propTypes = {
    className: PropTypes.string,
    label: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    readOnly: PropTypes.bool,
    value: PropTypes.string.isRequired
};

ShaderCodeEditor.defaultProps = {
    readOnly: false
};

export {highlightGLSL};
export default ShaderCodeEditor;
