import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

describe('Movie toolbox categories', () => {
    test('places Pen FX with built-in categories instead of extension categories', () => {
        const categories = [
            {id: 'custom', xml: '<category id="custom" />'},
            {id: 'penfx', xml: '<category id="penfx" />'}
        ];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox.indexOf('id="looks"')).toBeLessThan(toolbox.indexOf('id="penfx"'));
        expect(toolbox.indexOf('id="penfx"')).toBeLessThan(toolbox.indexOf('id="sound"'));
        expect(toolbox.indexOf('id="sound"')).toBeLessThan(toolbox.indexOf('id="custom"'));
    });

    test('offers clear scene before the accumulating render model block', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="looks_clearscene"');
        expect(toolbox).toContain('type="looks_rendermodel"');
        expect(toolbox.indexOf('type="looks_clearscene"')).toBeLessThan(
            toolbox.indexOf('type="looks_rendermodel"')
        );
        expect(toolbox).not.toContain('type="looks_switchmodelto"');
    });
});
