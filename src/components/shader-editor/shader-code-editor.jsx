import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage} from 'react-intl';

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

// Literal, non-overlapping matches: replacement strings are never interpreted as regex syntax.
const findMatches = (source, query) => {
    const matches = [];
    if (!query) return matches;
    let start = source.indexOf(query);
    while (start !== -1) {
        matches.push(start);
        start = source.indexOf(query, start + query.length);
    }
    return matches;
};

const highlightMatches = (source, query) => {
    const matches = findMatches(source, query);
    if (!matches.length) return highlightGLSL(source);
    // Split the already-tokenized output to preserve syntax coloring across match boundaries.
    let offset = 0;
    let matchIndex = 0;
    const decorate = text => {
        const parts = [];
        let local = 0;
        while (local < text.length) {
            while (matchIndex < matches.length && matches[matchIndex] + query.length <= offset + local) {
                matchIndex++;
            }
            const start = matches[matchIndex];
            const inside = typeof start === 'number' && start <= offset + local;
            const end = typeof start === 'number' ? (inside ? start + query.length : start) : Infinity;
            const next = Math.min(text.length, end - offset);
            const fragment = text.slice(local, next);
            parts.push(inside ? <mark key={local}>{fragment}</mark> : fragment);
            local = next;
        }
        offset += text.length;
        return parts;
    };
    return highlightGLSL(source).map(token => (
        typeof token === 'string' ? decorate(token) : React.cloneElement(token, {}, decorate(token.props.children))
    ));
};

class ShaderCodeEditor extends React.PureComponent {
    constructor (props) {
        super(props);
        this.applyEdit = this.applyEdit.bind(this);
        this.handleBeforeInput = this.handleBeforeInput.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.setScrollContainer = this.setScrollContainer.bind(this);
        this.setTextarea = this.setTextarea.bind(this);
        this.pendingSelection = null;
        this.state = {searchOpen: false, query: '', replacement: '', selectedText: '', selectionStart: 0};
        ['handleSearchChange', 'handleReplacementChange', 'handleSearchKeyDown',
            'handlePreviousMatch', 'handleNextMatch', 'setSearchInput'].forEach(name => {
            this[name] = this[name].bind(this);
        });
        this.handleSelect = this.handleSelect.bind(this);
        this.handleOpenSearch = this.handleOpenSearch.bind(this);
        this.handleCloseSearch = this.handleCloseSearch.bind(this);
        this.handleReplaceAll = this.handleReplaceAll.bind(this);
    }

    setSearchInput (element) {
        this.searchInput = element;
    }

    handleSearchChange (event) {
        this.setState({query: event.target.value});
    }

    handleReplacementChange (event) {
        this.setState({replacement: event.target.value});
    }

