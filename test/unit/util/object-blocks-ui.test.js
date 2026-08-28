import {createMediaField} from '../../../src/lib/object-blocks-ui';

const createFakeDocument = () => {
    const fakeDocument = {activeElement: null};
    const documentListeners = {};
    const createElement = tagName => {
        const attributes = new Map();
        const classNames = new Set();
        const listeners = {};
        const element = {
            _listeners: listeners,
            appendChild: child => {
                if (child.parentNode) child.parentNode.removeChild(child);
                child.parentNode = element;
                element.children.push(child);
                return child;
            },
            children: [],
            classList: {
                add: (...names) => names.filter(Boolean).forEach(name => classNames.add(name)),
                contains: name => classNames.has(name),
                remove: (...names) => names.filter(Boolean).forEach(name => classNames.delete(name)),
                toggle: (name, force) => {
                    if (!name) return false;
                    const enabled = typeof force === 'boolean' ? force : !classNames.has(name);
                    if (enabled) classNames.add(name);
                    else classNames.delete(name);
                    return enabled;
                }
            },
            click: () => {
                if (listeners.click) listeners.click({preventDefault: jest.fn(), stopPropagation: jest.fn()});
            },
            contains: target => target === element || element.children.some(child => child.contains(target)),
            focus: () => {
                fakeDocument.activeElement = element;
            },
            getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
            parentNode: null,
            insertBefore: (child, reference) => {
                if (child.parentNode) child.parentNode.removeChild(child);
                const index = element.children.indexOf(reference);
                child.parentNode = element;
                element.children.splice(index < 0 ? element.children.length : index, 0, child);
                return child;
            },
            removeChild: child => {
                const index = element.children.indexOf(child);
                if (index >= 0) element.children.splice(index, 1);
                child.parentNode = null;
                return child;
            },
            setAttribute: (name, value) => attributes.set(name, String(value)),
            setAttributeNS: (namespace, name, value) => attributes.set(name, String(value)),
            style: {setProperty: jest.fn()},
            tagName
        };
        Object.defineProperty(element, 'className', {
            get: () => Array.from(classNames).join(' '),
            set: value => {
                classNames.clear();
                String(value || '').split(/\s+/).filter(Boolean).forEach(name => classNames.add(name));
            }
        });
        Object.defineProperty(element, 'textContent', {
            get: () => element._textContent || '',
            set: value => {
                element._textContent = String(value);
                if (value === '') {
                    element.children.forEach(child => {
                        child.parentNode = null;
                    });
                    element.children = [];
                }
            }
        });
        Object.defineProperty(element, 'firstChild', {
            get: () => element.children[0] || null
        });
        element.addEventListener = (name, listener) => {
            listeners[name] = listener;
        };
        return element;
    };
    fakeDocument.createElement = createElement;
    fakeDocument.body = createElement('body');
    fakeDocument.createElementNS = (namespace, tagName) => createElement(tagName);
    fakeDocument.createTextNode = value => {
        const node = createElement('#text');
        node.textContent = value;
        return node;
    };
    fakeDocument.addEventListener = (name, listener) => {
        documentListeners[name] = listener;
    };
    fakeDocument.removeEventListener = (name, listener) => {
        if (documentListeners[name] === listener) delete documentListeners[name];
    };
    fakeDocument.pointerDown = target => {
        if (documentListeners.pointerdown) documentListeners.pointerdown({target});
    };
    return fakeDocument;
};

const findByLabel = (root, label) => {
    if (root.getAttribute && root.getAttribute('aria-label') === label) return root;
    for (const child of root.children || []) {
        const match = findByLabel(child, label);
        if (match) return match;
    }
    return null;
};

