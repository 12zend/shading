import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import Modal from '../../containers/modal.jsx';
import {localize} from '../../lib/movie-block-l10n';
import styles from './plugin-modals.css';

// Shown after a plugin zip is chosen and before anything in it runs. The scan cannot prove a plugin safe, so the
// dialog always states that plugins run with the editor's full privileges; high-risk findings require an explicit
// acknowledgement before the install button is enabled.

const LEVEL_TEXT = {
    none: ['No risky code found', '危険なコードは見つかりませんでした'],
    low: ['Low risk', '低リスク'],
    medium: ['Caution', '注意'],
    high: ['High risk', '高リスク']
};

const PERMISSION_TEXT = {
    'network': ['Network', 'ネットワーク通信'],
    'storage': ['Browser storage', 'ブラウザ保存領域'],
    'dynamic-code': ['Runs generated code', '生成コードの実行'],
    'wasm': ['WebAssembly', 'WebAssembly'],
    'workers': ['Background workers', 'バックグラウンド処理'],
    'dom': ['Page contents', 'ページの内容の変更'],
    'navigation': ['Opens pages', '別ページを開く'],
    'clipboard': ['Clipboard', 'クリップボード'],
    'media': ['Camera / microphone / location', 'カメラ・マイク・位置情報'],
    'desktop': ['Desktop app features', 'デスクトップアプリの機能']
};

const formatBytes = bytes => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
};

const MAX_FINDINGS_SHOWN = 60;

const levelClass = level => styles[`level${level.charAt(0).toUpperCase()}${level.slice(1)}`];