    handleSearchKeyDown (event) {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            this.navigateMatch(event.shiftKey ? -1 : 1);
        }
        if (event.key === 'Escape') this.handleCloseSearch();
    }

    handlePreviousMatch () {
        this.navigateMatch(-1);
    }

    handleNextMatch () {
        this.navigateMatch(1);
    }

    handleSelect () {
        if (!this.textarea) return;
        const {selectionStart, selectionEnd} = this.textarea;
        const selectedText = this.props.value.slice(selectionStart, selectionEnd);
        this.setState({selectedText: selectedText.trim() ? selectedText : '', selectionStart});
    }

    handleOpenSearch () {
        this.setState({searchOpen: true, query: this.state.selectedText || this.state.query}, () => {
            this.searchInput.focus();
            this.searchInput.select();
        });
    }

    handleCloseSearch () {
        this.setState({searchOpen: false}, () => this.textarea.focus());
    }

    navigateMatch (direction) {
        const matches = findMatches(this.props.value, this.state.query);
        if (!matches.length) return;
        const cursor = this.textarea.selectionStart;
        const next = direction > 0 ? matches.find(index => index > cursor) :
            matches.slice().reverse()
                .find(index => index < cursor);
        const start = typeof next === 'number' ? next : matches[direction > 0 ? 0 : matches.length - 1];
        this.textarea.focus();
        this.textarea.setSelectionRange(start, start + this.state.query.length);
        const metrics = window.getComputedStyle(this.textarea);
        const lineHeight = parseFloat(metrics.lineHeight);
        const top = (this.props.value.slice(0, start).split('\n').length - 1) * lineHeight;
        this.scrollContainer.scrollTop = Math.max(0, top - (this.scrollContainer.clientHeight / 2));
        const lineStart = this.props.value.lastIndexOf('\n', start - 1) + 1;
        const prefix = this.props.value.slice(lineStart, start).replace(/\t/g, '    ');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
            context.font = metrics.font;
            this.scrollContainer.scrollLeft = Math.max(0, context.measureText(prefix).width -
                (this.scrollContainer.clientWidth / 2));
        }
        this.handleSelect();
    }

    handleReplaceAll () {
        const {query, replacement} = this.state;
        if (this.props.readOnly || !query) return;
        const value = this.props.value.split(query).join(replacement);
        this.applyEdit({value, selectionStart: 0, selectionEnd: 0});
        this.setState({selectedText: '', selectionStart: 0});
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
        if ((event.metaKey || event.ctrlKey) && ['f', 'h'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            this.handleOpenSearch();
            return;
        }
        if (event.key === 'Escape' && this.state.searchOpen) {
            event.preventDefault();
            this.handleCloseSearch();
            return;
        }
        if (this.state.searchOpen && (event.key === 'F3' ||
            ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g'))) {
            event.preventDefault();
            this.navigateMatch(event.shiftKey ? -1 : 1);
            return;
        }
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

    setScrollContainer (element) {
        this.scrollContainer = element;
    }

    setTextarea (element) {
        this.textarea = element;
    }

    render () {
        const {searchOpen, query, replacement, selectedText, selectionStart} = this.state;
        const matches = findMatches(this.props.value, query);
        const currentMatch = matches.indexOf(selectionStart) + 1;
        const lineCount = Math.max(1, this.props.value.split('\n').length);
        const lines = Array(lineCount)
            .fill(0)
            .map((_, index) => (
                <span key={index}>{index + 1}</span>
            ));
        return (
            <div className={classNames(styles.codeEditor, this.props.className)}>
                <div className={styles.searchBar}>
                    <button
                        type="button"
                        onClick={searchOpen ? this.handleCloseSearch : this.handleOpenSearch}
                    >
                        <FormattedMessage
                            id="movie.shader.search"
                            defaultMessage="Find / Replace"
                        />
                    </button>
                    {searchOpen && <React.Fragment>
                        <label>
                            <FormattedMessage
                                id="movie.shader.find"
                                defaultMessage="Find (case-sensitive)"
                            />
                            <input
                                ref={this.setSearchInput}
                                value={query}
                                onChange={this.handleSearchChange}
                                onKeyDown={this.handleSearchKeyDown}
                            />
                        </label>
                        <span aria-live="polite">{currentMatch}{' / '}{matches.length}</span>
                        <button
                            type="button"
                            disabled={!matches.length}
                            onClick={this.handlePreviousMatch}
                        >
                            <FormattedMessage
                                id="movie.shader.previousMatch"
                                defaultMessage="Previous"
                            />
                        </button>
                        <button
                            type="button"
                            disabled={!matches.length}
                            onClick={this.handleNextMatch}
                        >
                            <FormattedMessage
                                id="movie.shader.nextMatch"
                                defaultMessage="Next"
                            />
                        </button>
                        <label>
                            <FormattedMessage
                                id="movie.shader.replacement"
                                defaultMessage="Replace with"
                            />
                            <input
                                disabled={this.props.readOnly}
                                value={replacement}
                                onChange={this.handleReplacementChange}
                                onKeyDown={this.handleSearchKeyDown}
                            />
                        </label>
                        <button
                            type="button"
                            disabled={this.props.readOnly || !matches.length}
                            onClick={this.handleReplaceAll}
                        >
                            <FormattedMessage
                                id="movie.shader.replaceAll"
                                defaultMessage="Replace all"
                            />
                        </button>
                        <button
                            type="button"
                            onClick={this.handleCloseSearch}
                        >
                            <FormattedMessage
                                id="movie.shader.closeSearch"
                                defaultMessage="Close"
                            />
                        </button>
                    </React.Fragment>}
                </div>
                <div
                    className={styles.codeBody}
                    ref={this.setScrollContainer}
                >
                    <div
                        aria-hidden="true"
                        className={styles.lineNumbers}
                    >
                        {lines}
                    </div>
                    <div className={styles.codeViewport}>
                        <pre
                            aria-hidden="true"
                            className={styles.highlight}
                        >
                            <code>
                                {highlightMatches(this.props.value, searchOpen ? query : selectedText)}{'\n'}
                            </code>
                        </pre>
                        <textarea
                            aria-label={this.props.label}
                            autoCapitalize="off"
                            autoComplete="off"
                            className={styles.textarea}
                            readOnly={this.props.readOnly}
                            ref={this.setTextarea}
                            spellCheck={false}
                            wrap="off"
                            value={this.props.value}
                            onBeforeInput={this.handleBeforeInput}
                            onChange={this.handleChange}
                            onKeyDown={this.handleKeyDown}
                            onSelect={this.handleSelect}
                        />
                    </div>
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

export {findMatches, highlightGLSL, highlightMatches};
export default ShaderCodeEditor;
