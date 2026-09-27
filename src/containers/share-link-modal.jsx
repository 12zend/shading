import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import ShareLinkModalComponent from '../components/share-link-modal/share-link-modal.jsx';
import downloadBlob from '../lib/download-blob';
import log from '../lib/log';
import {closeShareLinkModal} from '../reducers/modals';

const COPIED_MS = 2000;

const copyText = text => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text);
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        if (!document.execCommand('copy')) throw new Error('Copy was refused.');
    } finally {
        document.body.removeChild(textarea);
    }
    return Promise.resolve();
};

const safeFileName = title => (String(title || 'project').replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'project').slice(0, 100);

class ShareLinkModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'generate',
            'handleCopy',
            'handleOpen',
            'handleRetry',
            'handleSave',
            'handleToggleIncludePlugins'
        ]);
        this.generation = 0;
        this.state = {
            copied: false,
            error: null,
            includePlugins: true,
            progress: null,
            result: null,
            status: 'working'
        };
    }
    componentDidMount () {
        this.generate(true);
    }
    componentWillUnmount () {
        this.unmounted = true;
        clearTimeout(this.copiedTimeout);
    }
    generate (includePlugins) {
        const generation = ++this.generation;
        const current = () => !this.unmounted && generation === this.generation;
        this.setState({copied: false, error: null, includePlugins, progress: null, status: 'working'});
        import(/* webpackChunkName: "share-link" */ '../lib/share-link/share-link')
            .then(shareLink => shareLink.createShareLink(this.props.vm, this.props.projectTitle, {
                includePlugins,
                onProgress: progress => {
                    if (current()) this.setState({progress});
                }
            }))
            .then(result => {
                if (current()) this.setState({result, status: 'done'});
            })
            .catch(error => {
                log.error('Could not create share link', error);
                if (current()) this.setState({error: (error && error.message) || String(error), status: 'error'});
            });
    }
    handleCopy () {
        copyText(this.state.result.url)
            .then(() => {
                if (this.unmounted) return;
                this.setState({copied: true});
                clearTimeout(this.copiedTimeout);
                this.copiedTimeout = setTimeout(() => this.setState({copied: false}), COPIED_MS);
            })
            .catch(error => {
                log.error('Could not copy share link', error);
                this.setState({error: error.message, status: 'error'});
            });
    }
    handleOpen () {
        window.open(this.state.result.url, '_blank', 'noopener');
    }
    handleSave () {
        downloadBlob(`${safeFileName(this.props.projectTitle)}.shade-link.txt`,
            new Blob([this.state.result.url], {type: 'text/plain'}));
    }
    handleRetry () {
        this.generate(this.state.includePlugins);
    }
    handleToggleIncludePlugins (event) {
        this.generate(event.target.checked);
    }
    render () {
        return (
            <ShareLinkModalComponent
                copied={this.state.copied}
                error={this.state.error}
                includePlugins={this.state.includePlugins}
                locale={this.props.locale}
                progress={this.state.progress}
                result={this.state.result}
                status={this.state.status}
                onClose={this.props.onClose}
                onCopy={this.handleCopy}
                onOpen={this.handleOpen}
                onRetry={this.handleRetry}
                onSave={this.handleSave}
                onToggleIncludePlugins={this.handleToggleIncludePlugins}
            />
        );
    }
}

ShareLinkModal.propTypes = {
    locale: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        saveProjectSb3DontZip: PropTypes.func
    }).isRequired
};

const mapStateToProps = state => ({
    locale: state.locales.locale,
    projectTitle: state.scratchGui.projectTitle,
    vm: state.scratchGui.vm
});

const ConnectedShareLinkModal = connect(
    mapStateToProps,
    dispatch => ({
        onClose: () => dispatch(closeShareLinkModal())
    })
)(ShareLinkModal);

export default ConnectedShareLinkModal;
