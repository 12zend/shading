import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';
import {DOMParser} from '@xmldom/xmldom';

import installPenFX from '../../../src/lib/pen-fx';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {defineMissingBlockPlaceholders} from '../../../src/lib/plugins/missing-blocks';

// A small plugin that adds its own category, a Looks block, project data and a tab.
const PLUGIN_MAIN = `
const helper = require('./lib/helper.js');
exports.activate = shading => {
    const {BlockType, ArgumentType} = shading.scratch;
    exports.state = {calls: [], data: null};
    shading.extensions.register({
        getInfo: () => ({
            id: 'texttools',
            name: 'Text Tools',
            blocks: [{
                opcode: 'shout',
                blockType: BlockType.REPORTER,
                text: 'shout [TEXT]',
                arguments: {TEXT: {type: ArgumentType.STRING, defaultValue: 'hi'}}
            }]
        }),
        shout: args => helper.shout(args.TEXT)
    });
    shading.penfx.extendPenFX({
        tintFlash (args) {
            exports.state.calls.push(Number(args.AMOUNT));
        }
    });
    shading.penfx.addToolbox({
        id: 'flash',
        order: 10,
        blocks: [{
            opcode: 'tintFlash',
            func: 'tintFlash',
            blockType: BlockType.COMMAND,
            text: 'tint flash [AMOUNT]',
            arguments: {AMOUNT: {type: ArgumentType.NUMBER, defaultValue: 1}}
        }]
    });
    shading.project.registerData('textToolsSettings', {
        serialize: () => exports.state.data || undefined,
        deserialize: data => {
            exports.state.data = data || null;
        }
    });
    shading.gui.addTab({id: 'notes', label: 'Notes', mount: container => {
        container.textContent = 'notes';
        return () => {};
    }});
};
`;

const pluginZip = async (overrides = {}) => {
    const zip = new JSZip();
    zip.file('text-tools/shading-plugin.json', JSON.stringify(Object.assign({
        format: 'shading.app/plugin',
        formatVersion: 1,
        id: 'text-tools',
        name: 'Text Tools',
        version: '1.0.0',
        main: 'main.js'
    }, overrides.manifest)));
    zip.file('text-tools/main.js', overrides.main || PLUGIN_MAIN);
    zip.file('text-tools/lib/helper.js', 'exports.shout = text => `${String(text).toUpperCase()}!`;');
    return zip.generateAsync({type: 'uint8array'});
};

const createVM = () => {
    const vm = new VM();
    vm.runtime.renderer = {};
    installPenFX(vm);
    // PenFX only needs the renderer lazily; loading projects headless skips drawables without one.
    vm.runtime.renderer = null;
    return vm;
};

// A project with only an empty stage; tests add blocks to it.
const emptyProject = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''},
    // Set by the project validator that normally runs before deserializeProject.
    projectVersion: 3
});

const install = async (manager, data) => {
    const review = await manager.inspect(data, 'text-tools.zip');
    return manager.install(review);
};

