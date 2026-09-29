import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import Modal from '../../containers/modal.jsx';
import {localize} from '../../lib/movie-block-l10n';
import styles from './plugin-modals.css';

// Shown after a project opened from a share link that carries plugins. It lists every plugin the project uses
// and whether this editor already has it. Nothing is installed here: the chosen plugins go on to the regular
// install review (security scan and signature check) before any of their code runs.

const STATUS_TEXT = {
    missing: ['Not installed', '未インストール'],
    different: ['Different version installed', '別のバージョンをインストール済み'],
    installed: ['Installed', 'インストール済み']
};

class SharedPluginsModal extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            selected: props.plugins.filter(plugin => plugin.status === 'missing').map(plugin => plugin.id)
        };
        this.handleReview = () => this.props.onReview(this.state.selected.slice());
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    handleSelect (id, checked) {
        this.setState(state => ({
            selected: checked ?
                this.props.plugins.map(plugin => plugin.id)
                    .filter(candidate => candidate === id || state.selected.includes(candidate)) :
                state.selected.filter(candidate => candidate !== id)
        }));
    }
    renderPlugin (plugin) {
        const name = (plugin.localizedNames && plugin.localizedNames[this.props.locale]) || plugin.name;
        const selectable = plugin.status !== 'installed';
        const selected = this.state.selected.includes(plugin.id);
        return (
            <li
                className={classNames(styles.reviewItem, {[styles.reviewItemOff]: selectable && !selected})}
                key={plugin.id}
            >
                <label className={styles.reviewSelect}>
                    <input
                        type="checkbox"
                        checked={selectable ? selected : false}
                        disabled={!selectable}
                        // eslint-disable-next-line react/jsx-no-bind
                        onChange={event => this.handleSelect(plugin.id, event.target.checked)}
                    />
                    <span className={styles.identity}>
                        <span className={styles.identityName}>
                            {name}
                            {' '}
                            <span
                                className={classNames(styles.signature, {
                                    [styles.signatureOfficial]: plugin.status === 'installed',
                                    [styles.signatureInvalid]: plugin.status === 'missing'
                                })}
                            >
                                {this.t(...STATUS_TEXT[plugin.status])}
                            </span>
                        </span>
                        {plugin.description ? <span>{plugin.description}</span> : null}
                        <span className={styles.identityMeta}>
                            {`id: ${plugin.id}${plugin.version ? ` · v${plugin.version}` : ''}`}
                            {plugin.status === 'different' ?
                                ` · ${this.t('installed', 'インストール済み')}: v${plugin.installedVersion}` :
                                ''}
                        </span>
                    </span>
                </label>
            </li>
        );
    }
    render () {
        const {plugins} = this.props;
        return (
            <Modal
                className={styles.modalContent}
                contentLabel={this.t('Plugins used by this project', 'このプロジェクトで使われているプラグイン')}
                id="sharedPluginsModal"
                onRequestClose={this.props.onClose}
            >
                <div className={styles.body}>
                    <p>
                        {this.t('This shared project includes the plugins it uses. Choose the plugins to install. ' +
                            'Before anything runs, the next screen shows the security check and whether each ' +
                            'plugin is officially signed.',
                        'この共有プロジェクトには、使われているプラグインが含まれています。インストールするプラグインを' +
                            '選んでください。実行する前に、次の画面でセキュリティ検査の結果と公式の署名の有無を確認できます。')}
                    </p>
                    <div className={styles.warning}>
                        {this.t('Plugins run with the full privileges of the editor. Only install plugins from ' +
                            'people you trust.',
                        'プラグインはエディターと同じ権限で動作します。信頼できる相手のプラグインだけをインストールしてください。')}
                    </div>
                    <ul className={styles.reviewList}>
                        {plugins.map(plugin => this.renderPlugin(plugin))}
                    </ul>
                    <div className={styles.buttons}>
                        <button
                            className={styles.button}
                            onClick={this.props.onClose}
                        >
                            {this.t('Not now', '今はしない')}
                        </button>
                        <button
                            className={classNames(styles.button, styles.primary)}
                            disabled={this.state.selected.length === 0}
                            onClick={this.handleReview}
                        >
                            {this.t('Review and install…', '確認してインストール…')}
                        </button>
                    </div>
                </div>
            </Modal>
        );
    }
}

SharedPluginsModal.propTypes = {
    locale: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    onReview: PropTypes.func.isRequired,
    plugins: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
        localizedNames: PropTypes.object,
        version: PropTypes.string,
        description: PropTypes.string,
        status: PropTypes.oneOf(['missing', 'different', 'installed']).isRequired,
        installedVersion: PropTypes.string
    })).isRequired
};

export default SharedPluginsModal;
