const INDENT = '    ';
const BRACKET_PAIRS = Object.freeze({
    '(': ')',
    '[': ']',
    '{': '}'
});
const CLOSING_BRACKETS = Object.freeze({
    ')': '(',
    ']': '[',
    '}': '{'
});
const EDITOR_KEYS = new Set([
    '(', ')', '[', ']', '{', '}',
    'Backspace', 'Enter', 'Tab'
]);

const normalizeEditorKey = (key, code, shiftKey, keyCode) => {
    if (EDITOR_KEYS.has(key)) return key;
    if (keyCode === 8) return 'Backspace';
    if (keyCode === 9) return 'Tab';
    if (keyCode === 13) return 'Enter';
    if (shiftKey && (code === 'Digit9' || keyCode === 57)) return '(';
    if (shiftKey && (code === 'Digit0' || keyCode === 48)) return ')';
    if (code === 'BracketLeft' || keyCode === 219) return shiftKey ? '{' : '[';
    if (code === 'BracketRight' || keyCode === 221) return shiftKey ? '}' : ']';
    return key;
};

const structuralDepth = source => {
    const text = String(source || '');
    let depth = 0;
    let state = 'code';
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') state = 'code';
        } else if (state === 'block-comment') {
            if (character === '*' && next === '/') {
                index++;
                state = 'code';
            }
        } else if (state === 'string') {
            if (character === '\\') index++;
            else if (character === '"') state = 'code';
        } else if (character === '/' && next === '/') {
            index++;
            state = 'line-comment';
        } else if (character === '/' && next === '*') {
            index++;
            state = 'block-comment';
        } else if (character === '"') {
            state = 'string';
        } else if (BRACKET_PAIRS[character]) {
            depth++;
        } else if (CLOSING_BRACKETS[character]) {
            depth = Math.max(0, depth - 1);
        }
    }
    return depth;
};

const lastNonWhitespace = value => {
    const match = /\S\s*$/.exec(value);
    return match ? match[0][0] : '';
};

const firstNonWhitespace = value => {
    const match = /^\s*(\S)/.exec(value);
    return match ? match[1] : '';
};

const replaceRange = (value, start, end, replacement, selectionStart, selectionEnd = selectionStart) => ({
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart,
    selectionEnd
});

const getEditorKeyEdit = (value, selectionStart, selectionEnd, key) => {
    const source = String(value || '');
    const start = Math.max(0, Math.min(source.length, selectionStart));
    const end = Math.max(start, Math.min(source.length, selectionEnd));

    if (key === 'Tab') {
        return replaceRange(source, start, end, INDENT, start + INDENT.length);
    }

    const closingBracket = BRACKET_PAIRS[key];
    if (closingBracket) {
        const selected = source.slice(start, end);
        const replacement = `${key}${selected}${closingBracket}`;
        if (start !== end) {
            return replaceRange(source, start, end, replacement, start + 1, end + 1);
        }
        return replaceRange(source, start, end, replacement, start + 1);
    }

    if (CLOSING_BRACKETS[key] && start === end && source[start] === key) {
        return {
            value: source,
            selectionStart: start + 1,
            selectionEnd: start + 1
        };
    }

    if (key === 'Backspace' && start === end && start > 0 && BRACKET_PAIRS[source[start - 1]] === source[start]) {
        return replaceRange(source, start - 1, start + 1, '', start - 1);
    }

    if (key !== 'Enter') return null;

    const before = source.slice(0, start);
    const after = source.slice(end);
    const depth = structuralDepth(before);
    const previousCharacter = lastNonWhitespace(before);
    const nextCharacter = firstNonWhitespace(after);
    const isEmptyPair = BRACKET_PAIRS[previousCharacter] === nextCharacter;
    if (isEmptyPair) {
        const innerIndent = INDENT.repeat(depth);
        const outerIndent = INDENT.repeat(Math.max(0, depth - 1));
        const replacement = `\n${innerIndent}\n${outerIndent}`;
        return replaceRange(source, start, end, replacement, start + 1 + innerIndent.length);
    }

    const nextDepth = CLOSING_BRACKETS[nextCharacter] ? Math.max(0, depth - 1) : depth;
    const indent = INDENT.repeat(nextDepth);
    const replacement = `\n${indent}`;
    return replaceRange(source, start, end, replacement, start + replacement.length);
};

export {
    BRACKET_PAIRS,
    INDENT,
    getEditorKeyEdit,
    normalizeEditorKey,
    structuralDepth
};
