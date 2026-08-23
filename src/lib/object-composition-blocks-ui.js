import {
    ANIMATION_EASING_TYPES,
    BLEND_MODES,
    MATTE_MODES,
    PRIMARY,
    SECONDARY,
    TERTIARY
} from './object-blocks';

const numberInput = name => ({type: 'input_value', name});
const statementInput = {type: 'input_statement', name: 'SUBSTACK'};
const easingOptions = ANIMATION_EASING_TYPES.map(type => [
    type.replace(/(InOut|In|Out)$/, ' $1'),
    type
]);

const objectDefinition = definition => Object.assign({
    category: 'Objects',
    colour: PRIMARY,
    colourSecondary: SECONDARY,
    colourTertiary: TERTIARY
}, definition);

const easingField = () => ({
    type: 'field_dropdown',
    name: 'EASING',
    options: easingOptions
});

const installObjectCompositionBlockDefinitions = ScratchBlocks => {
    const installObjectBlock = (opcode, definition) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(objectDefinition(definition));
                // Scratch's statement-shape extension forces inline inputs. Transform deliberately uses
                // one readable row per transform component, so reapply its explicit layout after extensions.
                if (definition.inputsInline === false) this.setInputsInline(false);
            }
        };
    };

    installObjectBlock('objects_group', {
        message0: 'group',
        message1: '%1',
        args1: [statementInput],
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_transform', {
        message0: 'transform',
        message1: 'position x: %1 y: %2 z: %3',
        args1: [numberInput('PX'), numberInput('PY'), numberInput('PZ')],
        message2: 'anchor x: %1 y: %2 z: %3',
        args2: [numberInput('AX'), numberInput('AY'), numberInput('AZ')],
        message3: 'rotation x: %1 y: %2 z: %3',
        args3: [numberInput('RX'), numberInput('RY'), numberInput('RZ')],
        message4: 'scale x: %1 y: %2 z: %3',
        args4: [numberInput('SX'), numberInput('SY'), numberInput('SZ')],
        message5: '%1',
        args5: [statementInput],
        inputsInline: false,
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_composite', {
        message0: 'composite opacity: %1 %% blend mode: %2',
        args0: [
            numberInput('OPACITY'),
            {
                type: 'field_dropdown',
                name: 'BLEND',
                options: BLEND_MODES.map(mode => [mode, mode])
            }
        ],
        message1: '%1',
        args1: [statementInput],
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_matte', {
        message0: 'matte using %1',
        args0: [{
            type: 'field_dropdown',
            name: 'MODE',
            options: MATTE_MODES.map(mode => [mode, mode])
        }],
        message1: 'source %1',
        args1: [{type: 'input_statement', name: 'SUBSTACK'}],
        message2: 'matte %1',
        args2: [{type: 'input_statement', name: 'SUBSTACK2'}],
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_repeat', {
        message0: 'repeat %1 angle offset: %2 time offset: %3 sec',
        args0: [numberInput('COUNT'), numberInput('ANGLE'), numberInput('TIME')],
        message1: '%1',
        args1: [statementInput],
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_timeOffset', {
        message0: 'time offset %1 sec',
        args0: [numberInput('TIME')],
        message1: '%1',
        args1: [statementInput],
        extensions: ['shape_statement']
    });

    installObjectBlock('objects_timelineTime', {
        message0: 'timeline time',
        extensions: ['output_number']
    });

    installObjectBlock('objects_animate', {
        message0: 'animate %1 to %2',
        args0: [numberInput('A'), numberInput('B')],
        message1: 'from %1 sec to %2 sec',
        args1: [numberInput('T1'), numberInput('T2')],
        message2: 'easing %1',
        args2: [easingField()],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_loopValue', {
        message0: 'loop %1 to %2 every %3 sec',
        args0: [numberInput('A'), numberInput('B'), numberInput('DURATION')],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_pingPongValue', {
        message0: 'ping-pong %1 to %2 every %3 sec',
        args0: [numberInput('A'), numberInput('B'), numberInput('DURATION')],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_wiggle', {
        message0: 'wiggle frequency %1 amount %2 seed %3',
        args0: [numberInput('FREQUENCY'), numberInput('AMOUNT'), numberInput('SEED')],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_timeWithin', {
        message0: 'time within %1 to %2 sec',
        args0: [numberInput('T1'), numberInput('T2')],
        inputsInline: true,
        extensions: ['output_boolean']
    });

    installObjectBlock('objects_posterizeTime', {
        message0: 'posterize time to %1 fps',
        args0: [numberInput('FPS')],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_interpolateColor', {
        message0: 'interpolate color %1 to %2',
        args0: [numberInput('A'), numberInput('B')],
        message1: 'from %1 sec to %2 sec easing %3',
        args1: [numberInput('T1'), numberInput('T2'), easingField()],
        inputsInline: true,
        extensions: ['output_string']
    });

    installObjectBlock('objects_interpolateAngle', {
        message0: 'interpolate angle %1 to %2',
        args0: [numberInput('A'), numberInput('B')],
        message1: 'from %1 sec to %2 sec easing %3',
        args1: [numberInput('T1'), numberInput('T2'), easingField()],
        inputsInline: true,
        extensions: ['output_number']
    });

    installObjectBlock('objects_interpolateVector', {
        message0: 'interpolate vector %1',
        args0: [{
            type: 'field_dropdown',
            name: 'COMPONENT',
            options: [['x', 'x'], ['y', 'y'], ['z', 'z']]
        }],
        message1: 'from x: %1 y: %2 z: %3',
        args1: [numberInput('X1'), numberInput('Y1'), numberInput('Z1')],
        message2: 'to x: %1 y: %2 z: %3',
        args2: [numberInput('X2'), numberInput('Y2'), numberInput('Z2')],
        message3: 'from %1 sec to %2 sec easing %3',
        args3: [numberInput('T1'), numberInput('T2'), easingField()],
        inputsInline: true,
        extensions: ['output_number']
    });
};

export default installObjectCompositionBlockDefinitions;
