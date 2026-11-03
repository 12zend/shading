/**
 * @jest-environment jsdom
 */
import {CATEGORY_SEARCH_CALLBACK, applyCategorySearch, matchesSearchQuery} from '../../../src/lib/toolbox-search';

const toolbox = `<xml style="display: none">
    <category name="Camera" id="motion">
        <block type="motion_setx"/>
        <sep gap="36"/>
        <block type="motion_pointdirection"/>
        <label text="Section"/>
    </category>
    <sep gap="36"/>
    <category name="Variables" id="variables" custom="VARIABLE"></category>
    <category name="Objects" id="objects">
        <block type="objects_draw"><field name="TEXT">Hello &amp; bye</field></block>
    </category>
</xml>`;

const texts = {
    motion_setx: 'カメラのxを (0) にする',
    motion_pointdirection: 'カメラの向きを (90) にする',
    objects_draw: '描画 Hello & bye'
};
const getBlockText = element => texts[element.getAttribute('type')];

const parse = xml => new DOMParser().parseFromString(xml, 'text/xml').documentElement;
const children = category => Array.from(category.children).map(child => (
    child.tagName === 'block' ? child.getAttribute('type') : child.tagName
));

describe('palette category search', () => {
    test('matches every word, ignoring case and full-width forms', () => {
        expect(matchesSearchQuery('Draw Text', 'draw')).toBe(true);
        expect(matchesSearchQuery('Draw Text', 'ｔｅｘｔ  DRAW')).toBe(true);
        expect(matchesSearchQuery('Draw Text', 'draw shape')).toBe(false);
        expect(matchesSearchQuery('anything', '   ')).toBe(true);
    });

    test('puts a search button at the top of every category ScratchBlocks does not fill itself', () => {
        const root = parse(applyCategorySearch(toolbox, {getBlockText, locale: 'ja', queries: {}}));
        const [motion, variables, objects] = Array.from(root.getElementsByTagName('category'));

        expect(children(motion)).toEqual(['button', 'motion_setx', 'sep', 'motion_pointdirection', 'label']);
        const button = motion.firstElementChild;
        expect(button.getAttribute('text')).toBe('ブロックを検索…');
        expect(button.getAttribute('callbackKey')).toBe(CATEGORY_SEARCH_CALLBACK);
        expect(button.getAttribute('callbackData')).toBe('motion');
        expect(children(variables)).toEqual([]);
        expect(children(objects)).toEqual(['button', 'objects_draw']);
        expect(objects.lastElementChild.textContent).toBe('Hello & bye');
    });

    test('narrows only the searched category to its matching blocks', () => {
        const root = parse(applyCategorySearch(toolbox, {
            getBlockText,
            locale: 'en',
            queries: {motion: ' 向き ', objects: 'missing'}
        }));
        const [motion, , objects] = Array.from(root.getElementsByTagName('category'));

        expect(children(motion)).toEqual(['button', 'motion_pointdirection']);
        expect(motion.firstElementChild.getAttribute('text')).toBe('Search: 向き');
        expect(children(objects)).toEqual(['button', 'label']);
        expect(objects.lastElementChild.getAttribute('text')).toBe('No matching blocks');
        expect(root.getElementsByTagName('sep')).toHaveLength(1);
    });

    test('leaves XML it cannot parse unchanged', () => {
        expect(applyCategorySearch('<xml><category', {getBlockText, queries: {}})).toBe('<xml><category');
        expect(applyCategorySearch(null, {getBlockText, queries: {}})).toBeNull();
    });
});
