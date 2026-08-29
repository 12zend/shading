import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

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
        this.handleChange = this.handleChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.setHighlight = this.setHighlight.bind(this);
        this.setLineNumbers = this.setLineNumbers.bind(this);
        this.setTextarea = this.setTextarea.bind(this);
    }

    componentDidUpdate () {
        this.handleScroll();
    }

    handleChange (event) {
        this.props.onChange(event.target.value);
    }

    handleKeyDown (event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            this.props.onSave();
            return;
        }
        if (event.key !== 'Tab' || this.props.readOnly) return;
        event.preventDefault();
        const start = event.target.selectionStart;
        const end = event.target.selectionEnd;
        const replacement = '    ';
        const value = `${this.props.value.slice(0, start)}${replacement}${this.props.value.slice(end)}`;
        this.props.onChange(value);
        requestAnimationFrame(() => {
            if (!this.textarea) return;
            this.textarea.selectionStart = start + replacement.length;
            this.textarea.selectionEnd = start + replacement.length;
        });
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
