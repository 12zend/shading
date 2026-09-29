import {connect} from 'react-redux';

import ShadingTutorial from '../components/shading-tutorial/shading-tutorial.jsx';
import {
    activateTab,
    BLOCKS_TAB_INDEX,
    COSTUMES_TAB_INDEX,
    FONTS_TAB_INDEX,
    MODELS_TAB_INDEX,
    PLUGINS_TAB_INDEX,
    SHADERS_TAB_INDEX,
    SOUNDS_TAB_INDEX,
    VIDEOS_TAB_INDEX
} from '../reducers/editor-tab';
import {getIsShowingProject} from '../reducers/project-state';

const TAB_INDEXES = Object.freeze({
    code: BLOCKS_TAB_INDEX,
    costumes: COSTUMES_TAB_INDEX,
    sounds: SOUNDS_TAB_INDEX,
    videos: VIDEOS_TAB_INDEX,
    fonts: FONTS_TAB_INDEX,
    models: MODELS_TAB_INDEX,
    shaders: SHADERS_TAB_INDEX,
    plugins: PLUGINS_TAB_INDEX
});

const mapStateToProps = state => ({
    activeTabIndex: state.scratchGui.editorTab.activeTabIndex,
    isProjectReady: getIsShowingProject(state.scratchGui.projectState.loadingState) &&
        !state.scratchGui.modals.loadingProject,
    locale: state.locales.locale,
    tabIndexes: TAB_INDEXES,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onActivateTab: tabIndex => dispatch(activateTab(tabIndex))
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ShadingTutorial);
