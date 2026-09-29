import EventEmitter from 'events';

// Whether the first-run tutorial still has to be shown in this browser, and where the user left off.
// Once the tutorial is finished or skipped it no longer opens by itself; the menu can restart it.

const STORAGE_KEY = 'shading:tutorial';
const STATUS_ACTIVE = 'active';
const STATUS_COMPLETED = 'completed';
const STATUS_SKIPPED = 'skipped';

const events = new EventEmitter();

const getStorage = () => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (error) {
        return null;
    }
};

/**
 * Read the saved tutorial progress.
 * @returns {object} {status, step}; status is `active` when the tutorial has not been finished or skipped.
 */
const readTutorialState = () => {
    const fallback = {status: STATUS_ACTIVE, step: null};
    const storage = getStorage();
    if (!storage) return fallback;
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
        if (!parsed || typeof parsed !== 'object') return fallback;
        const status = [STATUS_ACTIVE, STATUS_COMPLETED, STATUS_SKIPPED].includes(parsed.status) ?
            parsed.status : STATUS_ACTIVE;
        return {status, step: typeof parsed.step === 'string' ? parsed.step : null};
    } catch (error) {
        return fallback;
    }
};

const writeTutorialState = state => {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({status: state.status, step: state.step || null}));
    } catch (error) {
        // Private windows and full storage only lose the saved progress.
    }
};

const shouldShowTutorial = () => readTutorialState().status === STATUS_ACTIVE;

/**
 * Open the tutorial again from the start (used by the menu).
 */
const restartTutorial = () => {
    writeTutorialState({status: STATUS_ACTIVE, step: null});
    events.emit('restart');
};

const onTutorialRestart = callback => {
    events.on('restart', callback);
    return () => events.removeListener('restart', callback);
};

export {
    STATUS_ACTIVE,
    STATUS_COMPLETED,
    STATUS_SKIPPED,
    STORAGE_KEY,
    onTutorialRestart,
    readTutorialState,
    restartTutorial,
    shouldShowTutorial,
    writeTutorialState
};