class PluginReviewModal extends React.Component {
    constructor (props) {
        super(props);
        this.state = {acknowledged: false, enabled: false, busy: false};
        this.handleAcknowledge = event => this.setState({acknowledged: event.target.checked});
        this.handleInstall = () => {
            this.setState({busy: true});
            this.props.onInstall();
        };
    }
    componentDidMount () {
        // Keep an accidental double click on the file dialog from confirming the install.
        this.timeout = setTimeout(() => this.setState({enabled: true}), 750);
    }
    componentWillUnmount () {
        clearTimeout(this.timeout);
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    renderFinding (finding) {
        const message = this.props.locale === 'ja' ? finding.ja : finding.en;
        return (
            <li
                className={styles.finding}
                key={`${finding.rule}:${finding.file}`}
            >
                <details>
                    <summary>
                        <span className={classNames(styles.level, levelClass(finding.severity))}>
                            {this.t(...LEVEL_TEXT[finding.severity])}
                        </span>
                        {' '}
                        {message}
                        {finding.permission && !finding.declared ? (
                            <span className={styles.undeclared}>
                                {this.t('not declared in the manifest', 'マニフェストで未申告')}
                            </span>
                        ) : null}
                        <div className={styles.findingFile}>
                            {`${finding.file}${finding.occurrences.length ? `:${finding.occurrences[0].line}` : ''}${
                                finding.count > 1 ? ` (${finding.count}×)` : ''}`}
                        </div>
                    </summary>
                    {finding.occurrences.slice(0, 5).map(occurrence => (
                        <pre
                            className={styles.snippet}
                            key={`${occurrence.line}:${occurrence.column}`}
                        >
                            {`${occurrence.line}: ${occurrence.snippet}`}
                        </pre>
                    ))}
                </details>
            </li>
        );
    }
    render () {
        const {review, locale} = this.props;
        const {manifest, scan, archive, existing} = review;
        const localized = (manifest.locales && manifest.locales[locale]) || {};
        const high = scan.level === 'high';
        const canInstall = this.state.enabled && !this.state.busy && (!high || this.state.acknowledged);
        const shown = scan.findings.slice(0, MAX_FINDINGS_SHOWN);
        return (
            <Modal
                className={styles.modalContent}
                contentLabel={this.t('Install plugin', 'プラグインのインストール')}
                id="pluginReviewModal"
                onRequestClose={this.props.onCancel}
            >
                <div className={styles.body}>
                    <div className={styles.identity}>
                        <span className={styles.identityName}>
                            {localized.name || manifest.name}
                            {' '}
                            <span className={classNames(styles.level, levelClass(scan.level))}>
                                {this.t(...LEVEL_TEXT[scan.level])}
                            </span>
                        </span>
                        {localized.description || manifest.description ? (
                            <span>{localized.description || manifest.description}</span>
                        ) : null}
                        <span className={styles.identityMeta}>
                            {`id: ${manifest.id} · v${manifest.version}${
                                manifest.author ? ` · ${manifest.author}` : ''
                            } · ${archive.files.size} ${this.t('files', 'ファイル')} · ${formatBytes(archive.size)}`}
                        </span>
                        <span className={styles.identityMeta}>{`${archive.fileName} · ${archive.hash}`}</span>
                        {existing ? (
                            <span className={styles.identityMeta}>
                                {existing.sameArchive ?
                                    this.t('This exact plugin is already installed; it will be reinstalled.',
                                        'このプラグインはインストール済みです。再インストールします。') :
                                    this.t(`Replaces the installed version ${existing.version}.`,
                                        `インストール済みのバージョン ${existing.version} を置き換えます。`)}
                            </span>
                        ) : null}
                    </div>

                    <div className={classNames(styles.warning, {[styles.warningHigh]: high})}>
                        <p>
                            <strong>
                                {this.t('Plugins run code with the same access as the editor.',
                                    'プラグインはエディターと同じ権限でコードを実行します。')}
                            </strong>
                        </p>
                        <p>
                            {this.t(
                                'A plugin can read and change your projects, and anything the editor can reach. ' +
                                'Only install plugins from people you trust. You are responsible for the plugins ' +
                                'you install.',
                                'プラグインはプロジェクトの内容や、エディターが扱えるすべてのものを読み書きできます。' +
                                '信頼できる配布元のプラグインだけをインストールしてください。' +
                                'インストールしたプラグインの利用は自己責任となります。'
                            )}
                        </p>
                        <p>
                            {this.t(
                                'The check below looks for risky code patterns. It is not a guarantee: ' +
                                'disguised code can pass it.',
                                '下の検査は危険なコードのパターンを探すもので、安全を保証するものではありません。' +
                                '偽装されたコードは検出できない場合があります。'
                            )}
                        </p>
                    </div>

                    <div className={styles.sectionTitle}>{this.t('Declared permissions', '申告された権限')}</div>
                    <p>
                        {manifest.permissions.length ? manifest.permissions
                            .map(permission => this.t(...(PERMISSION_TEXT[permission] || [permission, permission])))
                            .join(' · ') : this.t('None', 'なし')}
                    </p>
                    {scan.undeclaredPermissions.length ? (
                        <p className={styles.undeclared}>
                            {this.t('Uses capabilities it does not declare: ', '申告していない機能を使用しています: ')}
                            {scan.undeclaredPermissions
                                .map(permission => this.t(...(PERMISSION_TEXT[permission] || [permission, permission])))
                                .join(', ')}
                        </p>
                    ) : null}

                    <div className={styles.sectionTitle}>
                        {this.t('Security check', 'セキュリティ検査')}
                        {` — ${this.t('high', '高')} ${scan.summary.high} · ${this.t('caution', '注意')} ` +
                            `${scan.summary.medium} · ${this.t('low', '低')} ${scan.summary.low}`}
                    </div>
                    {shown.length ? (
                        <ul className={styles.findings}>{shown.map(finding => this.renderFinding(finding))}</ul>
                    ) : (
                        <p className={styles.empty}>
                            {this.t('No risky patterns were found.', '危険なパターンは見つかりませんでした。')}
                        </p>
                    )}
                    {scan.findings.length > shown.length ? (
                        <p className={styles.empty}>
                            {this.t(`…and ${scan.findings.length - shown.length} more.`,
                                `…ほか${scan.findings.length - shown.length}件。`)}
                        </p>
                    ) : null}

                    {high ? (
                        <label className={styles.acknowledge}>
                            <input
                                checked={this.state.acknowledged}
                                type="checkbox"
                                onChange={this.handleAcknowledge}
                            />
                            {this.t('I understand the risks and trust the author of this plugin.',
                                'リスクを理解し、このプラグインの作者を信頼します。')}
                        </label>
                    ) : null}

                    <div className={styles.buttons}>
                        <button
                            className={styles.button}
                            type="button"
                            onClick={this.props.onCancel}
                        >
                            {this.t('Cancel', 'キャンセル')}
                        </button>
                        <button
                            className={classNames(styles.button, high ? styles.danger : styles.primary)}
                            disabled={!canInstall}
                            type="button"
                            onClick={this.handleInstall}
                        >
                            {this.t('Install', 'インストール')}
                        </button>
                    </div>
                </div>
            </Modal>
        );
    }
}

PluginReviewModal.propTypes = {
    locale: PropTypes.string.isRequired,
    onCancel: PropTypes.func.isRequired,
    onInstall: PropTypes.func.isRequired,
    review: PropTypes.shape({
        archive: PropTypes.object,
        existing: PropTypes.object,
        manifest: PropTypes.object,
        scan: PropTypes.object
    }).isRequired
};

export default PluginReviewModal;
