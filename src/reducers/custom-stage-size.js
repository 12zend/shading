const SET_CUSTOM_STAGE_SIZE = 'tw/custom-stage-size/SET';

const defaultStageSize = {
    width: 480,
    height: 270
};

const initialState = defaultStageSize;

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_CUSTOM_STAGE_SIZE:
        return Object.assign({}, state, {
            width: action.width,
            height: action.height
        });
    default:
        return state;
    }
};

const setCustomStageSize = function (width, height) {
    return {
        type: SET_CUSTOM_STAGE_SIZE,
        width,
        height
    };
};

export {
    reducer as default,
    initialState as customStageSizeInitialState,
    defaultStageSize,
    setCustomStageSize
};
