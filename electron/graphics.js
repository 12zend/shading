const ANGLE_SWITCH = 'use-angle';
const METAL_BACKEND = 'metal';
const EXPLICIT_GRAPHICS_SWITCHES = ['use-gl', ANGLE_SWITCH];

const supportsMetal = (platform = process.platform) => platform === 'darwin';

const hasSwitch = (commandLine, name) => (
    commandLine && typeof commandLine.hasSwitch === 'function' && commandLine.hasSwitch(name)
);

/**
 * Select the graphics backend before Chromium creates its GPU process.
 *
 * Electron's WebGL consumers (the Scratch renderer, PenFX, and Three.js)
 * all share Chromium's ANGLE backend. Keeping this decision here means those
 * consumers do not need separate Metal implementations.
 *
 * Electron's supported macOS runtime is Metal-capable. ANGLE remains
 * responsible for validating the device and handling the resulting GPU
 * context, while other platforms keep their existing default backend.
 *
 * @param {object} commandLine Electron's app.commandLine object
 * @param {string} platform The host platform, injectable for tests
 * @returns {string|null} The selected backend, or null when unchanged
 */
const configureGraphicsBackend = (commandLine, platform = process.platform) => {
    if (!supportsMetal(platform) || !commandLine ||
        typeof commandLine.appendSwitch !== 'function') return null;

    // Preserve an explicit launch choice, including --use-gl and --disable-gpu.
    if (hasSwitch(commandLine, 'disable-gpu') ||
        EXPLICIT_GRAPHICS_SWITCHES.some(name => hasSwitch(commandLine, name))) return null;

    commandLine.appendSwitch(ANGLE_SWITCH, METAL_BACKEND);
    return METAL_BACKEND;
};

module.exports = {
    ANGLE_SWITCH,
    METAL_BACKEND,
    configureGraphicsBackend,
    supportsMetal
};
