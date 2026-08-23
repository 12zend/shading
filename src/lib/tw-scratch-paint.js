import React from 'react';

const INITIALIZE_SCRATCH_PAINT = 'scratch-gui/paint/INITIALIZE';

let realScratchPaint;
const getRealScratchPaint = () => {
    if (!realScratchPaint) {
        realScratchPaint = require('scratch-paint');
    }
    return realScratchPaint;
};

const PaintEditor = props => React.createElement(getRealScratchPaint().default, props);

let hasSetupReducer = false;
const ScratchPaintReducer = (state, action) => {
    if (!hasSetupReducer && (action.type === INITIALIZE_SCRATCH_PAINT ||
        (action.type === 'scratch-gui/navigation/ACTIVATE_TAB' && action.activeTabIndex === 1))) {
        hasSetupReducer = true;
    }
    if (hasSetupReducer) {
        return getRealScratchPaint().ScratchPaintReducer(state, action);
    }
    return {};
};

const initializeScratchPaint = () => ({
    type: INITIALIZE_SCRATCH_PAINT
});

export {
    PaintEditor as default,
    ScratchPaintReducer,
    initializeScratchPaint
};
