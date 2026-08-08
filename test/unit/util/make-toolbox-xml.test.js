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

    test('offers both camera-aware and camera-independent 3D go-to blocks', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="motion_gotoxyz"');
        expect(toolbox).toContain('type="motion_gotoxyz_nocamera"');
    });

    test('offers per-axis model scale controls', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="motion_setscale"');
        expect(toolbox).toContain('<field name="NUM">1</field>');
    });

    test('moves rendering controls out of Looks and offers the render frame event', () => {
        const toolbox = makeToolboxXML(false, false, 'target', [], '', '', 'Music');

        expect(toolbox).not.toContain('type="looks_addrenderingframe"');
        expect(toolbox).not.toContain('type="looks_clearrenderingframe"');
        expect(toolbox).not.toContain('type="looks_exportrenderingmp4"');
        expect(toolbox).not.toContain('type="event_whenflagclicked"');
        expect(toolbox).toContain('type="event_renderframe"');
    });
});
