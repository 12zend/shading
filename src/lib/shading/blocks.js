// One schema drives the palette, Blockly inputs and VM primitive registration.
const number = (name, value = 0) => ({name, value, type: 'number'});
const text = (name, value = '') => ({name, value, type: 'text'});
const color = (name, value = '#ffffff') => ({name, value, type: 'color'});
const menu = (name, options) => ({name, options, type: 'menu', value: options[0]});
const blend = () => menu('MODE', ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
    'saturation', 'color', 'luminosity', 'add']);
const parent = () => text('PARENT');
const layer = () => text('LAYER', 'Layer 1');
const definitions = [
    ['composition', 'initComposition', 'init composition', []],
    ['layer', 'initLayer', 'init layer', []],
    ['composition', 'addComposition', 'add composition %1 resolution %2 %3 framerate: %4 background color: %5',
        [text('NAME', 'Composition 1'), number('WIDTH', 1920), number('HEIGHT', 1080), number('FRAMERATE', 30),
            color('COLOR', '#000000')]],
    ['composition', 'deleteComposition', 'delete composition %1', [text('NAME', 'Composition 1')]],
    ['composition', 'selectComposition', 'select composition %1', [text('NAME', 'Composition 1')]],
    ['layer', 'addFootage', 'add footage %1 media %2 blend mode: %3 parent %4',
        [text('NAME', 'Footage 1'), {...text('MEDIA'), type: 'media'}, blend(), parent()]],
    ['layer', 'addText', 'add text %1 font %2 text %3 blend mode: %4 parent %5',
        [text('NAME', 'Text 1'), {...text('FONT', 'sans-serif'), type: 'font'},
            text('TEXT', 'Text'), blend(), parent()]],
    ['layer', 'addShape', 'add shape %1 type %2 blend mode: %3 parent %4',
        [text('NAME', 'Shape 1'), menu('TYPE', ['polygon', 'star', 'curve star', 'flower']), blend(), parent()]],
    ['layer', 'addAdjustment', 'add adjustment %1 blend mode: %2 parent %3',
        [text('NAME', 'Adjustment 1'), blend(), parent()]],
    ['layer', 'addNull', 'add null %1 parent %2', [text('NAME', 'Null 1'), parent()]],
    ['layer', 'deleteLayer', 'delete layer %1', [layer()]],
    ['transform', 'setAnchor', 'set anchor point to %1 %2', [number('X'), number('Y')]],
    ['transform', 'setPosition', 'set position to %1 %2', [number('X'), number('Y')]],
    ['transform', 'setScale', 'set scale to %1 %', [number('SCALE', 100)]],
    ['transform', 'setRotation', 'set rotation to %1', [number('DEGREES')]],
    ['transform', 'setOpacity', 'set opacity to %1 %', [number('OPACITY', 100)]],
    ['transform', 'setFill', 'set fill color to %1', [color('COLOR')]],
    ['transform', 'setShape', 'set shape radius %1 points %2 inner radius %3 %',
        [number('RADIUS', 100), number('POINTS', 5), number('INNER', 50)]],
    ['transform', 'setFontSize', 'set font size to %1', [number('SIZE', 72)]],
    ['effect', 'colorGrading',
        'color grading %1 temp %2 tint %3 saturation %4 contrast %5 pivot %6 ' +
        'shadow %7 %8 %9 midtone %10 %11 %12 highlight %13 %14 %15',
        [layer(), number('TEMP'), number('TINT'), number('SATURATION', 100), number('CONTRAST', 100),
            number('PIVOT', 0.5), color('SHADOW_ADD', '#000000'), color('SHADOW_MUL'), color('SHADOW_DIV'),
            color('MIDTONE_ADD', '#000000'), color('MIDTONE_MUL'), color('MIDTONE_DIV'),
            color('HIGHLIGHT_ADD', '#000000'), color('HIGHLIGHT_MUL'), color('HIGHLIGHT_DIV')]],
    ['effect', 'blur', 'blur %1 mode %2 radius: %3 edge behavior %4 repeat edge pixels %5',
        [layer(), menu('MODE', ['gaussian', 'box']), number('RADIUS', 10),
            menu('EDGE', ['clamp', 'mirror', 'transparent']), menu('REPEAT', ['false', 'true'])]],
    ['effect', 'autoGrading', 'auto grading %1 background %2', [text('DST', 'Footage 1'), text('SRC', 'Background')]],
    ['timeline', 'time', 'time', [], 'reporter']
].map(([category, opcode, message, args, shape]) => ({category, opcode: `shade_${opcode}`, message, args, shape}));

