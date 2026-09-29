import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {OpenShareLinkModal as OpenShareLinkModalComponent} from '../components/share-link-modal/share-link-modal.jsx';
import {localize} from '../lib/movie-block-l10n';
import {extractSharePayload, setPendingSharePayload} from '../lib/share-link/share-link-url';
import {closeFileMenu} from '../reducers/menus';
import {closeOpenShareLinkModal} from '../reducers/modals';
import {requestNewProject} from '../reducers/project-state';

class OpenShareLinkModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChangeText',
            'handleChooseFile',
            'handleOpen'
        ]);
        this.state = {error: null, text: ''};
    }
    t (en, ja) {
        return localize(this.props.locale, en, ja);
    }
    open (text) {
        const payload = extractSharePayload(text);
        if (!payload) {
            this.setState({error: this.t('This is not a share link.', '共有リンクが見つかりません。')});
            return;
        }
        // eslint-disable-next-line no-alert
        if (this.props.projectChanged && !confirm(this.t(
            'Replace contents of the current project?',
            '現在のプロジェクトの内容を置き換えますか？'
        ))) {
            return;
        }
        // The project fetcher picks the payload up when the new project is requested.
        setPendingSharePayload(payload);
        this.props.onClose();
        this.props.onRequestNewProject();
    }
    handleChangeText (event) {
        this.setState({error: null, text: event.target.value});
    }
    handleChooseFile () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,text/plain';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            file.text()
                .then(text => this.open(text))
                .catch(error => this.setState({error: error.message}));
        }, {once: true});
        input.click();
    }
    handleOpen () {
        this.open(this.state.text);
    }
    render () {
        return (
            <OpenShareLinkModalComponent
                error={this.state.error}
                locale={this.props.locale}
                text={this.state.text}
                onChangeText={this.handleChangeText}
                onChooseFile={this.handleChooseFile}
                onClose={this.props.onClose}
                onOpen={this.handleOpen}
            />
        );
    }
}

OpenShareLinkModal.propTypes = {
    locale: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    onRequestNewProject: PropTypes.func.isRequired,
    projectChanged: PropTypes.bool
};

const mapStateToProps = state => ({
    locale: state.locales.locale,
    projectChanged: state.scratchGui.projectChanged
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeOpenShareLinkModal()),
    onRequestNewProject: () => {
        dispatch(closeFileMenu());
        dispatch(requestNewProject(false));
    }
});

export default connect(mapStateToProps, mapDispatchToProps)(OpenShareLinkModal);
