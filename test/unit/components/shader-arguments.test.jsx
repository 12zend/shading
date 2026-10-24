/**
 * @jest-environment jsdom
 */
import React from 'react';
import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import {ShaderArguments} from '../../../src/components/shader-editor/shader-arguments.jsx';
import {inferShaderInputs} from '../../../src/lib/pen-fx/shader-uniforms';

const source = [
    'uniform vec3 u_tint;',
    'uniform int u_mode; // @menu soft, hard',
    'uniform bool u_enabled;',
    'void main() {}'
].join('\n');

const mountArguments = (props = {}) => {
    const onSourceChange = jest.fn();
    const wrapper = mountWithIntl(
        <ShaderArguments
            inputs={inferShaderInputs(props.source || source)}
            source={source}
            onSourceChange={onSourceChange}
            {...props}
        />
    );
    return {onSourceChange, wrapper};
};

const chip = (wrapper, uniform) => wrapper.find(`button[data-uniform="${uniform}"]`).first();

describe('ShaderArguments', () => {
    test('only lets vectors and int/float uniforms change their input type', () => {
        const {wrapper} = mountArguments();
        expect(wrapper.find('button[data-uniform="u_tint"]')).toHaveLength(3);
        expect(wrapper.find('button[data-uniform="u_mode"]')).toHaveLength(1);
        expect(wrapper.find('button[data-uniform="u_enabled"]')).toHaveLength(0);
        expect(wrapper.text()).toContain('enabled');
    });

    test('writes a @color annotation when a vector becomes a color', () => {
        const {wrapper, onSourceChange} = mountArguments();
        chip(wrapper, 'u_tint').simulate('click');
        wrapper.find('button[data-type="color"]').simulate('click');
        expect(onSourceChange).toHaveBeenLastCalledWith(source.replace(
            'uniform vec3 u_tint;',
            'uniform vec3 u_tint; // @color #ffffff'
        ));
    });

    test('edits the items and default of a menu uniform', () => {
        const {wrapper, onSourceChange} = mountArguments();
        chip(wrapper, 'u_mode').simulate('click');
        wrapper.find('input[type="text"]').simulate('change', {target: {value: 'soft, hard, glow'}});
        expect(onSourceChange).toHaveBeenLastCalledWith(source.replace(
            '@menu soft, hard',
            '@menu soft, hard, glow'
        ));

        wrapper.find('select').simulate('change', {target: {value: 'hard'}});
        expect(onSourceChange).toHaveBeenLastCalledWith(source.replace(
            '@menu soft, hard',
            '@menu soft, hard @default hard'
        ));

        wrapper.find('button[data-type="number"]').simulate('click');
        expect(onSourceChange).toHaveBeenLastCalledWith(source.replace(' // @menu soft, hard', ''));
    });

    test('shows why a uniform cannot be changed instead of writing the source', () => {
        const shared = 'uniform vec3 u_a, u_b;\nvoid main() {}';
        const {wrapper, onSourceChange} = mountArguments({source: shared});
        chip(wrapper, 'u_a').simulate('click');
        wrapper.find('button[data-type="color"]').simulate('click');
        expect(onSourceChange).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').text()).toContain('in its own uniform statement');
    });

    test('does not offer type changes for shaders whose inputs come from a manifest', () => {
        const {wrapper} = mountArguments({editable: false});
        expect(wrapper.find('button[data-uniform]')).toHaveLength(0);
    });
});
