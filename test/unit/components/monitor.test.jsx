/**
 * @jest-environment jsdom
 */
import React from 'react';
import {shallow} from 'enzyme';
import DefaultMonitor from '../../../src/components/monitor/default-monitor';
import Monitor from '../../../src/components/monitor/monitor';
import {BLOCKS_DARK, BLOCKS_HIGH_CONTRAST, Theme} from '../../../src/lib/themes';

const renderMonitor = theme => {
    const noop = () => {};
    return shallow(<Monitor
        category="motion"
        // eslint-disable-next-line react/jsx-no-bind
        componentRef={noop}
        draggable={false}
        label="My label"
        mode="default"
        // eslint-disable-next-line react/jsx-no-bind
        onDragEnd={noop}
        // eslint-disable-next-line react/jsx-no-bind
        onNextMode={noop}
        theme={theme}
    />);
};

describe('Monitor Component', () => {
    test('it selects the correct colors based on the default theme', () => {
        const colors = Theme.light.getBlockColors();
        const defaultMonitor = renderMonitor(Theme.light).find(DefaultMonitor);
        expect(defaultMonitor.props().categoryColor).toEqual({background: colors.motion.primary, text: colors.text});
    });

    test('it selects the correct colors based on the high contrast theme', () => {
        const theme = Theme.light.set('blocks', BLOCKS_HIGH_CONTRAST);
        const colors = theme.getBlockColors();
        const defaultMonitor = renderMonitor(theme).find(DefaultMonitor);
        expect(defaultMonitor.props().categoryColor).toEqual({background: colors.motion.primary, text: colors.text});
        expect(colors.motion.primary).not.toEqual(Theme.light.getBlockColors().motion.primary);
    });

    test('it keeps stage colors for block themes not meant for the stage', () => {
        const colors = Theme.light.getBlockColors();
        const defaultMonitor = renderMonitor(Theme.light.set('blocks', BLOCKS_DARK)).find(DefaultMonitor);
        expect(defaultMonitor.props().categoryColor).toEqual({background: colors.motion.primary, text: colors.text});
    });
});
