/**
 * Store TurboWarp project options using the GUI's stage size as the default.
 *
 * scratch-vm compares the current stage size with the VM's built-in default
 * (480x360) and omits matching values. This GUI can have a different default,
 * so use that default while generating the stored options. Otherwise an
 * explicitly selected 480x360 stage is omitted and becomes the GUI default
 * when the project is loaded again.
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
    storedDefaults.width = defaultStageSize.width;
    storedDefaults.height = defaultStageSize.height;
    try {
        return vm.storeProjectOptions();
    } finally {
        storedDefaults.width = originalWidth;
        storedDefaults.height = originalHeight;
    }
};

export default storeProjectOptions;
