/**
 * The editor always enables the warp timer (see containers/blocks.jsx), so an unchanged editor
 * setting must not be stored in the project. Otherwise players would inherit it.
 */
const EDITOR_WARP_TIMER_DEFAULT = true;

/**
 * Store all Advanced Settings in the project using the GUI's defaults.
 *
 * scratch-vm compares the current options with the VM's built-in defaults
 * (480x360 stage, warp timer off) and omits matching values. This GUI has
 * different defaults, so use them while generating the stored options.
 * Otherwise an explicitly selected 480x360 stage is omitted and becomes the
 * GUI default when the project is loaded again, and the editor-only warp timer
 * would be stored in every project.
 *
 * @param {VirtualMachine} vm Scratch VM instance
 * @param {{width: number, height: number}} defaultStageSize GUI default stage size
 * @returns {*} the return value from vm.storeProjectOptions()
 */
const storeProjectOptions = (vm, defaultStageSize) => {
    const storedDefaults = vm.runtime && vm.runtime._defaultStoredSettings;
    if (!storedDefaults) {
        return vm.storeProjectOptions();
    }

    const originalWidth = storedDefaults.width;
    const originalHeight = storedDefaults.height;
    const originalCompilerOptions = storedDefaults.compilerOptions;
    storedDefaults.width = defaultStageSize.width;
    storedDefaults.height = defaultStageSize.height;
    if (originalCompilerOptions) {
        storedDefaults.compilerOptions = Object.assign({}, originalCompilerOptions, {
            warpTimer: EDITOR_WARP_TIMER_DEFAULT
        });
    }
    try {
        return vm.storeProjectOptions();
    } finally {
        storedDefaults.width = originalWidth;
        storedDefaults.height = originalHeight;
        storedDefaults.compilerOptions = originalCompilerOptions;
    }
};

export default storeProjectOptions;
