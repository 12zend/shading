import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

describe('Movie toolbox categories', () => {
    test('offers one complete object block and grouping block in a dedicated category', () => {
        const categories = [{id: 'objects', xml: '<category id="objects" />'}];
        const toolbox = makeToolboxXML(false, false, 'target', categories, 'costume1');

        expect(toolbox).toContain('<category name="Objects" id="objects"');
        expect(toolbox).toContain('<block type="objects_draw">');
        expect(toolbox).toContain('<block type="objects_shape">');
        expect(toolbox).toContain('<field name="SHAPE">polygon</field>');
        expect(toolbox).toContain('<value name="INNER"><shadow type="math_number"><field name="NUM">50</field>');
        expect(toolbox).toContain('<value name="COLOR"><shadow type="colour_picker"><field name="COLOUR">#ffffff</field>');
        expect(toolbox).toContain('<value name="OPACITY"><shadow type="math_number"><field name="NUM">100</field>');
        expect(toolbox).toContain('<value name="FRAME"><shadow type="math_number"><field name="NUM">1</field>');
        expect(toolbox).toContain('<value name="SPEED"><shadow type="math_number"><field name="NUM">1</field>');
        expect(toolbox).toContain('<value name="VOLUME"><shadow type="math_number"><field name="NUM">100</field>');
        expect(toolbox).not.toContain('<statement name="SUBSTACK">');
        expect(toolbox).toContain('<value name="TEXT"><shadow type="text">');
        expect(toolbox).not.toContain('type="objects_position"');
        expect(toolbox).not.toContain('type="objects_rotation"');
        expect(toolbox).not.toContain('type="objects_scale"');
        expect(toolbox).not.toContain('type="objects_size"');
        expect(toolbox).not.toContain('type="objects_dimensions"');
        expect(toolbox).toContain('<value name="PX">');
        expect(toolbox).toContain('<value name="RZ">');
        expect(toolbox).toContain('<value name="SZ">');
        expect(toolbox).toContain('<value name="HEIGHT">');
        expect(toolbox).toContain('<value name="T1"><shadow type="math_number"><field name="NUM">0</field>');
        expect(toolbox).toContain('<value name="T2"><shadow type="math_number"><field name="NUM">10</field>');
        expect(toolbox).toContain('<field name="ASSET">costume1</field>');
        expect(toolbox).toContain('<block type="objects_grouping"/>');
        expect(toolbox.indexOf('id="objects"')).toBeLessThan(toolbox.indexOf('id="looks"'));
        expect(toolbox.indexOf('id="objects"')).toBeLessThan(toolbox.indexOf('id="sound"'));
    });

    test('places My Blocks Shader next to My Blocks as a native category', () => {
        const categories = [{
            id: 'myblocksshader',
            xml: '<category id="myblocksshader" name="My Blocks Shader" />'
        }];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox).toContain('id="myBlocksShader"');
        expect(toolbox).toContain('custom="MY_BLOCKS_SHADER"');
        expect(toolbox).toContain('id="myBlocksShader"\n        colour="#FF6680"');
        expect(toolbox).not.toContain('id="myblocksshader"');
        expect(toolbox.indexOf('id="myBlocks"')).toBeLessThan(toolbox.indexOf('id="myBlocksShader"'));
    });

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

    test('offers the atomic video-frame render block plus the legacy video controls', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('type="looks_rendervideo"');
        expect(toolbox).toContain('<value name="VIDEO">');
        expect(toolbox).toContain('<value name="FRAME">');
        expect(toolbox).toContain('type="looks_switchvideoto"');
        expect(toolbox).toContain('type="looks_setvideoframeto"');
        expect(toolbox).toContain('type="looks_changevideoframeby"');
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

    test('shows every VM-executable block including legacy rendering and event blocks', () => {
        const toolbox = makeToolboxXML(false, false, 'target', [], '', '', 'Music');

        expect(toolbox).toContain('type="looks_addrenderingframe"');
        expect(toolbox).toContain('type="looks_clearrenderingframe"');
        expect(toolbox).toContain('type="looks_exportrenderingmp4"');
        expect(toolbox).toContain('type="event_whenflagclicked"');
        expect(toolbox).toContain('<block type="event_renderframe"/>');
        expect(toolbox).not.toContain('<block type="event_renderframe">');
        expect(toolbox).toContain('type="sound_playattime"');
        expect(toolbox).toContain('type="sound_playatframe"');
        expect(toolbox).toContain('<field name="SOUND_MENU">Music</field>');
        expect(toolbox.indexOf('type="sound_play"')).toBeLessThan(
            toolbox.indexOf('type="sound_playattime"')
        );
    });

    test('offers all core VM blocks that are hidden from the curated palette', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        // Motion: classic 2D blocks and legacy no-ops.
        expect(toolbox).toContain('type="motion_gotoxy"');
        expect(toolbox).toContain('type="motion_movesteps"');
        expect(toolbox).toContain('type="motion_glidesecstoxy"');
        expect(toolbox).toContain('type="motion_ifonedgebounce"');
        expect(toolbox).toContain('type="motion_changezby"');
        expect(toolbox).toContain('type="motion_changerotationby"');
        expect(toolbox).toContain('type="motion_setcamerax"');
        expect(toolbox).toContain('type="motion_changecamerazby"');
        expect(toolbox).toContain('type="motion_changecamerarotationby"');
        expect(toolbox).toContain('type="motion_xscroll"');
        // Looks: speech, size, and graphic effect filters.
        expect(toolbox).toContain('type="looks_say"');
        expect(toolbox).toContain('type="looks_thinkforsecs"');
        expect(toolbox).toContain('type="looks_nextcostume"');
        expect(toolbox).toContain('type="looks_changesizeby"');
        expect(toolbox).toContain('type="looks_turbulentdisplace"');
        expect(toolbox).toContain('type="looks_bloom"');
        expect(toolbox).toContain('type="looks_effectweight"');
        expect(toolbox).toContain('type="looks_hideallsprites"');
        // Sound.
        expect(toolbox).toContain('type="sound_play"');
        expect(toolbox).toContain('type="sound_stopallsounds"');
        expect(toolbox).toContain('type="sound_seteffectto"');
        expect(toolbox).toContain('type="sound_cleareffects"');
        // Events.
        expect(toolbox).toContain('type="event_whenkeypressed"');
        expect(toolbox).toContain('type="event_whenthisspriteclicked"');
        expect(toolbox).toContain('type="event_whentouchingobject"');
        expect(toolbox).toContain('type="event_whenbackdropswitchesto"');
        expect(toolbox).toContain('type="event_whengreaterthan"');
        // Control.
        expect(toolbox).toContain('type="control_wait"');
        expect(toolbox).toContain('type="control_for_each"');
        expect(toolbox).toContain('type="control_all_at_once"');
        expect(toolbox).toContain('type="control_get_counter"');
        expect(toolbox).toContain('type="control_incr_counter"');
        expect(toolbox).toContain('type="control_clear_counter"');
        expect(toolbox).toContain('type="control_start_as_clone"');
        expect(toolbox).toContain('type="control_create_clone_of"');
        expect(toolbox).toContain('type="control_delete_this_clone"');
        // Sensing.
        expect(toolbox).toContain('type="sensing_touchingobject"');
        expect(toolbox).toContain('type="sensing_coloristouchingcolor"');
        expect(toolbox).toContain('type="sensing_distanceto"');
        expect(toolbox).toContain('type="sensing_keypressed"');
        expect(toolbox).toContain('type="sensing_askandwait"');
        expect(toolbox).toContain('type="sensing_answer"');
        expect(toolbox).toContain('type="sensing_of"');
        expect(toolbox).toContain('type="sensing_current"');
        expect(toolbox).toContain('type="sensing_dayssince2000"');
        expect(toolbox).toContain('type="sensing_username"');
        expect(toolbox).toContain('type="sensing_online"');
        expect(toolbox).toContain('type="sensing_userid"');
        // The legacy switch-model alias shares the render-model block definition and stays deduplicated.
        expect(toolbox).not.toContain('type="looks_switchmodelto"');
    });
});
