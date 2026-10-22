import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import PaintEditor from '../lib/tw-scratch-paint';
import styles from './paint-editor-theme.css';
import {inlineSvgFonts, sanitizeSvg} from '@turbowarp/scratch-svg-renderer';
import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {getArtBoardScale, scaleSvg} from '../lib/paint-editor-resolution';
import {openFontsModal} from '../reducers/modals';

import {connect} from 'react-redux';
import {Theme} from '../lib/themes/index.js';

class PaintEditorWrapper extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleUpdateImage',
            'handleUpdateName',
            'handleUpdateFonts',
            'fontInlineFn'
        ]);
        this.state = {
            fonts: this.props.vm.runtime.fontManager.getFonts()
        };
        // Scale of the art board the paint editor was last rendered with; its exports are in that scale.
        this.artBoardScale = 1;
    }
    componentDidMount () {
        this.props.vm.runtime.fontManager.on('change', this.handleUpdateFonts);
    }
    shouldComponentUpdate (nextProps, nextState) {
        return this.props.imageId !== nextProps.imageId ||
            this.props.rtl !== nextProps.rtl ||
            this.props.name !== nextProps.name ||
            this.props.theme !== nextProps.theme ||
            this.props.customStageSize !== nextProps.customStageSize ||
            this.props.bitmapResolution !== nextProps.bitmapResolution ||
            this.state.fonts !== nextState.fonts;
    }
    componentWillUnmount () {
        this.props.vm.runtime.fontManager.off('change', this.handleUpdateFonts);
    }
    handleUpdateFonts () {
        this.setState({
            fonts: this.props.vm.runtime.fontManager.getFonts()
        });
    }
    handleUpdateName (name) {
        this.props.vm.renameCostume(this.props.selectedCostumeIndex, name);
        if (this.props.onCostumeRenamed) {
            const costume = this.props.vm.editingTarget.sprite.costumes[this.props.selectedCostumeIndex];
            this.props.onCostumeRenamed(costume.name);
        }
    }
    handleUpdateImage (isVector, image, rotationCenterX, rotationCenterY) {
        const scale = this.artBoardScale;
        if (isVector) {
            // A bitmap converted to a vector on an enlarged art board is enlarged with it.
            this.props.vm.updateSvg(
                this.props.selectedCostumeIndex,
                scale === 1 ? image : scaleSvg(image, 1 / scale),
                rotationCenterX / scale,
                rotationCenterY / scale);
        } else {
            this.props.vm.updateBitmap(
                this.props.selectedCostumeIndex,
                image,
                rotationCenterX,
                rotationCenterY,
                2 * scale /* bitmapResolution */);
        }
    }
    fontInlineFn (svgString) {
        return inlineSvgFonts(svgString, this.props.vm.renderer.customFonts);
    }
    render () {
        if (!this.props.imageId) return null;
        const {
            bitmapResolution, // eslint-disable-line no-unused-vars
            onCostumeRenamed, // eslint-disable-line no-unused-vars
            selectedCostumeIndex,
            vm,
            ...componentProps
        } = this.props;
        const costume = vm.getCostume(selectedCostumeIndex);
        this.artBoardScale = getArtBoardScale(this.props.imageFormat, this.props.bitmapResolution);
        return (
            <div className={styles.paintTheme}>
                <PaintEditor
                    {...componentProps}
                    image={this.props.imageFormat === 'svg' ? sanitizeSvg.sanitizeSvgText(costume) : costume}
                    onUpdateImage={this.handleUpdateImage}
                    onUpdateName={this.handleUpdateName}
                    fontInlineFn={this.fontInlineFn}
                    theme={this.props.theme.isDark() ? 'dark' : 'light'}
                    customFonts={this.state.fonts}
                    width={Math.round(this.props.customStageSize.width * this.artBoardScale)}
                    height={Math.round(this.props.customStageSize.height * this.artBoardScale)}
                />
            </div>
        );
    }
}

PaintEditorWrapper.propTypes = {
    bitmapResolution: PropTypes.number,
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    onManageFonts: PropTypes.func.isRequired,
    imageFormat: PropTypes.string.isRequired,
    imageId: PropTypes.string.isRequired,
    theme: PropTypes.instanceOf(Theme),
    name: PropTypes.string,
    onCostumeRenamed: PropTypes.func,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    selectedCostumeIndex: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = (state, {selectedCostumeIndex}) => {
    const targetId = state.scratchGui.vm.editingTarget.id;
    const sprite = state.scratchGui.vm.editingTarget.sprite;
    // Make sure the costume index doesn't go out of range.
    const index = selectedCostumeIndex < sprite.costumes.length ?
        selectedCostumeIndex : sprite.costumes.length - 1;
    const costume = state.scratchGui.vm.editingTarget.sprite.costumes[index];
    return {
        bitmapResolution: costume && costume.bitmapResolution,
        customStageSize: state.scratchGui.customStageSize,
        name: costume && costume.name,
        rotationCenterX: costume && costume.rotationCenterX,
        rotationCenterY: costume && costume.rotationCenterY,
        imageFormat: costume && costume.dataFormat,
        imageId: targetId && `${targetId}${costume.skinId}`,
        rtl: state.locales.isRtl,
        selectedCostumeIndex: index,
        theme: state.scratchGui.theme.theme,
        vm: state.scratchGui.vm,
        zoomLevelId: targetId
    };
};

const mapDispatchToProps = dispatch => ({
    onManageFonts: () => dispatch(openFontsModal())
});

export default ErrorBoundaryHOC('paint')(connect(
    mapStateToProps,
    mapDispatchToProps
)(PaintEditorWrapper));
