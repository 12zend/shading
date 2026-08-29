import {
    getEditorKeyEdit,
    normalizeEditorKey,
    structuralDepth
} from '../../../src/lib/shader-editor-commands';

describe('shader editor commands', () => {
    test.each([
        ['(', ')'],
        ['[', ']'],
        ['{', '}']
    ])('inserts the matching %s bracket and leaves the caret inside', (opening, closing) => {
        expect(getEditorKeyEdit('shader', 6, 6, opening)).toEqual({
            value: `shader${opening}${closing}`,
            selectionStart: 7,
            selectionEnd: 7
        });
    });

    test('wraps a selection and keeps it selected', () => {
        expect(getEditorKeyEdit('position', 0, 8, '(')).toEqual({
            value: '(position)',
            selectionStart: 1,
            selectionEnd: 9
        });
    });

    test('moves over an existing closing bracket instead of duplicating it', () => {
        expect(getEditorKeyEdit('vec2()', 5, 5, ')')).toEqual({
            value: 'vec2()',
            selectionStart: 6,
            selectionEnd: 6
        });
    });

    test('places an indented blank line inside an empty bracket pair', () => {
        expect(getEditorKeyEdit('void main() {}', 13, 13, 'Enter')).toEqual({
            value: 'void main() {\n    \n}',
            selectionStart: 18,
            selectionEnd: 18
        });
    });

    test('indents a new line by structural depth and ignores comments', () => {
        const source = 'void main() {\n    // ignored {([\n    if (true) {';
        const edit = getEditorKeyEdit(source, source.length, source.length, 'Enter');

        expect(structuralDepth(source)).toBe(2);
        expect(edit.value).toBe(`${source}\n        `);
    });

    test('backspace removes an untouched bracket pair together', () => {
        expect(getEditorKeyEdit('vec2()', 5, 5, 'Backspace')).toEqual({
            value: 'vec2',
            selectionStart: 4,
            selectionEnd: 4
        });
    });

    test('normalizes bracket key codes when automation or a browser reports the number key', () => {
        expect(normalizeEditorKey('9', 'Digit9', true)).toBe('(');
        expect(normalizeEditorKey('[', 'BracketLeft', true)).toBe('[');
        expect(normalizeEditorKey('Unidentified', 'BracketLeft', true)).toBe('{');
        expect(normalizeEditorKey('Unidentified', '', true, 57)).toBe('(');
    });
});