describe('Objects draw media picker', () => {
    test('stays open after a selection, imports dropped files, and closes explicitly', async () => {
        const originalDocument = global.document;
        const fakeDocument = createFakeDocument();
        global.document = fakeDocument;
        const content = fakeDocument.createElement('div');
        class FieldDropdown {
            constructor (options, validator) {
                this.options_ = options;
                this.validator_ = validator;
                this.value_ = 'costume:One';
            }

            callValidator (value) {
                return this.validator_.call(this, value);
            }

            getOptions () {
                return this.options_.call(this);
            }

            getValue () {
                return this.value_;
            }

            onHide () {}

            setText () {}

            setValue (value) {
                this.value_ = value;
            }
        }
        const ScratchBlocks = {
            DropDownDiv: {
                clearContent: jest.fn(() => {
                    content.textContent = '';
                }),
                getContentDiv: jest.fn(() => content),
                hide: jest.fn(),
                hideWithoutAnimation: jest.fn(),
                setBoundsElement: jest.fn(),
                setCategory: jest.fn(),
                setColour: jest.fn(),
                showPositionedByBlock: jest.fn()
            },
            Events: {setGroup: jest.fn()},
            FieldDropdown
        };
        const boundsElement = {clientWidth: 640};
        const importedFile = {name: 'Dropped.png'};
        const manager = {
            getModels: jest.fn(() => []),
            getVideos: jest.fn(() => []),
            importFiles: jest.fn(() => Promise.resolve([{name: 'Dropped', source: 'costume'}]))
        };
        const costumes = [{name: 'One'}, {name: 'Two'}];
        const vm = {
            editingTarget: {
                getCostumes: () => costumes,
                id: 'sprite'
            },
            runtime: {movieAssetManager: manager}
        };
        const MediaField = createMediaField(ScratchBlocks, vm, () => [], value => value);
        const field = new MediaField();
        field.sourceBlock_ = {
            getFieldValue: name => (name === 'ASSET' ? 'costume:One' : 'costume'),
            getCategory: () => 'Objects',
            setDrawAsset_: jest.fn(),
            workspace: {
                getParentSvg: () => ({parentNode: boundsElement})
            }
        };

        try {
            field.showEditor_();
            const firstItem = findByLabel(content, 'Costume: One');
            const secondItem = findByLabel(content, 'Costume: Two');
            const closeButton = findByLabel(content, 'Close media picker');
            const picker = findByLabel(content, 'Choose media for draw');
            const dropOverlay = findByLabel(content, 'Drop files to import');

            expect(ScratchBlocks.DropDownDiv.showPositionedByBlock).toHaveBeenCalledWith(
                field,
                field.sourceBlock_,
                expect.any(Function)
            );
            expect(findByLabel(content, 'Media picker view')).toBeNull();
            expect(findByLabel(content, 'Edit selected costume')).toBeNull();
            secondItem.click();

            expect(field.getValue()).toBe('costume:Two');
            expect(firstItem.getAttribute('aria-selected')).toBe('false');
            expect(secondItem.getAttribute('aria-selected')).toBe('true');
            expect(ScratchBlocks.DropDownDiv.hide).not.toHaveBeenCalled();
            expect(fakeDocument.activeElement).toBe(secondItem);

            const dataTransfer = {
                dropEffect: 'none',
                files: [importedFile],
                types: ['Files']
            };
            const dragEvent = {
                dataTransfer,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn()
            };
            picker._listeners.dragenter(dragEvent);
            picker._listeners.dragenter(dragEvent);
            expect(dropOverlay.getAttribute('aria-hidden')).toBe('false');
            picker._listeners.dragleave(dragEvent);
            expect(dropOverlay.getAttribute('aria-hidden')).toBe('false');
            picker._listeners.dragover(dragEvent);
            expect(dataTransfer.dropEffect).toBe('copy');
            picker._listeners.drop(dragEvent);
            await Promise.resolve();
            await Promise.resolve();

            expect(dragEvent.preventDefault).toHaveBeenCalled();
            expect(dragEvent.stopPropagation).toHaveBeenCalled();
            expect(dropOverlay.getAttribute('aria-hidden')).toBe('true');
            expect(manager.importFiles).toHaveBeenCalledWith('sprite', [importedFile], {modelName: ''});
            expect(field.sourceBlock_.setDrawAsset_).toHaveBeenCalledWith('costume', 'Dropped');

            fakeDocument.pointerDown(fakeDocument.createElement('main'));
            expect(ScratchBlocks.DropDownDiv.hide).toHaveBeenCalledTimes(1);

            closeButton.click();
            expect(ScratchBlocks.DropDownDiv.hide).toHaveBeenCalledTimes(2);

            costumes[1].name = 'Renamed';
            field.showEditor_();
            expect(findByLabel(content, 'Costume: Renamed')).not.toBeNull();
            expect(findByLabel(content, 'Costume: Two')).toBeNull();

            field.onHide();
        } finally {
            global.document = originalDocument;
        }
    });

    test('selects multiple costumes and stores a named costume group as the draw asset', () => {
        const originalDocument = global.document;
        const fakeDocument = createFakeDocument();
        global.document = fakeDocument;
        const content = fakeDocument.createElement('div');
        const costumes = [
            {assetId: 'svg-one', name: 'One'},
            {assetId: 'svg-two', name: 'Two'}
        ];
        let groups = [];
        class FieldDropdown {
            constructor () {
                this.value_ = 'costume:One';
            }

            callValidator (value) {
                return value;
            }

            getOptions () {
                return [];
            }

            getValue () {
                return this.value_;
            }

            onHide () {}

            setText () {}

            setValue (value) {
                this.value_ = value;
            }
        }
        const manager = {
            createCostumeGroup: jest.fn((targetId, assetIds, name) => {
                const group = {costumeAssetIds: assetIds, name: name || 'Costume group'};
                groups = [group];
                return group;
            }),
            getCostumeGroupCostumes: jest.fn((target, group) => costumes.filter(costume => (
                group.costumeAssetIds.includes(costume.assetId)
            ))),
            getCostumeGroups: jest.fn(() => groups),
            getModels: jest.fn(() => []),
            getVideos: jest.fn(() => [])
        };
        const ScratchBlocks = {
            DropDownDiv: {
                clearContent: jest.fn(() => {
                    content.textContent = '';
                }),
                getContentDiv: jest.fn(() => content),
                hide: jest.fn(),
                hideWithoutAnimation: jest.fn(),
                setBoundsElement: jest.fn(),
                setCategory: jest.fn(),
                setColour: jest.fn(),
                showPositionedByBlock: jest.fn()
            },
            Events: {setGroup: jest.fn()},
            FieldDropdown
        };
        const vm = {
            editingTarget: {
                getCostumes: () => costumes,
                id: 'sprite'
            },
            runtime: {movieAssetManager: manager}
        };
        const MediaField = createMediaField(ScratchBlocks, vm, () => [], value => value);
        const field = new MediaField();
        field.sourceBlock_ = {
            getFieldValue: name => (name === 'ASSET' ? field.getValue() : 'costume'),
            getCategory: () => 'Objects',
            setDrawAsset_: jest.fn(),
            workspace: {
                getParentSvg: () => ({parentNode: {clientWidth: 640}})
            }
        };

        try {
            field.showEditor_();
            findByLabel(content, 'Select costumes for a group').click();
            findByLabel(content, 'Costume: One').click();
            findByLabel(content, 'Costume: Two').click();
            const groupName = findByLabel(content, 'Costume group name');
            groupName.value = 'Walk';
            findByLabel(content, 'Group selected costumes').click();

            expect(manager.createCostumeGroup).toHaveBeenCalledWith(
                'sprite',
                ['svg-one', 'svg-two'],
                'Walk'
            );
            expect(field.getValue()).toBe('costume-group:Walk');
            expect(field.sourceBlock_.setDrawAsset_).toHaveBeenCalledWith('costume-group', 'Walk');
            expect(findByLabel(content, 'Costume group: Walk')).not.toBeNull();
        } finally {
            global.document = originalDocument;
        }
    });
});
