/* eslint-disable */
import catalog from 'scratch-render/src/pen-fx/genshade/catalog.json';
import {loadGenshade} from 'scratch-render/src/pen-fx/genshade/assets';
import GenshadeRenderer from 'scratch-render/src/pen-fx/genshade/renderer';
import {depthResource, mixAmount} from './helpers';

// Preserve the file path in IDs: two identically named ReShade techniques may use different algorithms.
const opcode = descriptor => `gs${descriptor.id.slice(9).replace(/[^a-zA-Z0-9]/g, '')}`;
const blocks = catalog.map((descriptor, index) => ({
    id: descriptor.id,
    name: descriptor.name.slice(0, 64),
    opcode: opcode(descriptor),
    text: `${descriptor.name} settings [SETTINGS] mix [MIX] %`,
    inputs: [
        {id: 'SETTINGS', label: 'settings', type: 'string', defaultValue: '{}'},
        {id: 'MIX', label: 'mix', type: 'number', defaultValue: 100}
    ],
    implementation: {type: 'penfx', opcode: opcode(descriptor)},
    separatorBefore: index === 0 || catalog[index - 1].file.split('/')[0] !== descriptor.file.split('/')[0]
}));

const installGenshade = (PenFX, vm) => {
    for (const descriptor of catalog) {
        PenFX.prototype[opcode(descriptor)] = function (args, util) {
            this._safe((engine, renderContext) => {
                const settings = JSON.parse(String(args.SETTINGS || '{}'));
                if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                    throw new Error('Genshade settings must be a JSON object.');
                }
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
    }
};
export {blocks, catalog, installGenshade, loadGenshade};
