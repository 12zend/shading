/**
 * @jest-environment jsdom
 */
import {
    BLOCKS_CUSTOM,
    BLOCKS_DARK,
    BLOCKS_HIGH_CONTRAST,
    BLOCKS_THREE,
    GUI_DARK,
    GUI_LIGHT,
    Theme,
    defaultBlockColors
} from '../../../src/lib/themes';
import {injectExtensionBlockTheme, injectExtensionCategoryTheme} from '../../../src/lib/themes/blockHelpers';
import {detectTheme, persistTheme} from '../../../src/lib/themes/themePersistance';

describe('themes', () => {
    describe('core functionality', () => {
        test('provides the default block colors', () => {
            expect(Theme.light.getBlockColors().motion.primary).toEqual(defaultBlockColors.motion.primary);
        });

        test('dark blocks override the defaults and fall back to them elsewhere', () => {
            const dark = Theme.light.set('blocks', BLOCKS_DARK);
            expect(dark.getBlockColors().motion.primary).not.toEqual(defaultBlockColors.motion.primary);
            expect(dark.getBlockColors().motion.primary).toBeTruthy();
        });

        test('replaces unknown settings with the defaults', () => {
            const theme = new Theme('nope', 'nope', 'nope');
            expect(theme.gui).toBe(GUI_LIGHT);
            expect(theme.blocks).toBe(BLOCKS_THREE);
        });

        test('uses light block colors on the stage for blocks that are not meant for it', () => {
            const dark = Theme.light.set('blocks', BLOCKS_DARK);
            expect(dark.getStageBlockColors()).toEqual(Theme.light.getBlockColors());
            const highContrast = Theme.light.set('blocks', BLOCKS_HIGH_CONTRAST);
            expect(highContrast.getStageBlockColors()).toEqual(highContrast.getBlockColors());
        });

        test('reports dark GUIs', () => {
            expect(Theme.dark.isDark()).toBe(true);
            expect(Theme.light.isDark()).toBe(false);
        });
    });

    describe('block helpers', () => {
        const dark = Theme.light.set('blocks', BLOCKS_DARK);

        test('updates default-colored extension blocks to the theme\'s extension colors', () => {
            const blockInfoJson = {
                type: 'dummy_block',
                extensions: ['default_extension_colors'],
                colour: '#0FBD8C',
                colourSecondary: '#0DA57A',
                colourTertiary: '#0B8E69'
            };

            const updated = injectExtensionBlockTheme(blockInfoJson, dark);

            const pen = dark.getBlockColors().pen;
            expect(updated).toEqual({
                type: 'dummy_block',
                extensions: ['default_extension_colors'],
                colour: pen.primary,
                colourSecondary: pen.secondary,
                colourTertiary: pen.tertiary,
                colourQuaternary: pen.quaternary
            });
            // The original value was not modified
            expect(blockInfoJson.colour).toBe('#0FBD8C');
        });

        test('converts custom extension colors', () => {
            const blockInfoJson = {type: 'dummy_block', colour: '#FF0000'};
            const converters = dark.getCustomExtensionColors();

            expect(injectExtensionBlockTheme(blockInfoJson, dark)).toEqual({
                type: 'dummy_block',
                colour: converters.primary('#FF0000'),
                colourSecondary: converters.secondary('#FF0000'),
                colourTertiary: converters.tertiary('#FF0000'),
                colourQuaternary: converters.quaternary('#FF0000')
            });
        });

        test('bypasses updates for the default blocks', () => {
            const blockInfoJson = {type: 'dummy_block', colour: '#0FBD8C'};
            expect(injectExtensionBlockTheme(blockInfoJson, Theme.light)).toBe(blockInfoJson);
        });

        test('updates extension categories', () => {
            const dynamicBlockXML = [{
                id: 'pen',
                xml: '<category name="Pen" id="pen" colour="#0FBD8C" secondaryColour="#0DA57A"></category>'
            }];

            const [category] = injectExtensionCategoryTheme(dynamicBlockXML, dark);
            const dom = new DOMParser().parseFromString(category.xml, 'text/xml');
            const pen = dark.getBlockColors().pen;
            expect(dom.documentElement.getAttribute('colour')).toBe(pen.primary);
            expect(dom.documentElement.getAttribute('secondaryColour')).toBe(pen.tertiary);
            expect(injectExtensionCategoryTheme(dynamicBlockXML, Theme.light)).toBe(dynamicBlockXML);
        });
    });

    describe('theme persistence', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        test('returns the stored theme', () => {
            localStorage.setItem('tw:theme', JSON.stringify({gui: GUI_DARK, blocks: BLOCKS_HIGH_CONTRAST}));

            const theme = detectTheme();

            expect(theme.gui).toBe(GUI_DARK);
            expect(theme.blocks).toBe(BLOCKS_HIGH_CONTRAST);
        });

        test('migrates legacy values', () => {
            localStorage.setItem('tw:theme', 'dark');
            expect(detectTheme()).toBe(Theme.dark);
        });

        test('returns the system theme when nothing is stored', () => {
            expect(detectTheme()).toBe(Theme.light);
        });

        test('stores only settings that differ from the system theme', () => {
            persistTheme(Theme.light.set('gui', GUI_DARK).set('blocks', BLOCKS_CUSTOM));
            expect(JSON.parse(localStorage.getItem('tw:theme'))).toEqual({gui: GUI_DARK});
        });

        test('clears the stored theme when it matches system preferences', () => {
            localStorage.setItem('tw:theme', JSON.stringify({gui: GUI_DARK}));

            persistTheme(Theme.light);

            expect(localStorage.getItem('tw:theme')).toBeNull();
        });
    });
});
