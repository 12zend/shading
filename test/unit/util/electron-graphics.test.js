const {
    ANGLE_SWITCH,
    METAL_BACKEND,
    configureGraphicsBackend,
    supportsMetal
} = require('../../../electron/graphics');

const createCommandLine = (switches = []) => {
    const values = new Map(switches);
    return {
        appendSwitch: jest.fn((name, value) => values.set(name, value)),
        getSwitchValue: name => values.get(name) || '',
        hasSwitch: name => values.has(name)
    };
};

describe('Electron graphics backend', () => {
    test('recognizes macOS as the Metal-capable desktop platform', () => {
        expect(supportsMetal('darwin')).toBe(true);
        expect(supportsMetal('win32')).toBe(false);
        expect(supportsMetal('linux')).toBe(false);
    });

    test('selects Metal once on macOS', () => {
        const commandLine = createCommandLine();

        expect(configureGraphicsBackend(commandLine, 'darwin')).toBe(METAL_BACKEND);
        expect(commandLine.appendSwitch).toHaveBeenCalledTimes(1);
        expect(commandLine.appendSwitch).toHaveBeenCalledWith(ANGLE_SWITCH, METAL_BACKEND);

        expect(configureGraphicsBackend(commandLine, 'darwin')).toBeNull();
        expect(commandLine.appendSwitch).toHaveBeenCalledTimes(1);
    });

    test('leaves non-macOS and explicitly configured graphics paths unchanged', () => {
        const windowsCommandLine = createCommandLine();
        const explicitAngleCommandLine = createCommandLine([[ANGLE_SWITCH, 'gl']]);
        const explicitGlCommandLine = createCommandLine([['use-gl', 'desktop']]);
        const disabledGpuCommandLine = createCommandLine([['disable-gpu', '']]);

        expect(configureGraphicsBackend(windowsCommandLine, 'win32')).toBeNull();
        expect(configureGraphicsBackend(explicitAngleCommandLine, 'darwin')).toBeNull();
        expect(configureGraphicsBackend(explicitGlCommandLine, 'darwin')).toBeNull();
        expect(configureGraphicsBackend(disabledGpuCommandLine, 'darwin')).toBeNull();

        expect(windowsCommandLine.appendSwitch).not.toHaveBeenCalled();
        expect(explicitAngleCommandLine.appendSwitch).not.toHaveBeenCalled();
        expect(explicitGlCommandLine.appendSwitch).not.toHaveBeenCalled();
        expect(disabledGpuCommandLine.appendSwitch).not.toHaveBeenCalled();
    });
});
