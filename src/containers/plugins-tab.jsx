import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import PluginsTabComponent from '../components/plugins-tab/plugins-tab.jsx';
import {localize} from '../lib/movie-block-l10n';

// The Plugins tab: installed plugins, which of them load on the next start, and adding zips.
class PluginsTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChanged',
            'handleImport',
            'handleReload',
            'handleRemove',
            'handleSetAll',
            'handleToggle'
        ]);
        this.state = {plugins: [], missingPlugins: [], menuItems: []};
    }
    componentDidMount () {
        this.manager = this.props.vm.shadingPlugins || null;
        if (!this.manager) return;
        this.manager.on('changed', this.handleChanged);
        this.manager.on('menuChanged', this.handleChanged);
        this.manager.on('missingPlugins', this.handleChanged);
        this.handleChanged();
    }
    componentWillUnmount () {
        if (!this.manager) return;
        this.manager.removeListener('changed', this.handleChanged);
        this.manager.removeListener('menuChanged', this.handleChanged);
        this.manager.removeListener('missingPlugins', this.handleChanged);
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    handleChanged () {
        this.setState({
            plugins: this.manager.getPlugins(this.props.locale),
            menuItems: this.manager.getMenuItems(),
            missingPlugins: this.manager.getMissingPlugins()
        });
    }
    handleImport () {
        if (this.manager) this.manager.openImportPicker();
    }
    handleToggle (id, enabled) {
        this.manager.setLoadOnStartup(id, enabled);
    }
    handleSetAll (enabled) {
        this.manager.setLoadOnStartup(this.state.plugins.map(plugin => plugin.id), enabled);
    }
    handleReload () {
        // eslint-disable-next-line no-alert
        if (this.props.projectChanged && !window.confirm(this.t(
            'Reload the editor? Unsaved changes to the project will be lost.',
            'エディターを再読み込みしますか？ 保存していないプロジェクトの変更は失われます。'))) return;
        window.location.reload();
    }
    handleRemove (plugin) {
        // eslint-disable-next-line no-alert
        if (!window.confirm(this.t(`Remove the plugin "${plugin.name}"? Blocks that use it stay in your projects.`,
            `プラグイン「${plugin.name}」を削除しますか？ このプラグインのブロックはプロジェクト内に残ります。`))) return;
        this.manager.uninstall(plugin.id);
    }
    render () {
        return (
            <PluginsTabComponent
                locale={this.props.locale}
                menuItems={this.state.menuItems}
                missingPlugins={this.state.missingPlugins}
                plugins={this.state.plugins}
                onImport={this.handleImport}
                onReload={this.handleReload}
                onRemove={this.handleRemove}
                onSetAll={this.handleSetAll}
                onToggle={this.handleToggle}
            />
        );
    }
}

PluginsTab.propTypes = {
    locale: PropTypes.string.isRequired,
    projectChanged: PropTypes.bool,
    vm: PropTypes.shape({
        shadingPlugins: PropTypes.object
    }).isRequired
};

const mapStateToProps = state => ({
    locale: state.locales.locale,
    projectChanged: state.scratchGui.projectChanged
});

export default connect(mapStateToProps)(PluginsTab);
