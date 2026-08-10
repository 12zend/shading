import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

describe('Movie toolbox categories', () => {
    test('places the default Pen category before Pen FX', () => {
        const categories = [
            {id: 'custom', xml: '<category id="custom" />'},
            {id: 'penfx', xml: '<category id="penfx" />'},
            {id: 'pen', xml: '<category id="pen" />'}
        ];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox.indexOf('id="looks"')).toBeLessThan(toolbox.indexOf('id="pen"'));
        expect(toolbox.indexOf('id="pen"')).toBeLessThan(toolbox.indexOf('id="penfx"'));
        expect(toolbox.indexOf('id="penfx"')).toBeLessThan(toolbox.indexOf('id="sound"'));
        expect(toolbox.indexOf('id="sound"')).toBeLessThan(toolbox.indexOf('id="custom"'));
    });

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
        expect(toolbox).toContain('type="looks_setmodelframeto"');
        expect(toolbox.indexOf('type="looks_clearscene"')).toBeLessThan(
            toolbox.indexOf('type="looks_rendermodel"')
        );
        expect(toolbox.indexOf('type="looks_rendermodel"')).toBeLessThan(
            toolbox.indexOf('type="looks_setmodelframeto"')
        );
        expect(toolbox).not.toContain('type="looks_switchmodelto"');
    });

    test('offers building primitives and material setup with native color and costume inputs', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="looks_clearmaterial"');
        expect(toolbox).toContain('type="looks_addmaterial"');
        expect(toolbox).toContain('type="looks_setalbedofromcolor"');
        expect(toolbox).toContain('type="looks_setalbedofromtexture"');
        expect(toolbox).toContain('type="looks_setemissionfromcolor"');
        expect(toolbox).toContain('type="looks_setemissionfromtexture"');
        expect(toolbox).toContain('type="looks_setdisplacementmap"');
        expect(toolbox).toContain('type="looks_setnormalmap"');
        expect(toolbox).toContain('type="looks_setroughmap"');
        expect(toolbox).toContain('type="looks_renderwall"');
        expect(toolbox).toContain('type="looks_renderfloor"');
        expect(toolbox).toContain('type="looks_renderbox"');
        expect(toolbox).toContain('<value name="COLOR"><shadow type="colour_picker">');
        expect(toolbox).toContain('<value name="TEXTURE"><shadow type="looks_costume">');
        expect(toolbox).toContain('<value name="U2"><shadow type="math_number"><field name="NUM">1</field>');
        expect(toolbox.indexOf('type="looks_clearmaterial"')).toBeLessThan(
            toolbox.indexOf('type="looks_addmaterial"')
        );
    });

    test('offers point and spot lights with color pickers and fractional shadows', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="looks_clearlight"');
        expect(toolbox).toContain('type="looks_addpointlight"');
        expect(toolbox).toContain('type="looks_addlight"');
        expect(toolbox).toContain('<value name="COLOR"><shadow type="colour_picker">');
        expect(toolbox).toContain('<value name="SHADOW"><shadow type="math_number">');
        expect(toolbox.indexOf('type="looks_clearlight"')).toBeLessThan(
            toolbox.indexOf('type="looks_addpointlight"')
        );
        expect(toolbox.indexOf('type="looks_addpointlight"')).toBeLessThan(
            toolbox.indexOf('type="looks_addlight"')
        );
    });

    test('offers one atomic video-frame render block for reliable stamping', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="looks_rendervideo"');
        expect(toolbox).toContain('<value name="VIDEO">');
        expect(toolbox).toContain('<value name="FRAME">');
        expect(toolbox).not.toContain('type="looks_switchvideoto"');
        expect(toolbox).not.toContain('type="looks_setvideoframeto"');
        expect(toolbox).not.toContain('type="looks_changevideoframeby"');
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

    test('moves rendering controls out of Looks and offers time-based real-time sound', () => {
        const toolbox = makeToolboxXML(false, false, 'target', [], '', '', 'Music');

        expect(toolbox).not.toContain('type="looks_addrenderingframe"');
        expect(toolbox).not.toContain('type="looks_clearrenderingframe"');
        expect(toolbox).not.toContain('type="looks_exportrenderingmp4"');
        expect(toolbox).not.toContain('type="event_whenflagclicked"');
        expect(toolbox).toContain('<block type="event_renderframe"/>');
        expect(toolbox).not.toContain('<block type="event_renderframe">');
        expect(toolbox).toContain('type="sound_playattime"');
        expect(toolbox).not.toContain('type="sound_playatframe"');
        expect(toolbox).toContain('<field name="SOUND_MENU">Music</field>');
        expect(toolbox.indexOf('type="sound_play"')).toBeLessThan(
            toolbox.indexOf('type="sound_playattime"')
        );
    });
});
