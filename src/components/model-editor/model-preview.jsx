import PropTypes from 'prop-types';
import React from 'react';

import styles from './model-editor.css';

class ModelPreview extends React.Component {
    constructor (props) {
        super(props);
        this.setCanvas = this.setCanvas.bind(this);
    }

    componentDidMount () {
        this.renderModel();
    }

    componentDidUpdate (previousProps) {
        if (previousProps.model.assetId !== this.props.model.assetId) this.renderModel();
    }

    componentWillUnmount () {
        this.renderVersion++;
        if (this.renderer) this.renderer.dispose();
    }

    setCanvas (canvas) {
        this.canvas = canvas;
    }

    async renderModel () {
        if (!this.canvas) return;
        const version = (this.renderVersion || 0) + 1;
        this.renderVersion = version;
        if (this.renderer) this.renderer.dispose();
        try {
            const renderer = await this.props.manager.renderModelPreview(this.props.model, this.canvas);
            if (version !== this.renderVersion) {
                renderer.dispose();
                return;
            }
            this.renderer = renderer;
        } catch (error) {
            if (this.props.onError) this.props.onError(error);
        }
    }

    render () {
        return (
            <canvas
                aria-label={this.props.model.name}
                className={styles.previewCanvas}
                ref={this.setCanvas}
            />
        );
    }
}

ModelPreview.propTypes = {
    manager: PropTypes.shape({
        renderModelPreview: PropTypes.func.isRequired
    }).isRequired,
    model: PropTypes.shape({
        assetId: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired
    }).isRequired,
    onError: PropTypes.func
};

export default ModelPreview;
