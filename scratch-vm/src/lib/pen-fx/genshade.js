/* eslint-disable */
import catalog from 'scratch-render/src/pen-fx/genshade/catalog.json';
import {loadGenshade} from 'scratch-render/src/pen-fx/genshade/assets';
import GenshadeRenderer from 'scratch-render/src/pen-fx/genshade/renderer';
import {depthResource, mixAmount} from './helpers';

// Preserve the file path in IDs: two identically named ReShade techniques may use different algorithms.
const opcode = descriptor => `gs${descriptor.id.slice(9).replace(/[^a-zA-Z0-9]/g, '')}`;
const components = ['X', 'Y', 'Z', 'W'];
const labelFor = parameter => String(parameter.annotations.ui_label || parameter.name)
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || parameter.name.slice(0, 48);
const colorValue = values => `#${values.slice(0, 3).map(value => (
    Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255).toString(16).padStart(2, '0')
)).join('')}`;

const inputsFor = descriptor => {
    const inputs = [];
    const bindings = [];
    descriptor.parameters.forEach((parameter, index) => {
        const id = `P${index}`;
        const label = labelFor(parameter);
        const count = parameter.rows * parameter.cols;
        const values = parameter.value || [];
        if (parameter.annotations.ui_type === 'color' && count >= 3) {
            inputs.push({id, label, type: 'color', defaultValue: colorValue(values)});
            const ids = [id];
            for (let component = 3; component < count; component++) {
                const componentId = `${id}_${components[component] || component}`;
                inputs.push({id: componentId, label: `${label} ${components[component] || component}`.slice(0, 48),
                    type: 'number', defaultValue: values[component] === undefined ? 0 : values[component]});
                ids.push(componentId);
            }
            bindings.push({name: parameter.name, ids, color: true});
        } else {
            const ids = [];
            for (let component = 0; component < count; component++) {
                const componentId = count === 1 ? id : `${id}_${components[component] || component}`;
                inputs.push({id: componentId, label: count === 1 ? label :
                    `${label} ${components[component] || component}`.slice(0, 48), type: 'number',
                defaultValue: values[component] === undefined ? 0 : values[component]});
                ids.push(componentId);
            }
            bindings.push({name: parameter.name, ids, color: false});
        }
    });
    return {inputs, bindings};
};

const definitions = catalog.map(descriptor => inputsFor(descriptor));
const blocks = catalog.map((descriptor, index) => {
    const inputs = definitions[index].inputs.concat({id: 'MIX', label: 'mix', type: 'number', defaultValue: 100});
    return {
        id: descriptor.id,
        name: descriptor.name.slice(0, 64),
        opcode: opcode(descriptor),
        text: [descriptor.name].concat(inputs.map(input => `${input.label}: [${input.id}]`)).join(' ') + ' %',
        inputs,
        implementation: {type: 'penfx', opcode: opcode(descriptor)},
        separatorBefore: index === 0 || catalog[index - 1].file.split('/')[0] !== descriptor.file.split('/')[0]
    };
});

const settingsFor = (args, bindings) => {
    // Projects saved with the former JSON input can still render until their blocks are edited.
    let settings = {};
    if (args.SETTINGS !== undefined) {
        settings = JSON.parse(String(args.SETTINGS || '{}'));
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            throw new Error('Genshade settings must be a JSON object.');
        }
    }
    for (const binding of bindings) {
        if (args[binding.ids[0]] === undefined) continue;
        const values = binding.ids.map(id => args[id]);
        if (binding.color) {
            const hex = String(values[0]);
            const rgb = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(offset => (
                parseInt(hex.slice(offset, offset + 2), 16) / 255
            )) : [0, 0, 0];
            settings[binding.name] = rgb.concat(values.slice(1));
        } else {
            settings[binding.name] = values;
        }
    }
    return settings;
};

const installGenshade = (PenFX, vm) => {
    catalog.forEach((descriptor, index) => {
        PenFX.prototype[opcode(descriptor)] = function (args, util) {
            this._safe((engine, renderContext) => {
                const settings = settingsFor(args, definitions[index].bindings);
                const timeline = vm.runtime.movieAssetManager && vm.runtime.movieAssetManager.timeline;
                const time = Number(timeline && timeline.currentTime) || 0;
                const fps = Number(timeline && timeline.framerate) || 30;
                const mouse = vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
                if (!engine.genshadeRenderer) engine.genshadeRenderer = new GenshadeRenderer(engine);
                engine.genshadeRenderer.render(descriptor, settings, {
                    time, fps, frame: Math.round(time * fps), depth: depthResource(renderContext),
                    mouse: mouse ? [mouse.getClientX(), mouse.getClientY()] : [0, 0]
                }, mixAmount(args.MIX), this.blendMode);
            }, {target: util && util.target});
        };
    });
};
export {blocks, catalog, installGenshade, loadGenshade, settingsFor};
