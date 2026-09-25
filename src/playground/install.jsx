import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import render from './app-target';
import {APP_NAME} from '../lib/brand';
import {applyGuiColors} from '../lib/themes/guiHelpers';
import {detectTheme} from '../lib/themes/themePersistance';
import {IndexedDBPluginStorage} from '../lib/plugins/storage';
import {prepareOfficialPlugins, saveOfficialPlugins} from '../lib/plugins/official-installer';
import styles from './install.css';

// Use the same theme (light/dark + accent) as the editor.
applyGuiColors(detectTheme());
document.documentElement.lang = 'ja';

const LEVEL_TEXT = {none: '検出なし', low: '低リスク', medium: '注意', high: '高リスク'};
const levelClass = level => styles[`level${level.charAt(0).toUpperCase()}${level.slice(1)}`];

const PluginItem = ({archive, scan}) => {
    const {manifest} = archive;
    const localized = (manifest.locales && manifest.locales.ja) || {};
    return (
        <li>
            <details className={styles.plugin}>
                <summary>
                    <span className={styles.pluginName}>
                        {localized.name || manifest.name}
                        <span className={classNames(styles.level, levelClass(scan.level))}>
                            {LEVEL_TEXT[scan.level]}
                        </span>
                    </span>
                    <span className={styles.pluginMeta}>
                        {`id: ${manifest.id} · v${manifest.version}${manifest.author ? ` · ${manifest.author}` : ''}` +
                            ' · 公式の署名を確認済み'}
                    </span>
                </summary>
                <div className={styles.pluginDetails}>
                    {localized.description || manifest.description ? (
                        <p>{localized.description || manifest.description}</p>
                    ) : null}
                    {scan.findings.length ? scan.findings.map((finding, index) => (
                        <div
                            className={styles.finding}
                            key={`${finding.rule}:${finding.file}:${index}`}
                        >
                            <span className={classNames(styles.level, levelClass(finding.severity))}>
                                {LEVEL_TEXT[finding.severity]}
                            </span>
                            {' '}
                            {finding.ja || finding.en}
                            <div className={styles.findingFile}>{finding.file}</div>
                            {finding.occurrences.slice(0, 5).map((occurrence, occurrenceIndex) => (
                                <pre
                                    className={styles.snippet}
                                    key={occurrenceIndex}
                                >
                                    {`${occurrence.line}: ${occurrence.snippet || ''}`}
                                </pre>
                            ))}
                        </div>
                    )) : <p className={styles.hint}>{'危険なパターンは見つかりませんでした。'}</p>}
                </div>
            </details>
        </li>
    );
};

PluginItem.propTypes = {
    archive: PropTypes.object.isRequired,
    scan: PropTypes.object.isRequired
};

class Installer extends React.Component {
    state = {reviews: [], status: '公式プラグインを取得中…', busy: true, trusted: false, done: false, error: ''};
    componentDidMount () {
        this.handlePrepare();
    }
    handlePrepare = async () => {
        this.setState({busy: true, error: '', reviews: [], trusted: false, status: '公式プラグインを取得中…'});
        try {
            if (!new IndexedDBPluginStorage().available) throw new Error('このブラウザでは保存できません。');
            const reviews = await prepareOfficialPlugins(window.fetch.bind(window), status => this.setState({status}));
            this.setState({reviews, status: `${reviews.length} 件のプラグインを保存できます。`, busy: false});
        } catch (error) {
            this.setState({error: error.message, status: '', busy: false});
        }
    };
    handleInstall = async () => {
        this.setState({busy: true, error: '', status: 'ブラウザに保存中…'});
        try {
            await saveOfficialPlugins(new IndexedDBPluginStorage(), this.state.reviews);
            this.setState({done: true, busy: false, status: 'すべて保存しました。エディターで利用できます。'});
        } catch (error) {
            this.setState({busy: false, error: `保存できませんでした：${error.message}`, status: ''});
        }
    };
    handleTrust = event => this.setState({trusted: event.target.checked});
    render () {
        const {reviews, status, busy, trusted, done, error} = this.state;
        return (
            <div className={styles.page}>
                <nav className={styles.menuBar}>
                    <a
                        className={classNames(styles.menuBarItem, styles.brand)}
                        href="/"
                    >
                        {APP_NAME}
                    </a>
                    <span className={styles.spacer} />
                    <a
                        className={styles.menuBarItem}
                        href="/"
                    >
                        {'エディターを開く'}
                    </a>
                </nav>
                <main className={styles.content}>
                    <section className={styles.panel}>
                        <header className={styles.panelHeader}>
                            <h1>{'公式プラグインを一括インストール'}</h1>
                        </header>
                        <div className={styles.body}>
                            <p>
                                <a href="https://github.com/12zend/shading-plugins">{'shading-plugins'}</a>
                                {' の全プラグインをこのブラウザに保存します。次回から自動的に読み込まれます。'}
                                {'同じIDのプラグインは更新・有効化されます。'}
                            </p>
                            {status && (
                                <div
                                    className={styles.status}
                                    role="status"
                                >
                                    {busy && <span className={styles.spinner} />}
                                    {done && <span className={styles.doneMark}>{'✓'}</span>}
                                    {status}
                                </div>
                            )}
                            {error && (
                                <div
                                    className={styles.error}
                                    role="alert"
                                >
                                    {error}
                                </div>
                            )}
                            {reviews.length > 0 && !done && (
                                <React.Fragment>
                                    <div className={styles.sectionTitle}>{'インストールされるプラグイン'}</div>
                                    <ul className={styles.pluginList}>
                                        {reviews.map(review => (
                                            <PluginItem
                                                key={review.archive.manifest.id}
                                                {...review}
                                            />
                                        ))}
                                    </ul>
                                    <div className={styles.warning}>
                                        <p>
                                            <strong>{'プラグインはエディターと同じ権限で動作します。'}</strong>
                                        </p>
                                        <p>{'静的検査は危険なコードのパターンを探すもので、安全を保証するものではありません。'}</p>
                                    </div>
                                    <label className={styles.acknowledge}>
                                        <input
                                            checked={trusted}
                                            disabled={busy}
                                            type="checkbox"
                                            onChange={this.handleTrust}
                                        />
                                        {'リスクを理解し、公式プラグインの作者を信頼します'}
                                    </label>
                                </React.Fragment>
                            )}
                            <div className={styles.buttons}>
                                {error && !reviews.length && (
                                    <button
                                        className={styles.button}
                                        disabled={busy}
                                        onClick={this.handlePrepare}
                                    >
                                        {'再試行'}
                                    </button>
                                )}
                                {reviews.length > 0 && !done && (
                                    <button
                                        className={classNames(styles.button, styles.primary)}
                                        disabled={busy || !trusted}
                                        onClick={this.handleInstall}
                                    >
                                        {busy ? '保存中…' : `${reviews.length} 件すべてを保存`}
                                    </button>
                                )}
                                {done && (
                                    <React.Fragment>
                                        <span className={styles.hint}>{'開いているエディターは再読み込みしてください。'}</span>
                                        <a
                                            className={classNames(styles.button, styles.primary)}
                                            href="/"
                                        >
                                            {'エディターを開く'}
                                        </a>
                                    </React.Fragment>
                                )}
                            </div>
                        </div>
                    </section>
                </main>
            </div>
        );
    }
}

render(<Installer />);
