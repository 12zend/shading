import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import Modal from '../../containers/modal.jsx';
import {localize} from '../../lib/movie-block-l10n';
import {
    CHROMIUM_URL_LIMIT,
    FIREFOX_URL_LIMIT,
    MAX_PATH_PAYLOAD_LENGTH
} from '../../lib/share-link/share-link-url';
import styles from './share-link-modal.css';

// A multi-megabyte link would make the text box sluggish; the full link is always what gets copied.
const MAX_DISPLAYED_CHARACTERS = 20000;

const formatBytes = bytes => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
};

const formatCount = count => count.toLocaleString();

const selectAll = event => event.target.select();

const ShareLinkModal = props => {
    const t = (en, ja) => localize(props.locale, en, ja);
    const {result, progress, status} = props;
    const url = result ? result.url : '';
    const percent = progress && progress.total ? Math.min(100, Math.round(progress.done / progress.total * 100)) : 0;
    return (
        <Modal
            className={styles.modalContent}
            contentLabel={t('Share link', '共有リンク')}
            id="shareLinkModal"
            onRequestClose={props.onClose}
        >
            <div className={styles.body}>
                <p>
                    {t('The whole project — code, costumes, sounds, videos, 3D models and fonts — is compressed ' +
                        'into the link itself. Anyone with the link can open a copy; nothing is uploaded.',
                    'コード、コスチューム、音、動画、3D モデル、フォントを含むプロジェクト全体をリンクそのものに圧縮して' +
                        '埋め込みます。リンクを知っている人は誰でもコピーを開けます。サーバーには何もアップロードされません。')}
                </p>

                {status === 'working' ? (
                    <React.Fragment>
                        <p>
                            {progress && progress.stage === 'compress' ?
                                t(`Compressing… ${percent}%`, `圧縮しています… ${percent}%`) :
                                t('Preparing…', '準備しています…')}
                        </p>
                        <div
                            className={styles.progress}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                        >
                            <div
                                className={styles.progressBar}
                                style={{width: `${percent}%`}}
                            />
                        </div>
                        <p className={styles.note}>
                            {t('Large sounds and videos can take a while to compress.',
                                '大きな音や動画があると、圧縮に時間がかかることがあります。')}
                        </p>
                    </React.Fragment>
                ) : null}

                {status === 'error' ? (
                    <div className={styles.error}>
                        {`${t('Could not create the link', 'リンクを作成できませんでした')}: ${props.error}`}
                    </div>
                ) : null}

                {status === 'done' && result ? (
                    <React.Fragment>
                        <textarea
                            className={styles.link}
                            readOnly
                            spellCheck={false}
                            value={url.length > MAX_DISPLAYED_CHARACTERS ?
                                `${url.slice(0, MAX_DISPLAYED_CHARACTERS)}…` :
                                url}
                            onFocus={selectAll}
                        />
                        <dl className={styles.stats}>
                            <dt>{t('Project size', 'プロジェクトの大きさ')}</dt>
                            <dd>
                                {`${formatBytes(result.originalBytes)} → ${formatBytes(result.encodedBytes)} ` +
                                    `(${Math.round(result.encodedBytes / Math.max(1, result.originalBytes) * 100)}%)`}
                            </dd>
                            <dt>{t('Link length', 'リンクの長さ')}</dt>
                            <dd>{t(`${formatCount(url.length)} characters`, `${formatCount(url.length)} 文字`)}</dd>
                            <dt>{t('Files', 'ファイル')}</dt>
                            <dd>{formatCount(result.fileCount)}</dd>
                        </dl>
                        {url.length > MAX_DISPLAYED_CHARACTERS ? (
                            <p className={styles.note}>
                                {t('Only the beginning of the link is shown. Copy or save it to get the whole link.',
                                    'リンクの先頭だけを表示しています。全体はコピーまたは保存で取得できます。')}
                            </p>
                        ) : null}
                        {result.payload.length > MAX_PATH_PAYLOAD_LENGTH ? (
                            <p className={styles.note}>
                                {t('Long links keep the project after "#", so it never has to be sent to a server.',
                                    '長いリンクでは、サーバーに送らずに済むよう、プロジェクトを「#」の後ろに入れています。')}
                            </p>
                        ) : null}
                        {url.length > CHROMIUM_URL_LIMIT ? (
                            <div className={styles.warning}>
                                {t('This link is too long for browsers to open directly. Send it as text or a ' +
                                    'file: it opens with File → Open share link….',
                                'このリンクはブラウザーで直接開くには長すぎます。テキストやファイルとして送ってください。' +
                                    '受け取った人は「ファイル」→「共有リンクから開く…」に貼り付けて開けます。')}
                            </div>
                        ) : (url.length > FIREFOX_URL_LIMIT ? (
                            <div className={styles.warning}>
                                {t('Firefox may not open links this long directly. If it does not, use ' +
                                    'File → Open share link….',
                                'Firefox ではこの長さのリンクを直接開けない場合があります。その場合は' +
                                    '「ファイル」→「共有リンクから開く…」に貼り付けて開いてください。')}
                            </div>
                        ) : null)}
                        {result.availablePlugins.length ? (
                            <label className={styles.option}>
                                <input
                                    type="checkbox"
                                    checked={props.includePlugins}
                                    onChange={props.onToggleIncludePlugins}
                                />
                                <span>
                                    {t('Include the plugins this project uses', 'このプロジェクトで使っているプラグインを含める')}
                                    {` (${result.availablePlugins.map(plugin => plugin.name).join(', ')})`}
                                    <br />
                                    <span className={styles.note}>
                                        {t('People who open the link can review and install them.',
                                            'リンクを開いた人が内容を確認してインストールできます。')}
                                    </span>
                                </span>
                            </label>
                        ) : null}
                    </React.Fragment>
                ) : null}

                <div className={styles.buttons}>
                    {status === 'done' && result && url.length > FIREFOX_URL_LIMIT ? (
                        <button
                            className={styles.button}
                            onClick={props.onSave}
                        >
                            {t('Save as text file', 'テキストファイルに保存')}
                        </button>
                    ) : null}
                    {status === 'done' && result && url.length <= CHROMIUM_URL_LIMIT ? (
                        <button
                            className={styles.button}
                            onClick={props.onOpen}
                        >
                            {t('Open in new tab', '新しいタブで開く')}
                        </button>
                    ) : null}
                    {status === 'error' ? (
                        <button
                            className={styles.button}
                            onClick={props.onRetry}
                        >
                            {t('Try again', 'もう一度試す')}
                        </button>
                    ) : null}
                    <button
                        className={classNames(styles.button, styles.primary)}
                        disabled={status !== 'done'}
                        onClick={props.onCopy}
                    >
                        {props.copied ? t('Copied!', 'コピーしました') : t('Copy link', 'リンクをコピー')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

ShareLinkModal.propTypes = {
    copied: PropTypes.bool,
    error: PropTypes.string,
    includePlugins: PropTypes.bool,
    locale: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    onCopy: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    onRetry: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    onToggleIncludePlugins: PropTypes.func.isRequired,
    progress: PropTypes.shape({
        stage: PropTypes.string,
        done: PropTypes.number,
        total: PropTypes.number
    }),
    result: PropTypes.shape({
        url: PropTypes.string,
        payload: PropTypes.string,
        originalBytes: PropTypes.number,
        encodedBytes: PropTypes.number,
        fileCount: PropTypes.number,
        availablePlugins: PropTypes.arrayOf(PropTypes.object)
    }),
    status: PropTypes.oneOf(['working', 'done', 'error']).isRequired
};

const OpenShareLinkModal = props => {
    const t = (en, ja) => localize(props.locale, en, ja);
    return (
        <Modal
            className={styles.modalContent}
            contentLabel={t('Open share link', '共有リンクから開く')}
            id="openShareLinkModal"
            onRequestClose={props.onClose}
        >
            <div className={styles.body}>
                <p>
                    {t('Paste a share link (or the text of a saved link file). The current project will be replaced.',
                        '共有リンク（または保存されたリンクファイルの中身）を貼り付けてください。今のプロジェクトは置き換えられます。')}
                </p>
                <textarea
                    className={styles.link}
                    autoFocus
                    spellCheck={false}
                    placeholder={`${typeof location === 'undefined' ? '' : location.origin}/p/…`}
                    value={props.text}
                    onChange={props.onChangeText}
                />
                {props.error ? <div className={styles.error}>{props.error}</div> : null}
                <div className={styles.buttons}>
                    <button
                        className={styles.button}
                        onClick={props.onChooseFile}
                    >
                        {t('Open link file…', 'リンクファイルを開く…')}
                    </button>
                    <button
                        className={classNames(styles.button, styles.primary)}
                        disabled={!props.text.trim()}
                        onClick={props.onOpen}
                    >
                        {t('Open', '開く')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

OpenShareLinkModal.propTypes = {
    error: PropTypes.string,
    locale: PropTypes.string.isRequired,
    onChangeText: PropTypes.func.isRequired,
    onChooseFile: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    text: PropTypes.string.isRequired
};

export {
    ShareLinkModal as default,
    OpenShareLinkModal
};
