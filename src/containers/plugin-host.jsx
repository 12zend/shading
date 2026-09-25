import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import PluginReviewModal from '../components/plugin-modals/plugin-review-modal.jsx';
import {localize} from '../lib/movie-block-l10n';
import {activateTab, PLUGINS_TAB_INDEX} from '../reducers/editor-tab';
import styles from '../components/plugin-modals/plugin-modals.css';

const TOAST_MS = 6000;

// Connects the plugin manager (vm.shadingPlugins) to the editor UI: the install review, opening the Plugins tab
// (from the menu or when a project needs plugins that are not loaded), and messages from plugins.
class PluginHost extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'attach',
            'handleReview',
            'handleReviewError',
            'handleOpenManager',
            'handleMissing',
            'handleNotify',
            'handleInstall',
            'handleCancelReview'
        ]);
        this.state = {
            review: null,
            toast: null
        };
        this.manager = null;
    }
    componentDidMount () {
        if (this.props.vm.shadingPlugins) this.attach(this.props.vm.shadingPlugins);
        else this.props.vm.on('SHADING_PLUGINS_ATTACHED', this.attach);
    }
    componentWillUnmount () {
        this.props.vm.removeListener('SHADING_PLUGINS_ATTACHED', this.attach);
        clearTimeout(this.toastTimeout);
        if (!this.manager) return;
        this.manager.removeListener('review', this.handleReview);
        this.manager.removeListener('reviewError', this.handleReviewError);
        this.manager.removeListener('openManager', this.handleOpenManager);
        this.manager.removeListener('missingPlugins', this.handleMissing);
        this.manager.removeListener('notify', this.handleNotify);
    }
    attach (manager) {
        if (this.manager) return;
        this.manager = manager;
        manager.on('review', this.handleReview);
        manager.on('reviewError', this.handleReviewError);
        manager.on('openManager', this.handleOpenManager);
        manager.on('missingPlugins', this.handleMissing);
        manager.on('notify', this.handleNotify);
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    showToast (message) {
        clearTimeout(this.toastTimeout);
        this.setState({toast: message});
        this.toastTimeout = setTimeout(() => this.setState({toast: null}), TOAST_MS);
    }
    handleReview (review) {
        this.setState({review});
    }
    handleReviewError ({fileName, message}) {
        this.showToast(`${this.t('Could not read the plugin', 'プラグインを読み込めませんでした')} ` +
            `${fileName ? `(${fileName})` : ''}: ${message}`);
    }
    handleOpenManager () {
        this.props.onOpenPluginsTab();
    }
    handleMissing (missingPlugins) {
        // Tell the user once per project which plugins it needs; the list stays in the Plugins tab.
        if (missingPlugins.length) this.props.onOpenPluginsTab();
    }
    handleNotify ({pluginId, message}) {
        this.showToast(`${pluginId}: ${message}`);
    }
    pluginName (id) {
        const plugin = this.manager.getPlugins(this.props.locale).find(entry => entry.id === id);
        return plugin ? plugin.name : id;
    }
    handleInstall (ids) {
        this.manager.confirmReview(ids)
            .then(({installed, failed}) => {
                this.setState({review: null});
                const messages = [];
                if (installed.length) {
                    const names = installed.map(plugin => this.pluginName(plugin.id)).join(', ');
                    messages.push(this.t(`Installed ${names}.`, `${names} をインストールしました。`));
                }
                for (const failure of failed) {
                    messages.push(`${this.t('Could not start', '開始できませんでした')} ` +
                        `${this.pluginName(failure.id)}: ${failure.message}`);
                }
                if (messages.length) this.showToast(messages.join('\n'));
            })
            .catch(error => {
                this.setState({review: null});
                this.showToast(`${this.t('The plugin could not start', 'プラグインを開始できませんでした')}: ${error.message}`);
            });
    }
    handleCancelReview () {
        this.manager.cancelReview();
        this.setState({review: null});
    }
    render () {
        return (
            <React.Fragment>
                {this.state.review ? (
                    <PluginReviewModal
                        locale={this.props.locale}
                        errors={this.state.review.errors}
                        reviews={this.state.review.reviews}
                        onCancel={this.handleCancelReview}
                        onInstall={this.handleInstall}
                    />
                ) : null}
                {this.state.toast ? (
                    <div
                        className={styles.toast}
                        role="status"
                    >
                        {this.state.toast}
                    </div>
                ) : null}
            </React.Fragment>
        );
    }
}

PluginHost.propTypes = {
    locale: PropTypes.string.isRequired,
    onOpenPluginsTab: PropTypes.func.isRequired,
    vm: PropTypes.shape({
        on: PropTypes.func,
        removeListener: PropTypes.func,
        shadingPlugins: PropTypes.object
    }).isRequired
};

const mapStateToProps = state => ({
    locale: state.locales.locale,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onOpenPluginsTab: () => dispatch(activateTab(PLUGINS_TAB_INDEX))
});

export default connect(mapStateToProps, mapDispatchToProps)(PluginHost);
