import FontManager from '../../../scratch-vm/src/engine/tw-font-manager';
import {MovieAssetManager} from '../../../src/lib/movie-asset-manager';

const makeAsset = () => ({
    assetId: 'font',
    data: new Uint8Array(4),
    dataFormat: 'ttf',
    encodeDataURI: () => 'data:font/ttf;base64,AAAA'
});

const makeFontManager = () => {
    const runtime = {
        renderer: {
            setCustomFonts: jest.fn()
        }
    };
    const fontManager = new FontManager(runtime);
    fontManager.addCustomFont('Typeface', 'sans-serif', makeAsset());
    fontManager.addSystemFont('Arial', 'sans-serif');
    runtime.renderer.setCustomFonts.mockClear();
    return fontManager;
};

describe('FontManager.renameFont', () => {
    test('renames a custom font and updates the renderer', () => {
        const fontManager = makeFontManager();
        const change = jest.fn();
        fontManager.on('change', change);

        expect(fontManager.renameFont(0, 'Title Font')).toBe('Title Font');

        expect(fontManager.getFonts()[0]).toMatchObject({
            name: 'Title Font',
            family: '"Title Font", sans-serif'
        });
        expect(fontManager.runtime.renderer.setCustomFonts).toHaveBeenCalledWith({
            '"Title Font", sans-serif': expect.stringContaining('font-family: "Title Font"')
        });
        expect(change).toHaveBeenCalledTimes(1);
    });

    test('removes invalid characters and avoids names used by other fonts', () => {
        const fontManager = makeFontManager();

        expect(fontManager.renameFont(0, ' "arial"; ')).toBe('arial2');
        expect(fontManager.renameFont(1, 'Arial Bold')).toBe('Arial Bold');
        expect(fontManager.getFonts().map(font => font.name)).toEqual(['arial2', 'Arial Bold']);
    });

    test('keeps the current name for empty input or a case-only match of itself', () => {
        const fontManager = makeFontManager();
        const change = jest.fn();
        fontManager.on('change', change);

        expect(fontManager.renameFont(0, '  ')).toBe('Typeface');
        expect(fontManager.renameFont(0, '"";')).toBe('Typeface');
        expect(fontManager.renameFont(0, 'Typeface')).toBe('Typeface');
        expect(fontManager.renameFont(0, 'typeface')).toBe('typeface');
        expect(change).toHaveBeenCalledTimes(1);
        expect(fontManager.renameFont(5, 'Missing')).toBe('');
    });

    test('does not let a custom font take a restricted name', () => {
        const fontManager = makeFontManager();
        fontManager.restrictFont('Sans Serif');

        expect(fontManager.renameFont(0, 'sans serif')).toBe('sans serif2');
        expect(fontManager.renameFont(1, 'Sans Serif')).toBe('Sans Serif');
    });
});

describe('MovieAssetManager.renameFont', () => {
    const makeManager = () => {
        const fontManager = makeFontManager();
        const blocks = {
            menu: {
                id: 'menu',
                opcode: 'looks_font',
                fields: {FONT: {name: 'FONT', value: 'typeface'}}
            },
            otherMenu: {
                id: 'otherMenu',
                opcode: 'looks_font',
                fields: {FONT: {name: 'FONT', value: 'Arial'}}
            },
            draw: {
                id: 'draw',
                opcode: 'objects_draw',
                fields: {},
                mutation: {tagName: 'mutation', children: [], source: 'text', asset: 'Typeface'}
            },
            drawMenu: {
                id: 'drawMenu',
                opcode: 'objects_menu_ASSET',
                fields: {ASSET: {name: 'ASSET', value: 'text:Typeface'}}
            },
            costumeDraw: {
                id: 'costumeDraw',
                opcode: 'objects_draw',
                fields: {},
                mutation: {tagName: 'mutation', children: [], source: 'costume', asset: 'Typeface'}
            }
        };
        const target = {
            isOriginal: true,
            blocks: {_blocks: blocks, resetCache: jest.fn()}
        };
        const manager = Object.create(MovieAssetManager.prototype);
        manager.runtime = {
            emitProjectChanged: jest.fn(),
            fontManager,
            targets: [target, {isOriginal: false, blocks: target.blocks}]
        };
        manager.vm = {refreshWorkspace: jest.fn()};
        return {blocks, manager, target};
    };

    test('renames the font and the blocks that reference it', () => {
        const {blocks, manager, target} = makeManager();

        expect(manager.renameFont(0, 'Title')).toBe('Title');

        expect(blocks.menu.fields.FONT.value).toBe('Title');
        expect(blocks.otherMenu.fields.FONT.value).toBe('Arial');
        expect(blocks.draw.mutation.asset).toBe('Title');
        expect(blocks.drawMenu.fields.ASSET.value).toBe('text:Title');
        expect(blocks.costumeDraw.mutation.asset).toBe('Typeface');
        expect(target.blocks.resetCache).toHaveBeenCalledTimes(1);
        expect(manager.runtime.emitProjectChanged).toHaveBeenCalledTimes(1);
        expect(manager.vm.refreshWorkspace).toHaveBeenCalledTimes(1);
    });

    test('does nothing when the name is unchanged', () => {
        const {blocks, manager} = makeManager();

        expect(manager.renameFont(0, 'Typeface')).toBe('Typeface');

        expect(blocks.menu.fields.FONT.value).toBe('typeface');
        expect(manager.runtime.emitProjectChanged).not.toHaveBeenCalled();
        expect(manager.vm.refreshWorkspace).not.toHaveBeenCalled();
    });
});
