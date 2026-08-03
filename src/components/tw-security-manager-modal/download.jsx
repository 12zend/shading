import React from 'react';
import PropTypes from 'prop-types';
import {FormattedMessage} from 'react-intl';
import styles from './download.css';

const FileName = props => {
    const MAX_NAME_LENGTH = 80;
    const MAX_EXTENSION_LENGTH = 30;

    const parts = props.name.split('.');
    let extension = parts.length > 1 ? parts.pop() : null;
    let name = parts.join('.');

    if (name.length > MAX_NAME_LENGTH) {
        name = `${name.substring(0, MAX_NAME_LENGTH)}[...]`;
    }
    if (extension && extension.length > MAX_EXTENSION_LENGTH) {
        extension = `[...]${extension.substring(extension.length - MAX_EXTENSION_LENGTH)}`;
    }

    if (extension === null) {
        return (
            <span className={styles.fileName}>
                {props.name}
            </span>
        );
    }

    return (
        <span className={styles.fileName}>
            <span className={styles.name}>
                {name}
            </span>
            <span className={styles.dot}>
                {'.'}
            </span>
            <span className={styles.extension}>
                {extension}
            </span>
        </span>
    );
};

FileName.propTypes = {
    name: PropTypes.string.isRequired
};

const DownloadModal = props => (
    <div>
        <p>
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="The project wants to download a file to your computer. It will be saved as {name} in your downloads folder."
                description="Part of modal when a project attempts to save a file to someone's downloads folder"
                id="tw.download.file"
                values={{
                    name: (
                        <FileName name={props.name} />
                    )
                }}
            />
        </p>

    </div>
);

DownloadModal.propTypes = {
    name: PropTypes.string.isRequired
};

export default DownloadModal;