describe('plugin manager', () => {
    test('installs a reviewed zip, activates it and restores it from storage on the next start', async () => {
        const storage = new MemoryPluginStorage();
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage});
        await manager.init();
        const review = await manager.inspect(await pluginZip(), 'text-tools.zip');
        expect(review.scan.level).toBe('none');
        expect(review.manifest.id).toBe('text-tools');
        const plugin = await manager.install(review);
        expect(plugin).toMatchObject({id: 'text-tools', state: 'active', enabled: true});

        // Blocks from the plugin's category run synchronously and return their value in the same tick.
        await manager.refreshExtension('texttools');
        expect(vm.runtime._primitives.texttools_shout({TEXT: 'go'}, {})).toBe('GO!');
        // Looks contributions run in the same tick and return undefined.
        await vm.runtime.penFX.customShaders._scheduleRefresh();
        expect(vm.runtime._primitives.penfx_tintFlash({AMOUNT: 3}, {target: {}})).toBeUndefined();
        expect(manager.getExports('text-tools').state.calls).toEqual([3]);
        expect(manager.getTabs().map(tab => tab.label)).toEqual(['Notes']);

        const restarted = new ShadingPluginManager(createVM(), {storage});
        await restarted.init();
        expect(restarted.isActive('text-tools')).toBe(true);
    });

    test('rejects a stored archive that no longer matches the reviewed hash', async () => {
        const storage = new MemoryPluginStorage();
        const manager = new ShadingPluginManager(createVM(), {storage});
        await manager.init();
        await install(manager, await pluginZip());
        const stored = storage.records.get('text-tools');
        stored.data = (await pluginZip({main: 'exports.activate = () => { globalThis.stolen = true; };'})).buffer;
        const restarted = new ShadingPluginManager(createVM(), {storage});
        await restarted.init();
        expect(restarted.isActive('text-tools')).toBe(false);
        expect(restarted.getPlugins()[0]).toMatchObject({state: 'error'});
        expect(globalThis.stolen).toBeUndefined();
    });

    test('records used plugins and their data in the project and reports missing ones on load', async () => {
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        await install(manager, await pluginZip());
        manager.getExports('text-tools').state.data = {font: 'Mono'};
        await vm.deserializeProject(emptyProject());
        manager.getExports('text-tools').state.data = {font: 'Mono'};
        const project = JSON.parse(vm.toJSON());
        project.targets[0].blocks.a = {opcode: 'texttools_shout', inputs: {}, fields: {}, topLevel: true};
        expect(manager.collectReferences(project)).toEqual([{
            id: 'text-tools',
            name: 'Text Tools',
            version: '1.0.0',
            dataKeys: ['textToolsSettings'],
            extensions: ['texttools']
        }]);
        expect(project.textToolsSettings).toEqual({font: 'Mono'});
        project.shadingPlugins = manager.collectReferences(project);

        // Another editor without the plugin keeps the data, still loads the project and names the plugin.
        const otherVM = createVM();
        const other = new ShadingPluginManager(otherVM, {storage: new MemoryPluginStorage()});
        await other.init();
        const missing = jest.fn();
        other.on('missingPlugins', missing);
        await otherVM.deserializeProject(Object.assign(JSON.parse(JSON.stringify(project)), {projectVersion: 3}));
        expect(missing).toHaveBeenCalledWith([expect.objectContaining({id: 'text-tools', name: 'Text Tools'})]);
        const saved = JSON.parse(otherVM.toJSON());
        expect(saved.textToolsSettings).toEqual({font: 'Mono'});
        expect(saved.shadingPlugins.map(reference => reference.id)).toEqual(['text-tools']);

        // Installing the plugin afterwards hands it the project's data.
        await install(other, await pluginZip());
        expect(other.getExports('text-tools').state.data).toEqual({font: 'Mono'});
    });

    test('names the official plugin needed by Looks blocks from projects made before plugins', async () => {
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        const project = emptyProject();
        project.targets[0].blocks.a = {opcode: 'penfx_gaussianBlur', inputs: {}, fields: {}, topLevel: true};
        project.targets[0].blocks.b = {opcode: 'penfx_gsquintquintbloombloom', inputs: {}, fields: {}};
        project.targets[0].blocks.c = {opcode: 'penfx_setBlendMode', inputs: {}, fields: {}};
        project.extensions = ['penfx'];
        const missing = jest.fn();
        manager.on('missingPlugins', missing);
        await vm.deserializeProject(project);
        const ids = missing.mock.calls[0][0].map(plugin => plugin.id).sort();
        expect(ids).toEqual(['blur', 'genshade']);
        // The blocks stay in the project; running a missing block does nothing instead of failing.
        expect(vm.runtime.targets[0].blocks.getBlock('a').opcode).toBe('penfx_gaussianBlur');
    });

    test('disabling a plugin removes its registrations and blocks keep running as no-ops', async () => {
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        await install(manager, await pluginZip());
        const proto = Object.getPrototypeOf(vm.runtime.penFX);
        expect(typeof proto.tintFlash).toBe('function');
        await manager.setEnabled('text-tools', false);
        expect(proto.tintFlash).toBeUndefined();
        expect(manager.getTabs()).toEqual([]);
        expect(vm.runtime.penFX.customShaders.contributions.has('flash')).toBe(false);
        expect(vm.extensionManager.isExtensionLoaded('texttools')).toBe(true);
        await manager.uninstall('text-tools');
        expect(manager.getPlugins()).toEqual([]);
    });

    test('keeps a failing plugin from breaking the editor and undoes its partial registrations', async () => {
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        const zip = await pluginZip({main: `exports.activate = shading => {
            shading.gui.addTab({label: 'Half', mount: () => {}});
            throw new Error('boom');
        };`});
        await expect(install(manager, zip)).rejects.toThrow('boom');
        expect(manager.getTabs()).toEqual([]);
        expect(manager.getPlugins()[0]).toMatchObject({state: 'error', error: 'boom'});
    });

    test('plugins cannot replace core PenFX methods or reserved project keys', async () => {
        const vm = createVM();
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        const zip = await pluginZip({main: `exports.activate = shading => {
            shading.penfx.extendPenFX({_safe () {}});
        };`});
        await expect(install(manager, zip)).rejects.toThrow('belongs to shading.app');
        expect(() => manager.registerProjectData('x', 'targets', {serialize: () => 1})).toThrow('reserved');
        expect(() => manager.registerProjectData('x', 'movieVideos', {serialize: () => 1})).toThrow('reserved');
    });
});

describe('placeholders for blocks of missing plugins', () => {
    test('defines unknown block types with their inputs and fields so the workspace loads', () => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(`<xml>
            <block type="penfx_gaussianBlur" id="a">
                <value name="VALUE"><shadow type="math_number"><field name="NUM">5</field></shadow></value>
                <value name="TYPE"><shadow type="penfx_menu_gaussianType"><field name="gaussianType">normal</field></shadow></value>
            </block>
        </xml>`, 'text/xml');
        const ScratchBlocks = {Blocks: {math_number: {}}, FieldTextInput: function () {}};
        const defined = defineMissingBlockPlaceholders(ScratchBlocks, dom.documentElement);
        expect(defined.sort()).toEqual(['penfx_gaussianBlur', 'penfx_menu_gaussianType']);
        expect(ScratchBlocks.Blocks.penfx_gaussianBlur.shadingPlaceholder).toBe(true);

        const calls = [];
        const input = {appendField: (...args) => {
            calls.push(['field', ...args]);
            return input;
        }};
        const block = {
            appendDummyInput: () => input,
            appendValueInput: name => {
                calls.push(['value', name]);
                return input;
            },
            appendStatementInput: name => calls.push(['statement', name]),
            setInputsInline: () => {},
            setColour: () => {},
            setOutput: () => calls.push(['output']),
            setOutputShape: () => {},
            setPreviousStatement: () => calls.push(['previous']),
            setNextStatement: () => {},
            setTooltip: () => {}
        };
        ScratchBlocks.Blocks.penfx_gaussianBlur.init.call(block);
        expect(calls).toEqual(expect.arrayContaining([['value', 'VALUE'], ['value', 'TYPE'], ['previous']]));
        calls.length = 0;
        ScratchBlocks.Blocks.penfx_menu_gaussianType.init.call(block);
        expect(calls).toEqual(expect.arrayContaining([['output']]));
    });
});