const categories = {
    composition: ['Composition', '#6854b8'],
    layer: ['Layer', '#38846c'],
    transform: ['Transform', '#4976c4'],
    effect: ['Effect', '#ad5c87'],
    timeline: ['Timeline', '#a57526']
};
const escapeXML = value => String(value).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
}[c]));

const menuOptions = (arg, vm) => {
    if (arg.type === 'menu') return arg.options.map(value => [value, value]);
    const assets = vm.runtime.shadingScene && vm.runtime.shadingScene.assets;
    if (arg.type === 'font') {
        return [['sans-serif', 'sans-serif']].concat((assets ? assets.list('font') : [])
            .map(asset => [asset.name, asset.id]));
    }
    const costumes = [];
    for (const target of vm.runtime.targets || []) {
        if (!target.isOriginal) continue;
        for (const costume of target.getCostumes()) {
            const key = `costume:${encodeURIComponent(target.getName())}:${encodeURIComponent(costume.name)}`;
            costumes.push([`${target.getName()}: ${costume.name}`, key]);
        }
    }
    const videos = (assets ? assets.list('video') : []).map(asset => [asset.name, asset.id]);
    return costumes.concat(videos).length ? costumes.concat(videos) : [['(no media)', '']];
};

const registerShadingBlocks = (ScratchBlocks, vm) => {
    for (const block of definitions) {
        const colour = categories[block.category][1];
        for (const arg of block.args.filter(item => ['menu', 'media', 'font'].includes(item.type))) {
            ScratchBlocks.Blocks[`${block.opcode}_${arg.name}`] = {
                init: function () {
                    this.jsonInit({
                        message0: '%1',
                        args0: [{type: 'field_dropdown',
                            name: arg.name,
                            options: () => menuOptions(arg, vm)}],
                        output: 'String',
                        colour,
                        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
                    });
                }
            };
        }
        ScratchBlocks.Blocks[block.opcode] = {
            init: function () {
                this.jsonInit({
                    message0: block.message,
                    args0: block.args.map(arg => ({type: 'input_value', name: arg.name})),
                    inputsInline: true,
                    colour,
                    colourSecondary: colour,
                    colourTertiary: colour,
                    extensions: [block.shape === 'reporter' ? 'output_number' : 'shape_statement']
                });
            }
        };
    }
};

const blockXML = block => `<block type="${block.opcode}">${block.args.map(arg => {
    let type = 'text';
    let field = 'TEXT';
    if (arg.type === 'number') {
        type = 'math_number'; field = 'NUM';
    }
    if (arg.type === 'color') {
        type = 'colour_picker'; field = 'COLOUR';
    }
    if (['menu', 'media', 'font'].includes(arg.type)) {
        type = `${block.opcode}_${arg.name}`; field = arg.name;
    }
    if (arg.type === 'media') return `<value name="${arg.name}"><shadow type="${type}"/></value>`;
    return `<value name="${arg.name}"><shadow type="${type}"><field name="${field}">` +
        `${escapeXML(arg.value)}</field></shadow></value>`;
}).join('')}</block>`;

const shadingToolboxXML = () => Object.keys(categories).map(id => {
    const [name, colour] = categories[id];
    const hats = id === 'timeline' ? '<block type="event_initialize"/><block type="event_renderframe"/>' : '';
    return `<category name="${name}" id="shade_${id}" colour="${colour}" secondaryColour="${colour}">${
        hats}${definitions.filter(block => block.category === id).map(blockXML)
        .join('')}</category>`;
})
    .join('\n');

export {categories, definitions, registerShadingBlocks, shadingToolboxXML};
