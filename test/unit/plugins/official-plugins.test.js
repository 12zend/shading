import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import {installPenFX, listPluginIds, readPluginDirectory} from '../../helpers/official-plugins';
import {readPluginArchive} from '../../../src/lib/plugins/archive';
import {scanPlugin} from '../../../src/lib/plugins/security-scan';

// Every folder of shading-plugins must zip into a valid plugin that passes review without high-risk findings
// (Genshade declares its WebAssembly compiler), and every block it adds must finish in the VM tick.

const ids = listPluginIds();

describe('official plugins', () => {
    test('there is one folder per effect family', () => {
        expect(ids).toEqual(expect.arrayContaining([
            'blob-tracking', 'blur', 'buffer-stack', 'color-adjust', 'color-grading', 'distort', 'easy', 'film',
            'fractal-noise', 'genshade', 'glow', 'lens', 'lut', 'pixel-sort', 'stylize'
        ]));
    });

    test.each(ids)('%s zips into a valid archive and has no undeclared or high-risk code', async id => {
        const directory = readPluginDirectory(id);
        const zip = new JSZip();
        for (const [path, bytes] of directory.files) zip.file(`${id}/${path}`, bytes);
        const archive = await readPluginArchive(await zip.generateAsync({type: 'uint8array'}), `${id}.zip`);
        expect(archive.manifest.id).toBe(id);
        const scan = scanPlugin(archive);
        expect(scan.findings.filter(finding => finding.severity === 'high')).toEqual([]);
        expect(scan.undeclaredPermissions).toEqual([]);
    });

    test('every Looks block added by the official plugins returns undefined in the same tick', async () => {
        const vm = new VM();
        vm.runtime.renderer = {};
        installPenFX(vm);
        const penFX = vm.runtime.penFX;
        await penFX.customShaders._scheduleRefresh();
        const engineMethod = jest.fn();
        penFX.engine = new Proxy({blendOpacity: 1, _restoreGLState: jest.fn()}, {
            get: (target, property) => (property in target ? target[property] : engineMethod)
        });
        const plugins = vm.shadingPlugins.getPlugins();
        expect(plugins.filter(plugin => plugin.state !== 'active')).toEqual([]);
        for (const block of penFX.getInfo().blocks) {
            if (!block || block.blockType !== 'command') continue;
            const args = {};
            for (const id of Object.keys(block.arguments || {})) args[id] = block.arguments[id].defaultValue;
            const result = vm.runtime._primitives[`penfx_${block.opcode}`](args, {target: {}});
            if (typeof result !== 'undefined') throw new Error(`${block.opcode} returned ${result}`);
        }
    });
});
