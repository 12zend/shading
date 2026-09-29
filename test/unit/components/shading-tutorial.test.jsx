import EventEmitter from 'events';
import React from 'react';
import {shallow} from 'enzyme';

import ShadingTutorial from '../../../src/components/shading-tutorial/shading-tutorial';
import {applyTutorialStage, releaseTutorialBlocks} from '../../../src/lib/tutorial/tutorial-blocks';
import {STEPS, getStepIndex} from '../../../src/lib/tutorial/tutorial-steps';
import {STORAGE_KEY} from '../../../src/lib/tutorial/tutorial-storage';

jest.mock('../../../src/lib/tutorial/tutorial-blocks', () => Object.assign(
    {},
    jest.requireActual('../../../src/lib/tutorial/tutorial-blocks'),
    {
        applyTutorialStage: jest.fn(),
        getTutorialTarget: jest.fn(() => null),
        releaseTutorialBlocks: jest.fn()
    }
));

jest.mock('../../../src/lib/movie-asset-manager', () => {
    const Emitter = jest.requireActual('events');
    const manager = new Emitter();
    return () => manager;
});

const TAB_INDEXES = {code: 0, costumes: 1, sounds: 2, videos: 3, fonts: 4, models: 5, shaders: 6, plugins: 7};

const makePlugins = active => {
    const plugins = new EventEmitter();
    plugins.active = active;
    plugins.ready = Promise.resolve();
    plugins.isActive = id => plugins.active.includes(id);
    return plugins;
};

describe('ShadingTutorial', () => {
    let values;
    let vm;
    let onActivateTab;

    const render = (props = {}) => {
        const component = shallow(
            <ShadingTutorial
                activeTabIndex={0}
                isProjectReady
                locale="en"
                tabIndexes={TAB_INDEXES}
                vm={vm}
                onActivateTab={onActivateTab}
                {...props}
            />,
            {disableLifecycleMethods: true}
        );
        return {component, instance: component.instance()};
    };

    const saved = () => JSON.parse(values.get(STORAGE_KEY));
    const nextButton = component => component.find('button').filterWhere(button => (
        ['Next', 'Finish'].includes(button.text())
    ));

    beforeEach(() => {
        jest.useFakeTimers();
        values = new Map();
        global.localStorage = {
            getItem: key => (values.has(key) ? values.get(key) : null),
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        };
        global.document = {querySelector: () => null};
        vm = new EventEmitter();
        vm.runtime = {};
        onActivateTab = jest.fn();
        applyTutorialStage.mockClear();
        releaseTutorialBlocks.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.localStorage;
        delete global.document;
    });

    test('opens for a first visit and waits for the official plugins', async () => {
        const {component, instance} = render();
        expect(component.find('[role="dialog"]').exists()).toBe(true);
        expect(component.text()).toContain('Welcome to Shading');

        const plugins = makePlugins([]);
        instance.handlePluginsAttached(plugins);
        await plugins.ready;
        component.update();
        expect(component.text()).toContain('not installed yet');
        expect(nextButton(component).prop('disabled')).toBe(true);

        plugins.active = ['color-adjust'];
        plugins.emit('changed');
        component.update();
        expect(nextButton(component).prop('disabled')).toBe(false);
    });

    test('places the blocks of each page and opens the tab it describes', () => {
        values.set(STORAGE_KEY, JSON.stringify({status: 'active', step: 'renderFrame'}));
        const {component, instance} = render();
        instance.syncStep();
        expect(applyTutorialStage).toHaveBeenLastCalledWith(vm, 'none', expect.any(Object));

        nextButton(component).simulate('click');
        instance.syncStep();
        expect(STEPS[instance.state.stepIndex].id).toBe('renderFramePlaced');
        expect(applyTutorialStage).toHaveBeenLastCalledWith(vm, 'hat', expect.any(Object));
        expect(saved()).toEqual({status: 'active', step: 'renderFramePlaced'});

        // Pages that only explain keep the blocks as they are.
        applyTutorialStage.mockClear();
        instance.goTo(getStepIndex('costumes'));
        instance.syncStep();
        expect(applyTutorialStage).toHaveBeenCalledWith(vm, 'grouping', expect.any(Object));
        jest.runOnlyPendingTimers();
        expect(onActivateTab).toHaveBeenCalledWith(TAB_INDEXES.costumes);
        applyTutorialStage.mockClear();
        instance.goTo(getStepIndex('sounds'));
        instance.syncStep();
        expect(applyTutorialStage).not.toHaveBeenCalled();
    });

    test('resumes where the user left off', () => {
        values.set(STORAGE_KEY, JSON.stringify({status: 'active', step: 'camera'}));
        const {component} = render();
        expect(component.text()).toContain('The camera');
    });

    test('can be skipped, which hands the blocks over and keeps it closed', () => {
        values.set(STORAGE_KEY, JSON.stringify({status: 'active', step: 'drawPlaced'}));
        const {component} = render();
        component.find('button').filterWhere(button => button.text() === 'Skip tutorial')
            .simulate('click');
        expect(component.text()).toContain('Skip the tutorial?');
        component.find('button').filterWhere(button => button.text() === 'Skip tutorial')
            .simulate('click');
        expect(component.isEmptyRender()).toBe(true);
        expect(saved().status).toBe('skipped');
        expect(releaseTutorialBlocks).toHaveBeenCalledWith(vm);
    });

    test('is marked as completed at the end and does not open again', () => {
        values.set(STORAGE_KEY, JSON.stringify({status: 'active', step: 'finish'}));
        const {component} = render();
        nextButton(component).simulate('click');
        expect(component.isEmptyRender()).toBe(true);
        expect(saved().status).toBe('completed');
        expect(render().component.isEmptyRender()).toBe(true);
    });

    test('opens again from the menu and follows the editor language', () => {
        values.set(STORAGE_KEY, JSON.stringify({status: 'completed', step: 'finish'}));
        const {component, instance} = render({locale: 'ja'});
        expect(component.isEmptyRender()).toBe(true);
        instance.handleRestart();
        component.update();
        expect(component.text()).toContain('Shading へようこそ');
    });

    test('renders nothing until the project has loaded', () => {
        expect(render({isProjectReady: false}).component.isEmptyRender()).toBe(true);
    });
});
