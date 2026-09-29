import React from 'react';
import CloseButton from '../close-button/close-button.jsx';
import styles from './tw-news.css';

const LOCAL_STORAGE_KEY = 'tw:closedNews';
const NEWS_ID = 'scratch-vulnerability';

const newsAppliesToUser = () => false;

const NewsBody = () => (
    <div
        className={styles.text}
        lang="en"
    >
        <div>
            {/* eslint-disable-next-line max-len */}
            {'We discovered a critical vulnerability in all versions of Scratch. In the desktop app, opening a malicious project could install ransomware on your computer.'}
        </div>
        <div>
            {/* eslint-disable-next-line max-len */}
            {'We reported this to Scratch two years ago, but no fix has been released yet. The latest TurboWarp is not affected. '}
            <a
                href="https://muffin.ink/blog/scratch-vulnerability-disclosure/"
                target="_blank"
                rel="noreferrer"
            >
                {'More details on my blog.'}
            </a>
        </div>
    </div>
);

const getIsClosedInLocalStorage = () => {
    try {
        return localStorage.getItem(LOCAL_STORAGE_KEY) === NEWS_ID;
    } catch (e) {
        return false;
    }
};

const markAsClosedInLocalStorage = () => {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, NEWS_ID);
    } catch (e) {
        // ignore
    }
};

class TWNews extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            closed: getIsClosedInLocalStorage() || !newsAppliesToUser()
        };
        this.handleClose = this.handleClose.bind(this);
    }
    handleClose () {
        markAsClosedInLocalStorage();
        this.setState({
            closed: true
        }, () => {
            window.dispatchEvent(new Event('resize'));
        });
    }
    render () {
        if (this.state.closed) {
            return null;
        }
        return (
            <div className={styles.news}>
                <NewsBody />
                <CloseButton
                    className={styles.close}
                    onClick={this.handleClose}
                />
            </div>
        );
    }
}

export default TWNews;
