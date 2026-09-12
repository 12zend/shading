import React from 'react';
import {shallow} from 'enzyme';
import {renderToStaticMarkup} from 'react-dom/server';
import ShaderCodeEditor, {findMatches, highlightMatches} from '../../../src/components/shader-editor/shader-code-editor';

const makeEditor = (props = {}) => shallow(<ShaderCodeEditor
    label="Shader"
    value="float x; float y;"
    onChange={jest.fn()}
    onSave={jest.fn()}
    {...props}
/>);

describe('shader search and scrolling', () => {
    test('finds literal, case-sensitive, non-overlapping matches, including newlines', () => {
        expect(findMatches('a.* a.* A.*', 'a.*')).toEqual([0, 4]);
        expect(findMatches('aaaaa', 'aa')).toEqual([0, 2]);
        expect(findMatches('a\nb\na\nb', 'a\nb')).toEqual([0, 4]);
        expect(findMatches('text', '')).toEqual([]);
    });

    test('marks matches across syntax tokens without changing source text or interpreting HTML', () => {
        const source = 'float x; float x; <script>';
        const html = renderToStaticMarkup(<pre>{highlightMatches(source, 'float x')}</pre>);
        expect(html).toContain('<mark>');
        expect(html.replace(/<[^>]*>/g, '')).toBe('float x; float x; &lt;script&gt;');
    });

    test('does not synchronize independent scroll offsets or wrap native input', () => {
        const wrapper = makeEditor();
        const input = wrapper.find('textarea');
        expect(input.prop('wrap')).toBe('off');
        expect(input.prop('onScroll')).toBeUndefined();
        expect(wrapper.find('pre').prop('onScroll')).toBeUndefined();
    });

    test('tracks selection and clears occurrence highlighting when selection collapses', () => {
        const wrapper = makeEditor();
        const instance = wrapper.instance();
        instance.textarea = {selectionStart: 0, selectionEnd: 5};
        instance.handleSelect();
        expect(wrapper.state('selectedText')).toBe('float');
        instance.textarea.selectionEnd = 0;
        instance.handleSelect();
        expect(wrapper.state('selectedText')).toBe('');
    });

    test('replaces every match literally in a single edit and supports deletion', () => {
        const wrapper = makeEditor();
        const instance = wrapper.instance();
        instance.applyEdit = jest.fn();
        wrapper.setState({query: 'float', replacement: '$&'});
        instance.handleReplaceAll();
        expect(instance.applyEdit).toHaveBeenLastCalledWith({
            value: '$& x; $& y;', selectionStart: 0, selectionEnd: 0
        });
        wrapper.setState({replacement: ''});
        instance.handleReplaceAll();
        expect(instance.applyEdit).toHaveBeenLastCalledWith({
            value: ' x;  y;', selectionStart: 0, selectionEnd: 0
        });
    });

    test('does not replace for an empty query or a read-only editor', () => {
        const wrapper = makeEditor();
        const instance = wrapper.instance();
        instance.applyEdit = jest.fn();
        instance.handleReplaceAll();
        wrapper.setProps({readOnly: true});
        wrapper.setState({query: 'float'});
        instance.handleReplaceAll();
        expect(instance.applyEdit).not.toHaveBeenCalled();
    });
});
