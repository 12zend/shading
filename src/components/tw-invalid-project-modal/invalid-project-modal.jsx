import {defineMessages, FormattedMessage, intlShape, injectIntl} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';
import Modal from '../../containers/modal.jsx';
import styles from './invalid-project-modal.css';
import {localize} from '../../lib/movie-block-l10n';

const messages = defineMessages({
    title: {
        defaultMessage: 'Error',
        description: 'Title of modal that appears when a project could not be loaded',
        id: 'tw.invalidProject.title'
    }
});

const formatError = error => {
    let message;
    if (error && error.stack) {
        message = `${error}\n\nStack:\n${error.stack}`;
    } else {
        message = `${error}`;
    }
    return `${message}\n\n---\n\nURL: ${location.href}\nUser-Agent: ${navigator.userAgent}`;
};

const errorMatches = (error, regex) => regex.test(`${error}`);

const isZipCorruptionWithSignatureIntact = error => (
    errorMatches(error, /Corrupted zip|uncompressed data size mismatch/)
);

const isJSONValidationError = error => errorMatches(error, /validationError/);

const unsupportedFormatMessage = (error, locale) => {
    if (!error || error.name !== 'UnsupportedProjectFormatError') return null;
    if (error.reason === 'newer-version') {
        return localize(locale,
            `This project was saved by a newer version of Shading (.shade format ${error.version}). ` +
            'Update the editor to open it.',
            `このプロジェクトは新しいバージョンの Shading で保存されています（.shade 形式 ${error.version}）。` +
            '開くにはエディターを更新してください。');
    }
    return localize(locale,
        'Only .shade project files can be opened. Scratch projects (.sb3, .sb2, .sb) and .mb3 files ' +
        'are no longer supported.',
        '開けるのは .shade プロジェクトファイルだけです。Scratch のプロジェクト（.sb3 / .sb2 / .sb）と .mb3 ファイルは' +
        '読み込めなくなりました。');
};

const InvalidProjectModal = props => (
    <Modal
        className={styles.modalContent}
        onRequestClose={props.onClose}
        contentLabel={props.intl.formatMessage(messages.title)}
        id="invalidProjectModal"
    >
        <div className={styles.body}>
            <p>
                <FormattedMessage
                    defaultMessage="Could not load project:"
                    // eslint-disable-next-line max-len
                    description="Part of modal that appears when a project could not be loaded. Followed by error message."
                    id="tw.invalidProject.error"
                />
            </p>

            <textarea
                className={styles.error}
                readOnly
                autoComplete="off"
                spellCheck={false}
                value={formatError(props.error)}
            />

            {unsupportedFormatMessage(props.error, props.intl.locale) ? (
                <p>{unsupportedFormatMessage(props.error, props.intl.locale)}</p>
            ) : isZipCorruptionWithSignatureIntact(props.error) ? (
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="This error often means that the file was corrupted, possibly due to a faulty storage device, power outage, or unplugging a USB drive without ejecting. Try {usingSb3fix} as it can fix this type of error."
                        // eslint-disable-next-line max-len
                        description="Part of modal that appears when a project could not be loaded. {usingSb3fix} becomes a link 'using sb3fix to recover your project'. sb3fix refers to https://turbowarp.github.io/sb3fix/"
                        id="tw.invalidProject.zipCorruption"
                        values={{
                            usingSb3fix: (
                                <a
                                    href="https://turbowarp.github.io/sb3fix/?platform=turbowarp"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <FormattedMessage
                                        defaultMessage="using sb3fix to recover your project"
                                        // eslint-disable-next-line max-len
                                        description="Part of modal that appears when a project could not be loaded. Used in context 'Try using sb3fix to recover your project as it can fix this type of error'. sb3fix referes to https://turbowarp.github.io/sb3fix/"
                                        id="tw.invalidProject.sb3fix"
                                    />
                                </a>
                            )
                        }}
                    />
                </p>
            ) : isJSONValidationError(props.error) ? (
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="This error often means that a small part of the project has been corrupted, but that it is otherwise valid. This can be easy to fix, so please {reportIt}."
                        // eslint-disable-next-line max-len
                        description="Part of modal that appears when a project could not be loaded. {reportIt} becomes a link 'report it'."
                        id="tw.invalidProject.validationError"
                        values={{
                            reportIt: (
                                <a
                                    href="https://github.com/TurboWarp/sb3fix/issues"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <FormattedMessage
                                        defaultMessage="report it"
                                        // eslint-disable-next-line max-len
                                        description="Part of modal that appears when a project could not be loaded. Used in context 'Please report this as this is ...'"
                                        id="tw.invalidProject.reportIt"
                                    />
                                </a>
                            )
                        }}
                    />
                </p>
            ) : null}

            <p>
                <FormattedMessage
                    // eslint-disable-next-line max-len
                    defaultMessage="You may be able to recover an older version of the project from automatic restore points or other backups."
                    description="Part of modal that appears when a project could not be loaded."
                    id="tw.invalidProject.options"
                />
            </p>

            <button
                className={styles.button}
                onClick={props.onClickRestorePoints}
            >
                <FormattedMessage
                    defaultMessage="View Restore Points"
                    // eslint-disable-next-line max-len
                    description="Part of modal that appears when a project could not be loaded. This is a button that opens the restore point menu."
                    id="tw.invalidProject.restorePoints"
                />
            </button>
        </div>
    </Modal>
);

InvalidProjectModal.propTypes = {
    intl: intlShape,
    onClose: PropTypes.func,
    onClickRestorePoints: PropTypes.func,
    error: PropTypes.any
};

export default injectIntl(InvalidProjectModal);
