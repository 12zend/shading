import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import {localize} from '../../lib/movie-block-l10n';
import styles from './plugins-tab.css';

const STATE_TEXT = {
    active: ['Loaded', '読み込み済み'],
    loading: ['Loading…', '読み込み中…'],
    inactive: ['Not loaded', '未読み込み'],
    error: ['Error', 'エラー']
};

const LEVEL_TEXT = {
    none: ['Checked', '検査済み'],
    low: ['Low risk', '低リスク'],
    medium: ['Caution', '注意'],
    high: ['High risk', '高リスク']
};

const SIGNATURE_TEXT = {
    official: ['Official · signed', '公式・署名済み'],
    unsigned: ['Unofficial', '非公式'],
    invalid: ['Signature invalid', '署名が無効']
};

const levelClass = level => styles[`level${level.charAt(0).toUpperCase()}${level.slice(1)}`];

// Installed plugins and which of them load when the editor starts. Switches only change the start-up choice;
// the editor keeps running the plugins it loaded until it is reloaded.
const PluginsTab = ({
    locale,
    plugins,
    missingPlugins,
    menuItems,
    onImport,
    onReload,
    onRemove,
    onSetAll,
    onToggle
}) => {
    const t = (en, ja) => localize(locale, en, ja);
    const pending = plugins.filter(plugin => plugin.pendingReload);
    const enabledIds = new Set(plugins.filter(plugin => plugin.enabled).map(plugin => plugin.id));
    const installedIds = new Set(plugins.map(plugin => plugin.id));
    const enabledCount = enabledIds.size;
    return (
        <div className={styles.tab}>
            <div className={styles.toolbar}>
                <div className={styles.title}>
                    {t('Plugins', 'プラグイン')}
                    <span className={styles.count}>
                        {t(`${enabledCount} of ${plugins.length} load on start`,
                            `${plugins.length} 個中 ${enabledCount} 個を起動時に読み込み`)}
                    </span>
                </div>
                <div className={styles.toolbarButtons}>
                    <button
                        className={styles.button}
                        disabled={!plugins.length || enabledCount === plugins.length}
                        type="button"
                        onClick={() => onSetAll(true)} // eslint-disable-line react/jsx-no-bind
                    >
                        {t('All on', 'すべてオン')}
                    </button>
                    <button
                        className={styles.button}
                        disabled={!enabledCount}
                        type="button"
                        onClick={() => onSetAll(false)} // eslint-disable-line react/jsx-no-bind
                    >
                        {t('All off', 'すべてオフ')}
                    </button>
                    <button
                        className={classNames(styles.button, styles.primary)}
                        type="button"
                        onClick={onImport}
                    >
                        {t('Add plugins (.zip)…', 'プラグインを追加（.zip）…')}
                    </button>
                </div>
            </div>

            <div className={styles.content}>
                {pending.length ? (
                    <div
                        className={styles.reloadNotice}
                        role="status"
                    >
                        <span>
                            {t(`${pending.length} change${pending.length > 1 ? 's' : ''} will apply after reloading.`,
                                `${pending.length} 件の変更は再読み込み後に反映されます。`)}
                        </span>
                        <button
                            className={classNames(styles.button, styles.primary)}
                            type="button"
                            onClick={onReload}
                        >
                            {t('Reload now', '今すぐ再読み込み')}
                        </button>
                    </div>
                ) : (
                    <p className={styles.hint}>
                        {t('Turn plugins on or off to choose which ones load when the editor is reloaded.',
                            'オン／オフで、エディターを再読み込みしたときに読み込むプラグインを選べます。')}
                    </p>
                )}

                {missingPlugins.length ? (
                    <div className={styles.warning}>
                        <strong>{t('This project needs plugins that are not loaded:',
                            'このプロジェクトには読み込まれていないプラグインが必要です:')}</strong>
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
                    <ul className={styles.list}>
                        {plugins.map(plugin => {
                            const blockedBy = plugin.enabled ?
                                plugin.dependencies.filter(id => !enabledIds.has(id)) : [];
                            const inputId = `plugin-load-${plugin.id}`;
                            return (
                                <li
                                    className={classNames(styles.plugin, {[styles.off]: !plugin.enabled})}
                                    key={plugin.id}
                                >
                                    <label
                                        className={styles.switch}
                                        htmlFor={inputId}
                                        title={t('Load when the editor starts', '起動時に読み込む')}
                                    >
                                        <input
                                            checked={plugin.enabled}
                                            id={inputId}
                                            role="switch"
                                            type="checkbox"
                                            // eslint-disable-next-line react/jsx-no-bind
                                            onChange={() => onToggle(plugin.id, !plugin.enabled)}
                                        />
                                        <span className={styles.slider} />
                                    </label>
                                    <div className={styles.info}>
                                        <div className={styles.name}>
                                            <label htmlFor={inputId}>{plugin.name}</label>
                                            {plugin.scanLevel ? (
                                                <span
                                                    className={classNames(styles.level, levelClass(plugin.scanLevel))}
                                                >
                                                    {t(...LEVEL_TEXT[plugin.scanLevel])}
                                                </span>
                                            ) : null}
                                            {SIGNATURE_TEXT[plugin.signature] ? (
                                                <span
                                                    className={classNames(styles.signature, styles[`signature${
                                                        plugin.signature.charAt(0).toUpperCase()}${
                                                        plugin.signature.slice(1)}`])}
                                                >
                                                    {t(...SIGNATURE_TEXT[plugin.signature])}
                                                </span>
                                            ) : null}
                                            {plugin.pendingReload ? (
                                                <span className={styles.pending}>
                                                    {plugin.enabled ?
                                                        t('Loads after reload', '再読み込み後に読み込み') :
                                                        t('Unloads after reload', '再読み込み後に停止')}
                                                </span>
                                            ) : null}
                                        </div>
                                        {plugin.description ? (
                                            <div className={styles.description}>{plugin.description}</div>
                                        ) : null}
                                        <div className={styles.meta}>
                                            {[
                                                plugin.id,
                                                plugin.version ? `v${plugin.version}` : null,
                                                plugin.author,
                                                t(...(STATE_TEXT[plugin.state] || [plugin.state, plugin.state]))
                                            ].filter(Boolean).join(' · ')}
                                        </div>
                                        {plugin.dependencies.length ? (
                                            <div className={styles.meta}>
                                                {t('Requires: ', '必要なプラグイン: ')}
                                                {plugin.dependencies.join(', ')}
                                            </div>
                                        ) : null}
                                        {plugin.missingRecommendations.length ? (
                                            <div className={styles.meta}>
                                                {t('Works best with: ', '併用を推奨: ')}
                                                {plugin.missingRecommendations.join(', ')}
                                            </div>
                                        ) : null}
                                        {blockedBy.length ? (
                                            <div className={styles.error}>
                                                {blockedBy.some(id => installedIds.has(id)) ?
                                                    t(`Will not load: turn on ${blockedBy.join(', ')}.`,
                                                        `読み込まれません: ${blockedBy.join(', ')} をオンにしてください。`) :
                                                    t(`Will not load: install ${blockedBy.join(', ')}.`,
                                                        `読み込まれません: ${blockedBy.join(', ')} をインストールしてください。`)}
                                            </div>
                                        ) : null}
                                        {plugin.error ? <div className={styles.error}>{plugin.error}</div> : null}
                                    </div>
                                    <button
                                        className={styles.button}
                                        type="button"
                                        onClick={() => onRemove(plugin)} // eslint-disable-line react/jsx-no-bind
                                    >
                                        {t('Remove', '削除')}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className={styles.empty}>
                        <p>{t('No plugins are installed.', 'インストール済みのプラグインはありません。')}</p>
                        <p>
                            {t('Add one or more plugin .zip files at once.',
                                'プラグインの .zip は複数まとめて追加できます。')}
                        </p>
                    </div>
                )}

                {menuItems.length ? (
                    <React.Fragment>
                        <div className={styles.sectionTitle}>{t('Plugin commands', 'プラグインのコマンド')}</div>
                        <div className={styles.commands}>
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
            </div>
        </div>
    );
};

PluginsTab.propTypes = {
    locale: PropTypes.string.isRequired,
    menuItems: PropTypes.arrayOf(PropTypes.object).isRequired,
    missingPlugins: PropTypes.arrayOf(PropTypes.object).isRequired,
    onImport: PropTypes.func.isRequired,
    onReload: PropTypes.func.isRequired,
    onRemove: PropTypes.func.isRequired,
    onSetAll: PropTypes.func.isRequired,
    onToggle: PropTypes.func.isRequired,
    plugins: PropTypes.arrayOf(PropTypes.object).isRequired
};

export default PluginsTab;
