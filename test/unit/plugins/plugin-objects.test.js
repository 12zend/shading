import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import installObjectBlocks from '../../../scratch-vm/src/lib/object-blocks';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';

const pluginZip = async main => {
    const zip = new JSZip();
    zip.file('text-tools/shading-plugin.json', JSON.stringify({
        format: 'shading.app/plugin',
        formatVersion: 1,
        id: 'text-tools',
        name: 'Text Tools',
        version: '1.0.0',
        main: 'main.js'
    }));
    zip.file('text-tools/main.js', main);
    return zip.generateAsync({type: 'uint8array'});
};

const emptyProject = () => ({targets: [{isStage: true, name: 'Stage', blocks: {}}]});

const install = async (manager, data) => manager.install(await manager.inspect(data, 'text-tools.zip'));

describe('plugin Objects blocks', () => {
    test('adds blocks to the Objects category that draw in the same tick', async () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const draws = [];
        vm.runtime.movieAssetManager = {drawObject: (target, configuration) => draws.push(configuration)};
        const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
        await manager.init();
        await install(manager, await pluginZip(`
exports.activate = shading => {
    const {BlockType, ArgumentType} = shading.scratch;
    shading.objects.addBlocks({
        blocks: [{
            opcode: 'stampText',
            blockType: BlockType.COMMAND,
            text: 'stamp text [TEXT] font [FONT]',
            arguments: {
                TEXT: {type: ArgumentType.STRING, defaultValue: 'a'},
                FONT: {type: ArgumentType.STRING, menu: 'fonts', defaultValue: 'sans-serif'}
            }
        }],
        menus: {fonts: {acceptReporters: true, items: () => shading.objects.getFonts().map(font => font.value)}},
        methods: {
            stampText: (args, util) => {
                shading.objects.draw(util, {source: 'text', asset: args.FONT, text: args.TEXT,
                    position: {x: 0, y: 0, z: 480}, size: 100});
                return Promise.resolve('ignored');
            }
        },
        toolboxXML: '<block type="objects_stampText"/>'
    });
};`));
        await vm.extensionManager.refreshBlocks('objects');
        const info = vm.runtime._blockInfo.find(category => category.id === 'objects');
        expect(info.blocks.map(block => block.info.opcode)).toContain('stampText');
        expect(manager.getObjectsToolboxXML()).toBe('<block type="objects_stampText"/>');
        const result = vm.runtime._primitives.objects_stampText(
            {TEXT: 'b', FONT: 'Shippori Mincho Bold'}, {target: {id: 'stage'}, thread: null});
        expect(result).toBeUndefined();
        expect(draws).toEqual([expect.objectContaining({source: 'text', asset: 'Shippori Mincho Bold', text: 'b'})]);

        const project = emptyProject();
        project.targets[0].blocks.a = {opcode: 'objects_stampText', inputs: {}, fields: {}, topLevel: true};
        expect(manager.collectReferences(project).map(reference => reference.id)).toEqual(['text-tools']);

        await manager.uninstall('text-tools');
        await vm.extensionManager.refreshBlocks('objects');
        expect(manager.getObjectsToolboxXML()).toBe('');
        const after = vm.runtime._blockInfo.find(category => category.id === 'objects');
        expect(after.blocks.map(block => block.info.opcode)).not.toContain('stampText');
    });
});
