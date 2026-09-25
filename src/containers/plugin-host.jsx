import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import PluginReviewModal from '../components/plugin-modals/plugin-review-modal.jsx';
import PluginManagerModal from '../components/plugin-modals/plugin-manager-modal.jsx';
import {localize} from '../lib/movie-block-l10n';
import styles from '../components/plugin-modals/plugin-modals.css';

const TOAST_MS = 6000;

// Connects the plugin manager (vm.shadingPlugins) to the editor UI: the install review, the plugin list, notices
// about plugins a project needs, and messages from plugins.
class PluginHost extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'attach',
            'handleChanged',
            'handleReview',
            'handleReviewError',
            'handleOpenManager',
            'handleMissing',
            'handleNotify',
            'handleInstall',
            'handleCancelReview',
            'handleCloseManager',
            'handleToggle',
            'handleRemove'
        ]);
        this.state = {
            review: null,
            managerOpen: false,
            plugins: [],
            missingPlugins: [],
            menuItems: [],
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
        this.manager.removeListener('changed', this.handleChanged);
        this.manager.removeListener('menuChanged', this.handleChanged);
        this.manager.removeListener('review', this.handleReview);
        this.manager.removeListener('reviewError', this.handleReviewError);
        this.manager.removeListener('openManager', this.handleOpenManager);
        this.manager.removeListener('missingPlugins', this.handleMissing);
        this.manager.removeListener('notify', this.handleNotify);
    }
    attach (manager) {
        if (this.manager) return;
        this.manager = manager;
        manager.on('changed', this.handleChanged);
        manager.on('menuChanged', this.handleChanged);
        manager.on('review', this.handleReview);
        manager.on('reviewError', this.handleReviewError);
        manager.on('openManager', this.handleOpenManager);
        manager.on('missingPlugins', this.handleMissing);
        manager.on('notify', this.handleNotify);
        this.handleChanged();
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    showToast (message) {
        clearTimeout(this.toastTimeout);
        this.setState({toast: message});
        this.toastTimeout = setTimeout(() => this.setState({toast: null}), TOAST_MS);
    }
    handleChanged () {
        this.setState({
            plugins: this.manager.getPlugins(this.props.locale),
            menuItems: this.manager.getMenuItems(),
            missingPlugins: this.manager.getMissingPlugins()
        });
    }
    handleReview (review) {
        this.setState({review});
    }
    handleReviewError ({fileName, message}) {
        this.showToast(`${this.t('Could not read the plugin', 'プラグインを読み込めませんでした')} ` +
            `${fileName ? `(${fileName})` : ''}: ${message}`);
    }
    handleOpenManager () {
        this.handleChanged();
        this.setState({managerOpen: true});
    }
    handleMissing (missingPlugins) {
        this.setState({missingPlugins});
        // Tell the user once per project which plugins it needs; the list stays in the plugin manager.
        if (missingPlugins.length) this.setState({managerOpen: true});
    }
    handleNotify ({pluginId, message}) {
        this.showToast(`${pluginId}: ${message}`);
    }
    handleInstall () {
        this.manager.confirmReview()
            .then(plugin => {
                this.setState({review: null});
                if (plugin) {
                    const localized = this.manager.getPlugins(this.props.locale).find(entry => entry.id === plugin.id);
                    const name = localized ? localized.name : plugin.name;
                    this.showToast(this.t(`Installed ${name}.`, `${name} をインストールしました。`));
                }
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
    handleCloseManager () {
        this.setState({managerOpen: false});
    }
    handleToggle (id, enabled) {
        this.manager.setEnabled(id, enabled);
    }
    handleRemove (plugin) {
        // eslint-disable-next-line no-alert
        if (!window.confirm(this.t(`Remove the plugin "${plugin.name}"? Blocks that use it stay in your projects.`,
            `プラグイン「${plugin.name}」を削除しますか？ このプラグインのブロックはプロジェクト内に残ります。`))) return;
        this.manager.uninstall(plugin.id);
    }
    render () {
        return (
            <React.Fragment>
                {this.state.review ? (
                    <PluginReviewModal
                        locale={this.props.locale}
                        review={this.state.review}
                        onCancel={this.handleCancelReview}
                        onInstall={this.handleInstall}
                    />
                ) : null}
                {this.state.managerOpen && !this.state.review ? (
                    <PluginManagerModal
                        locale={this.props.locale}
                        menuItems={this.state.menuItems}
                        missingPlugins={this.state.missingPlugins}
                        plugins={this.state.plugins}
                        onClose={this.handleCloseManager}
                        onRemove={this.handleRemove}
                        onToggle={this.handleToggle}
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

export default connect(mapStateToProps)(PluginHost);
