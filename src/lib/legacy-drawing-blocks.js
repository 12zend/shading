// Serialized Pen opcodes remain readable in old projects. These blocks invoke core Movie commands;
// they do not load an extension or appear in the palette.
const installLegacyDrawingBlocks = (ScratchBlocks, translate) => {
    const definitions = [
        ['clear', 'erase all', 'すべて消す', []],
        ['stamp', 'draw current sprite', '現在のスプライトを描画', []],
        ['penDown', 'start drawing trail', '軌跡の描画を開始', []],
        ['penUp', 'stop drawing trail', '軌跡の描画を停止', []],
        ['setPenColorToColor', 'set trail color to %1', '軌跡の色を %1 にする', ['COLOR']],
        ['changePenColorParamBy', 'change trail %1 by %2', '軌跡の %1 を %2 ずつ変える', ['COLOR_PARAM', 'VALUE']],
        ['setPenColorParamTo', 'set trail %1 to %2', '軌跡の %1 を %2 にする', ['COLOR_PARAM', 'VALUE']],
        ['changePenSizeBy', 'change trail size by %1', '軌跡の太さを %1 ずつ変える', ['SIZE']],
        ['setPenSizeTo', 'set trail size to %1', '軌跡の太さを %1 にする', ['SIZE']],
        ['changePenHueBy', 'change trail hue by %1', '軌跡の色相を %1 ずつ変える', ['HUE']],
        ['setPenHueToNumber', 'set trail hue to %1', '軌跡の色相を %1 にする', ['HUE']],
        ['changePenShadeBy', 'change trail shade by %1', '軌跡の濃さを %1 ずつ変える', ['SHADE']],
        ['setPenShadeToNumber', 'set trail shade to %1', '軌跡の濃さを %1 にする', ['SHADE']]
    ];
    for (const [opcode, english, japanese, inputs] of definitions) {
        ScratchBlocks.Blocks[`pen_${opcode}`] = {
            init: function () {
                this.jsonInit({
                    message0: translate(english, japanese),
                    args0: inputs.map(name => ({type: 'input_value', name})),
                    inputsInline: true,
                    extensions: ['colours_looks', 'shape_statement']
                });
            }
        };
    }
    ScratchBlocks.Blocks.pen_menu_colorParam = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [{type: 'field_dropdown',
                    name: 'colorParam',
                    options: [
                        [translate('color', '色'), 'color'], [translate('saturation', '鮮やかさ'), 'saturation'],
                        [translate('brightness', '明るさ'), 'brightness'],
                        [translate('transparency', '透明度'), 'transparency']
                    ]}],
                extensions: ['colours_looks', 'output_string']
            });
        }
    };
};

export default installLegacyDrawingBlocks;
