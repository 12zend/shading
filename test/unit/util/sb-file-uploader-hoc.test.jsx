import 'web-audio-test-api';

import React from 'react';
import configureStore from 'redux-mock-store';
import {mountWithIntl, shallowWithIntl} from '../../helpers/intl-helpers.jsx';
import {LoadingState} from '../../../src/reducers/project-state';
import VM from 'scratch-vm';

import JSZip from '@turbowarp/jszip';
import SBFileUploaderHOC from '../../../src/lib/sb-file-uploader-hoc.jsx';
import {findEngineForVersion} from '../../../src/lib/engine-versions';
import {openInEngine} from '../../../src/lib/engine-handoff';

jest.mock('../../../src/lib/engine-versions', () => Object.assign(
    {}, jest.requireActual('../../../src/lib/engine-versions'), {findEngineForVersion: jest.fn()}
));
jest.mock('../../../src/lib/engine-handoff', () => ({openInEngine: jest.fn(() => Promise.resolve())}));

const shadeFile = version => new JSZip()
    .file('project.json', JSON.stringify({targets: [], shading: {version}}))
    .generateAsync({type: 'arraybuffer'});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('SBFileUploaderHOC', () => {
    const mockStore = configureStore();
    let store;
    let vm;

    // Wrap this in a function so it gets test specific states and can be reused.
    const getContainer = function () {
        const Component = () => <div />;
        return SBFileUploaderHOC(Component);
    };

    const shallowMountWithContext = component => (
        shallowWithIntl(component, {context: {store}})
    );

    const unwrappedInstance = (props = {}) => {
        const WrappedComponent = getContainer();
        // default starting state: looking at a project you created, not logged in
        const wrapper = shallowMountWithContext(
            <WrappedComponent
                projectChanged
                canSave={false}
                cancelFileUpload={jest.fn()}
                closeFileMenu={jest.fn()}
                requestProjectUpload={jest.fn()}
                userOwnsProject={false}
                vm={vm}
                onLoadingFinished={jest.fn()}
                onLoadingStarted={jest.fn()}
                onUpdateProjectTitle={jest.fn()}
                {...props}
            />
        );
        return wrapper
            .dive() // unwrap intl
            .dive() // unwrap redux Connect(SBFileUploaderComponent)
            .instance(); // SBFileUploaderComponent
    };

    beforeEach(() => {
        findEngineForVersion.mockReset();
        findEngineForVersion.mockResolvedValue(null);
        openInEngine.mockClear();
        global.FileReader = jest.fn(() => ({}));
        vm = new VM();
        store = mockStore({
            scratchGui: {
                projectState: {
                    loadingState: LoadingState.SHOWING_WITHOUT_ID
                },
                vm: {}
            },
            locales: {
                locale: 'en'
            }
        });
    });

    afterEach(() => {
        delete global.FileReader;
    });

    test('does not take a title from Scratch .sb3 files', () => {
        const projectName = unwrappedInstance().getProjectTitleFromFilename('my project is great.sb3');
        expect(projectName).toBe('');
    });

    test('correctly sets title with .shade filename', () => {
        const projectName = unwrappedInstance().getProjectTitleFromFilename('my movie is great.shade');
        expect(projectName).toBe('my movie is great');
    });

    test('does not take a title from legacy .mb3 files', () => {
        const projectName = unwrappedInstance().getProjectTitleFromFilename('my movie is great.mb3');
        expect(projectName).toBe('');
    });

    test('refuses files that are not .shade without loading them', async () => {
        const onLoadingFailed = jest.fn();
        const onLoadingFinished = jest.fn();
        const loadProject = jest.spyOn(vm, 'loadProject');
        const instance = unwrappedInstance({onLoadingFailed, onLoadingFinished, onLoadingStarted: jest.fn()});
        instance.fileReader = {result: new ArrayBuffer(0)};
        instance.fileToUpload = {name: 'old movie.mb3'};

        instance.onload();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(loadProject).not.toHaveBeenCalled();
        expect(onLoadingFailed).toHaveBeenCalledWith(expect.objectContaining({
            name: 'UnsupportedProjectFormatError',
            reason: 'legacy-format'
        }));
        expect(onLoadingFinished).toHaveBeenCalledWith(expect.anything(), false);
    });

    test('opens a file saved by another engine version in that engine when the user agrees', async () => {
        const engine = {version: '0.9.0', name: 'Shading 0.9.0', url: '/engines/0.9.0/'};
        findEngineForVersion.mockResolvedValue(engine);
        global.confirm = jest.fn(() => true);
        const onLoadingFinished = jest.fn();
        const loadProject = jest.spyOn(vm, 'loadProject');
        const instance = unwrappedInstance({onLoadingFinished, onLoadingStarted: jest.fn()});
        const data = await shadeFile('0.9.0');
        const fileHandle = {name: 'movie.shade'};
        instance.fileReader = {result: data};
        instance.fileToUpload = {name: 'movie.shade'};
        instance.fileHandle = fileHandle;

        instance.onload();
        for (let i = 0; i < 5; i++) await flush();

        expect(findEngineForVersion).toHaveBeenCalledWith('0.9.0');
        expect(openInEngine).toHaveBeenCalledWith('/engines/0.9.0/', {data, fileName: 'movie.shade', fileHandle});
        expect(loadProject).not.toHaveBeenCalled();
        // The loading screen stays until the other engine's page replaces this one.
        expect(onLoadingFinished).not.toHaveBeenCalled();
        delete global.confirm;
    });

    test('opens a file from another engine version here when the user declines', async () => {
        findEngineForVersion.mockResolvedValue({version: '0.9.0', name: 'Shading 0.9.0', url: '/engines/0.9.0/'});
        global.confirm = jest.fn(() => false);
        const loadProject = jest.spyOn(vm, 'loadProject').mockResolvedValue();
        const instance = unwrappedInstance({
            onLoadingFailed: jest.fn(),
            onLoadingStarted: jest.fn(),
            onSetProjectTitle: jest.fn()
        });
        const data = await shadeFile('0.9.0');
        instance.fileReader = {result: data};
        instance.fileToUpload = {name: 'movie.shade'};

        instance.onload();
        for (let i = 0; i < 5; i++) await flush();

        expect(openInEngine).not.toHaveBeenCalled();
        expect(loadProject).toHaveBeenCalledWith(data);
        delete global.confirm;
    });

    test('does not filter shade out of the native file picker', () => {
        const showOpenFilePicker = jest.fn(() => new Promise(() => {}));
        const instance = unwrappedInstance({showOpenFilePicker});

        instance.createFileObjects();

        expect(showOpenFilePicker).toHaveBeenCalledWith({multiple: false});
    });

    test('does not take a title from .sb2 or .sb files', () => {
        expect(unwrappedInstance().getProjectTitleFromFilename('my project is great.sb2')).toBe('');
        expect(unwrappedInstance().getProjectTitleFromFilename('my project is great.sb')).toBe('');
    });

    test('sets blank title with filename with no extension', () => {
        const projectName = unwrappedInstance().getProjectTitleFromFilename('my project is great');
        expect(projectName).toBe('');
    });

    /* tw: test is broken by flag required to fix issues with multiple instances
    test('if isLoadingUpload becomes true, without fileToUpload set, will call cancelFileUpload', () => {
        const mockedCancelFileUpload = jest.fn();
        const WrappedComponent = getContainer();
        const mounted = mountWithIntl(
            <WrappedComponent
                projectChanged
                canSave={false}
                cancelFileUpload={mockedCancelFileUpload}
                closeFileMenu={jest.fn()}
                isLoadingUpload={false}
                requestProjectUpload={jest.fn()}
                store={store}
                userOwnsProject={false}
                vm={vm}
                onLoadingFinished={jest.fn()}
                onLoadingStarted={jest.fn()}
                onUpdateProjectTitle={jest.fn()}
            />
        );
        mounted.setProps({
            isLoadingUpload: true
        });
        expect(mockedCancelFileUpload).toHaveBeenCalled();
    });
    */
});
