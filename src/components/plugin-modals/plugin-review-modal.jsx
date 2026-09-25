import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import Modal from '../../containers/modal.jsx';
import {localize} from '../../lib/movie-block-l10n';
import styles from './plugin-modals.css';

// Shown after plugin zips are chosen and before anything in them runs. Several zips are reviewed together and each
// can be left out. The scan cannot prove a plugin safe, so the dialog always states that plugins run with the
// editor's full privileges; high-risk findings require an explicit acknowledgement before the install button is
// enabled.

const LEVEL_TEXT = {
    none: ['No risky code found', '危険なコードは見つかりませんでした'],
    low: ['Low risk', '低リスク'],
    medium: ['Caution', '注意'],
    high: ['High risk', '高リスク']
};

const SIGNATURE_TEXT = {
    official: ['Official · signed', '公式・署名済み'],
    unsigned: ['Unofficial', '非公式'],
    invalid: ['Signature invalid', '署名が無効']
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

const signatureStatus = review => (review.signature ? review.signature.status : 'unsigned');

// A broken signature means files of a signed plugin were changed, so it counts as high risk.
const highestLevel = reviews => ['high', 'medium', 'low', 'none']
    .find(level => reviews.some(review => review.scan.level === level ||
        (level === 'high' && signatureStatus(review) === 'invalid'))) || 'none';

class PluginReviewModal extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            acknowledged: false,
            enabled: false,
            busy: false,
            selected: props.reviews.map(review => review.manifest.id)
        };
        this.handleAcknowledge = event => this.setState({acknowledged: event.target.checked});
        this.handleInstall = () => {
            this.setState({busy: true});
            this.props.onInstall(this.state.selected.slice());
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
    handleSelect (id, checked) {
        this.setState(state => ({
            selected: checked ?
                this.props.reviews.map(review => review.manifest.id)
                    .filter(candidate => candidate === id || state.selected.includes(candidate)) :
                state.selected.filter(candidate => candidate !== id)
        }));
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
    renderIdentity (review) {
        const {locale} = this.props;
        const {manifest, scan, archive, existing} = review;
        const localized = (manifest.locales && manifest.locales[locale]) || {};
        const signature = signatureStatus(review);
        return (
            <React.Fragment>
                <span className={styles.identityName}>
                    {localized.name || manifest.name}
                    {' '}
                    <span className={classNames(styles.level, levelClass(scan.level))}>
                        {this.t(...LEVEL_TEXT[scan.level])}
                    </span>
                    {' '}
                    <span
                        className={classNames(styles.signature,
                            styles[`signature${signature.charAt(0).toUpperCase()}${signature.slice(1)}`])}
                    >
                        {this.t(...SIGNATURE_TEXT[signature])}
                    </span>
                </span>
                {signature === 'invalid' ? (
                    <span className={styles.undeclared}>
                        {this.t('This plugin carries an official signature, but its files do not match it. ' +
                            'It may have been modified by someone else.',
                        'このプラグインには公式の署名が付いていますが、ファイルが署名と一致しません。' +
                            '第三者に改変されている可能性があります。')}
                    </span>
                ) : null}
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
            </React.Fragment>
        );
    }
    renderDetails (review) {
        const {manifest, scan} = review;
        const shown = scan.findings.slice(0, MAX_FINDINGS_SHOWN);
        return (
            <React.Fragment>
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
            </React.Fragment>
        );
    }
    renderReview (review) {
        const id = review.manifest.id;
        const checked = this.state.selected.includes(id);
        return (
            <li
                className={classNames(styles.reviewItem, {[styles.reviewItemOff]: !checked})}
                key={id}
            >
                <label className={styles.reviewSelect}>
                    <input
                        checked={checked}
                        type="checkbox"
                        // eslint-disable-next-line react/jsx-no-bind
                        onChange={event => this.handleSelect(id, event.target.checked)}
                    />
                    <span className={styles.identity}>{this.renderIdentity(review)}</span>
                </label>
                <details className={styles.reviewDetails}>
                    <summary>
                        {this.t('Permissions and security check', '権限とセキュリティ検査')}
                        {` (${this.t('high', '高')} ${review.scan.summary.high} · ${this.t('caution', '注意')} ` +
                            `${review.scan.summary.medium} · ${this.t('low', '低')} ${review.scan.summary.low})`}
                    </summary>
                    {this.renderDetails(review)}
                </details>
            </li>
        );
    }
    render () {
        const {reviews, errors} = this.props;
        const multiple = reviews.length > 1;
        const selectedReviews = reviews.filter(review => this.state.selected.includes(review.manifest.id));
        const high = highestLevel(selectedReviews) === 'high';
        const canInstall = this.state.enabled && !this.state.busy && selectedReviews.length > 0 &&
            (!high || this.state.acknowledged);
        return (
            <Modal
                className={styles.modalContent}
                contentLabel={multiple ?
                    this.t(`Install ${reviews.length} plugins`, `${reviews.length} 個のプラグインのインストール`) :
                    this.t('Install plugin', 'プラグインのインストール')}
                id="pluginReviewModal"
                onRequestClose={this.props.onCancel}
            >
                <div className={styles.body}>
                    {errors.length ? (
                        <div className={classNames(styles.warning, styles.warningHigh)}>
                            <strong>{this.t('These files could not be read and will be skipped:',
                                '次のファイルは読み込めなかったため除外します:')}</strong>
                            <ul>
                                {errors.map(error => (
                                    <li key={error.fileName}>{`${error.fileName}: ${error.message}`}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {multiple ? null : (
                        <div className={styles.identity}>{this.renderIdentity(reviews[0])}</div>
                    )}

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

                    {multiple ? (
                        <React.Fragment>
                            <div className={styles.sectionTitle}>
                                {this.t(`${selectedReviews.length} of ${reviews.length} plugins selected`,
                                    `${reviews.length} 個中 ${selectedReviews.length} 個を選択中`)}
                            </div>
                            <ul className={styles.reviewList}>
                                {reviews.map(review => this.renderReview(review))}
                            </ul>
                        </React.Fragment>
                    ) : this.renderDetails(reviews[0])}

                    {high ? (
                        <label className={styles.acknowledge}>
                            <input
                                checked={this.state.acknowledged}
                                type="checkbox"
                                onChange={this.handleAcknowledge}
                            />
                            {multiple ?
                                this.t('I understand the risks and trust the authors of the selected plugins.',
                                    'リスクを理解し、選択したプラグインの作者を信頼します。') :
                                this.t('I understand the risks and trust the author of this plugin.',
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
                            {multiple ?
                                this.t(`Install ${selectedReviews.length}`, `${selectedReviews.length} 個をインストール`) :
                                this.t('Install', 'インストール')}
                        </button>
                    </div>
                </div>
            </Modal>
        );
    }
}

PluginReviewModal.propTypes = {
    errors: PropTypes.arrayOf(PropTypes.shape({
        fileName: PropTypes.string,
        message: PropTypes.string
    })),
    locale: PropTypes.string.isRequired,
    onCancel: PropTypes.func.isRequired,
    onInstall: PropTypes.func.isRequired,
    reviews: PropTypes.arrayOf(PropTypes.shape({
        archive: PropTypes.object,
        existing: PropTypes.object,
        manifest: PropTypes.object,
        scan: PropTypes.object,
        signature: PropTypes.shape({
            status: PropTypes.oneOf(['official', 'unsigned', 'invalid']),
            reason: PropTypes.string
        })
    })).isRequired
};

PluginReviewModal.defaultProps = {
    errors: []
};

export default PluginReviewModal;
