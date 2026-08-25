/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 */

import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {compose} from 'redux';
import {injectIntl, intlShape} from 'react-intl';

import SettingsStore from '../addons/settings-store-singleton';
import AddonChannels from '../addons/channels';
import AppStateHOC from '../lib/app-state-hoc.jsx';
import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import TWStateManagerHOC from '../lib/tw-state-manager-hoc.jsx';
import TWPackagerIntegrationHOC from '../lib/tw-packager-integration-hoc.jsx';
import '../lib/tw-fix-history-api';
import InvalidEmbed from '../components/tw-invalid-embed/invalid-embed.jsx';
import {APP_NAME} from '../lib/brand.js';
import {getIsLoading} from '../reducers/project-state.js';
import GUI from './render-gui.jsx';
import {loadServiceWorker} from './load-service-worker';
import runAddons from '../addons/entry';

import styles from './interface.css';

const isInvalidEmbed = window.parent !== window;

const handleClickAddonSettings = addonId => {
    const path = process.env.ROUTING_STYLE === 'wildcard' ? 'addons' : 'addons.html';
    const url = `${process.env.ROOT}${path}${typeof addonId === 'string' ? `#${addonId}` : ''}`;
    window.open(url);
};

if (AddonChannels.reloadChannel) {
    AddonChannels.reloadChannel.addEventListener('message', () => location.reload());
}

if (AddonChannels.changeChannel) {
    AddonChannels.changeChannel.addEventListener('message', event => {
        SettingsStore.setStoreWithVersionCheck(event.data);
    });
}

runAddons();

class Interface extends React.Component {
    constructor (props) {
        super(props);
        this.handleUpdateProjectTitle = this.handleUpdateProjectTitle.bind(this);
    }

    componentDidUpdate (prevProps) {
        if (prevProps.isLoading && !this.props.isLoading) loadServiceWorker();
    }

    handleUpdateProjectTitle (title, isDefault) {
        if (isDefault || !title) {
            document.title = APP_NAME;
        } else {
            document.title = `${title} - ${APP_NAME}`;
        }
    }

    render () {
        if (isInvalidEmbed) return <InvalidEmbed />;
        const {
            /* eslint-disable no-unused-vars */
            intl,
            isLoading,
            isPlayerOnly,
            isRtl,
            /* eslint-enable no-unused-vars */
            ...props
        } = this.props;
        return (
            <div
                className={classNames(styles.container, {
                    [styles.playerOnly]: isPlayerOnly,
                    [styles.editor]: !isPlayerOnly
                })}
                dir={isRtl ? 'rtl' : 'ltr'}
            >
                <div
                    className={styles.center}
                    style={isPlayerOnly ? ({
                        width: `${Math.max(480, props.customStageSize.width) + 2}px`
                    }) : null}
                >
                    <GUI
                        backpackHost="_local_"
                        backpackVisible
                        onClickAddonSettings={handleClickAddonSettings}
                        onUpdateProjectTitle={this.handleUpdateProjectTitle}
                        {...props}
                    />
                </div>
            </div>
        );
    }
}

Interface.propTypes = {
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    intl: intlShape,
    isLoading: PropTypes.bool,
    isPlayerOnly: PropTypes.bool,
    isRtl: PropTypes.bool
};

const mapStateToProps = state => ({
    customStageSize: state.scratchGui.customStageSize,
    isLoading: getIsLoading(state.scratchGui.projectState.loadingState),
    isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
    isRtl: state.locales.isRtl
});

const ConnectedInterface = injectIntl(connect(mapStateToProps)(Interface));

const WrappedInterface = compose(
    AppStateHOC,
    ErrorBoundaryHOC('Shading Interface'),
    TWStateManagerHOC,
    TWPackagerIntegrationHOC
)(ConnectedInterface);

export default WrappedInterface;
