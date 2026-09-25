import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import Modal from '../../containers/modal.jsx';
import {localize} from '../../lib/movie-block-l10n';
import styles from './plugin-modals.css';

const STATE_TEXT = {
    active: ['Enabled', '有効'],
    loading: ['Loading…', '読み込み中…'],
    inactive: ['Disabled', '無効'],
    error: ['Error', 'エラー']
};

const levelClass = level => styles[`level${level.charAt(0).toUpperCase()}${level.slice(1)}`];

// Installed plugins: enable, disable or remove them. New plugins are added with the button at the bottom-left
// of the code area.
const PluginManagerModal = ({locale, plugins, missingPlugins, menuItems, onClose, onRemove, onToggle}) => {
    const t = (en, ja) => localize(locale, en, ja);
    return (
        <Modal
            className={styles.modalContent}
            contentLabel={t('Plugins', 'プラグイン')}
            id="pluginManagerModal"
            onRequestClose={onClose}
        >
            <div className={styles.body}>
                <p>
                    {t('Add plugins (.zip) with the button at the bottom-left of the code area.',
                        'プラグイン（.zip）はコードエリア左下のボタンから追加できます。')}
                </p>
                {missingPlugins.length ? (
                    <div className={classNames(styles.warning, styles.warningHigh)}>
                        <strong>{t('This project needs plugins that are not installed:',
                            'このプロジェクトには未インストールのプラグインが必要です:')}</strong>
                        <ul>
                            {missingPlugins.map(plugin => (
                                <li key={plugin.id}>
                                    {plugin.id === 'unknown' ?
                                        `${t('Unknown plugin', '不明なプラグイン')}: ${(plugin.opcodes || []).join(', ')}` :
                                        `${plugin.name || plugin.id}${plugin.version ? ` (v${plugin.version})` : ''}`}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                {plugins.length ? (
                    <ul className={styles.pluginList}>
                        {plugins.map(plugin => (
                            <li
                                className={styles.plugin}
                                key={plugin.id}
                            >
                                <div>
                                    <div className={styles.identityName}>
                                        {plugin.name}
                                        {' '}
                                        {plugin.scanLevel ? (
                                            <span className={classNames(styles.level, levelClass(plugin.scanLevel))}>
                                                {t(...{
                                                    none: ['Checked', '検査済み'],
                                                    low: ['Low risk', '低リスク'],
                                                    medium: ['Caution', '注意'],
                                                    high: ['High risk', '高リスク']
                                                }[plugin.scanLevel])}
                                            </span>
                                        ) : null}
                                    </div>
                                    {plugin.description ? <div>{plugin.description}</div> : null}
                                    <div className={styles.identityMeta}>
                                        {`${plugin.id} · v${plugin.version}${
                                            plugin.author ? ` · ${plugin.author}` : ''
                                        } · ${t(...(STATE_TEXT[plugin.state] || [plugin.state, plugin.state]))}`}
                                    </div>
                                    {plugin.missingRecommendations.length ? (
                                        <div className={styles.identityMeta}>
                                            {t('Works best with: ', '併用を推奨: ')}
                                            {plugin.missingRecommendations.join(', ')}
                                        </div>
                                    ) : null}
                                </div>
                                <div className={styles.pluginActions}>
                                    <label>
                                        <input
                                            checked={plugin.enabled}
                                            type="checkbox"
                                            // eslint-disable-next-line react/jsx-no-bind
                                            onChange={() => onToggle(plugin.id, !plugin.enabled)}
                                        />
                                        {t('Enabled', '有効')}
                                    </label>
                                    <button
                                        className={styles.button}
                                        type="button"
                                        onClick={() => onRemove(plugin)} // eslint-disable-line react/jsx-no-bind
                                    >
                                        {t('Remove', '削除')}
                                    </button>
                                </div>
                                {plugin.error ? <div className={styles.pluginError}>{plugin.error}</div> : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className={styles.empty}>{t('No plugins are installed.', 'インストール済みのプラグインはありません。')}</p>
                )}
                {menuItems.length ? (
                    <React.Fragment>
                        <div className={styles.sectionTitle}>{t('Plugin commands', 'プラグインのコマンド')}</div>
                        <div className={styles.buttons}>
                            {menuItems.map(item => (
                                <button
                                    className={styles.button}
                                    key={item.key}
                                    type="button"
                                    onClick={item.onClick} // eslint-disable-line react/jsx-handler-names
                                >
                                    {typeof item.label === 'object' && item.label ?
                                        (item.label[locale] || item.label.en) : String(item.label)}
                                </button>
                            ))}
                        </div>
                    </React.Fragment>
                ) : null}
                <div className={styles.buttons}>
                    <button
                        className={classNames(styles.button, styles.primary)}
                        type="button"
                        onClick={onClose}
                    >
                        {t('Close', '閉じる')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

PluginManagerModal.propTypes = {
    locale: PropTypes.string.isRequired,
    menuItems: PropTypes.arrayOf(PropTypes.object).isRequired,
    missingPlugins: PropTypes.arrayOf(PropTypes.object).isRequired,
    onClose: PropTypes.func.isRequired,
    onRemove: PropTypes.func.isRequired,
    onToggle: PropTypes.func.isRequired,
    plugins: PropTypes.arrayOf(PropTypes.object).isRequired
};

export default PluginManagerModal;
