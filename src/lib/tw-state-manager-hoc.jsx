import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import log from './log';
import {intlShape, injectIntl} from 'react-intl';

import {
    setUsername
} from '../reducers/tw';
import {
    defaultProjectId,
    setProjectId
} from '../reducers/project-state';
import {
    setPlayer,
    setFullScreen
} from '../reducers/mode';
import {generateRandomUsername} from './tw-username';
import {setSearchParams} from './tw-navigation-utils';
import {isSharePath} from './share-link/share-link-url';

/* eslint-disable no-alert */

const USERNAME_KEY = 'tw:username';

/**
 * URL parameters that used to carry Advanced Settings. These settings are now stored in the
 * project file, so they are ignored and removed from links.
 */
const LEGACY_SETTINGS_PARAMS = [
    'hqpen',
    'fps',
    '60fps',
    'interpolate',
    'stuck',
    'warp_timer',
    'nocompile',
    'clones',
    'offscreen',
    'limitless',
    'size'
];

/**
 * The State Manager is responsible for managing persistent state and the URL.
 */

const setLocalStorage = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        // ignore
    }
};

const getLocalStorage = key => {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        // ignore
    }
    return null;
};

const readHashProjectId = () => {
    const match = location.hash.match(/#(\d+)/);
    return match === null ? null : match[1];
};

class Router {
    constructor ({onSetProjectId, onSetIsPlayerOnly, onSetIsFullScreen}) {
        this.onSetProjectId = onSetProjectId;
        this.onSetIsPlayerOnly = onSetIsPlayerOnly;
        this.onSetIsFullScreen = onSetIsFullScreen;
    }

    onhashchange () {

    }

    onpathchange () {

    }

    generateURL () {
        return '';
    }
}

class HashRouter extends Router {
    onhashchange () {
        this.onSetProjectId(readHashProjectId() || defaultProjectId);
    }

    generateURL ({projectId}) {
        const hashQuery = location.hash.split('?')[1];
        return `${location.pathname}${location.search}#${projectId}${hashQuery ? `?${hashQuery}` : ''}`;
    }
}

class FileHashRouter extends HashRouter {
    constructor (callbacks) {
        super(callbacks);
        this.rootPath = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
        this.editorPath = this.rootPath;
        this.editorFilePath = `${this.rootPath}index.html`;
        this.legacyEditorPath = `${this.rootPath}editor.html`;
        this.playerPath = `${this.rootPath}player.html`;
        this.fullscreenPath = `${this.rootPath}fullscreen.html`;
    }

    onpathchange () {
        const pathName = location.pathname;

        if (pathName === this.playerPath) {
            this.onSetIsPlayerOnly(true);
            this.onSetIsFullScreen(false);
        } else if (
            pathName === this.editorPath ||
            pathName === this.editorFilePath ||
            pathName === this.legacyEditorPath
        ) {
            this.onSetIsPlayerOnly(false);
            this.onSetIsFullScreen(false);
        } else if (pathName === this.fullscreenPath) {
            this.onSetIsFullScreen(true);
        }
    }

    generateURL ({projectId, isPlayerOnly, isFullScreen}) {
        let newPathname = '';
        let newHash = '';

        if (projectId !== '0') {
            newHash = projectId;
        }
        const hashQuery = location.hash.split('?')[1];
        if (hashQuery) {
            newHash += `?${hashQuery}`;
        }

        if (isFullScreen) {
            newPathname = this.fullscreenPath;
        } else if (isPlayerOnly) {
            newPathname = this.playerPath;
        } else {
            newPathname = this.editorPath;
        }

        return `${newPathname}${location.search}${newHash ? `#${newHash}` : ''}`;
    }
}

const getCanonicalLinkElement = () => {
    let el = document.querySelector('link[rel=canonical]');
    if (!el) {
        el = document.createElement('link');
        el.rel = 'canonical';
        document.head.appendChild(el);
    }
    return el;
};

class WildcardRouter extends Router {
    constructor (callbacks) {
        super(callbacks);
        this.root = process.env.ROOT;
    }

    onhashchange () {
        const hashProjectId = readHashProjectId();
        if (hashProjectId) {
            const ok = this.onSetProjectId(hashProjectId);
            if (ok) {
                // Completely remove the hash
                history.replaceState(null, null, `${location.pathname}${location.search}`);
            }
        } else {
            // Do not detect page type here as it is already set up by index.html, player.html, etc.
            this.parseURL(false);
        }
    }

    onpathchange () {
        this.parseURL(true);
    }

    parseURL (detectPageType) {
        const path = location.pathname.substr(this.root.length);
        const parts = path.split('/');

        const parseProjectId = id => {
            if (id) {
                this.onSetProjectId(id);
            } else {
                this.onSetProjectId(defaultProjectId);
            }
        };

        const parsePageType = type => {
            if (!detectPageType) {
                return;
            }
            if (type === 'fullscreen') {
                this.onSetIsFullScreen(true);
            } else if (type === 'player') {
                this.onSetIsPlayerOnly(true);
                this.onSetIsFullScreen(false);
            } else {
                this.onSetIsPlayerOnly(false);
                this.onSetIsFullScreen(false);
            }
        };

        if (+parts[0] && Number.isFinite(+parts[0])) {
            parseProjectId(parts[0]);
            parsePageType(parts[1]);
        } else {
            this.onSetProjectId(defaultProjectId);
            parsePageType(parts[0]);
        }
    }

    generateURL ({projectId, isPlayerOnly, isFullScreen}) {
        const parts = [];

        if (projectId !== '0') {
            parts.push(projectId);
        }
        if (isFullScreen) {
            parts.push('fullscreen');
        } else if (isPlayerOnly) {
            parts.push('player');
        }

        const path = `${this.root}${parts.join('/')}`;
        const canonical = `${location.origin}${this.root}${projectId === '0' ? '' : projectId}`;
        getCanonicalLinkElement().href = canonical;

        return `${path}${location.search}${location.hash}`;
    }
}

class PathRouter extends Router {
    onhashchange () {
        this.onSetProjectId(defaultProjectId);
        this.parsePageType();
    }

    onpathchange () {
        this.onSetProjectId(defaultProjectId);
        this.parsePageType();
    }

    parsePageType () {
        const parts = location.pathname.split('/').filter(Boolean);
        const pageType = parts[parts.length - 1];
        if (pageType === 'fullscreen') {
            this.onSetIsFullScreen(true);
            this.onSetIsPlayerOnly(false);
        } else if (pageType === 'player') {
            this.onSetIsPlayerOnly(true);
            this.onSetIsFullScreen(false);
        } else {
            this.onSetIsPlayerOnly(false);
            this.onSetIsFullScreen(false);
        }
    }

    generateURL ({isPlayerOnly, isFullScreen}) {
        if (!isPlayerOnly && !isFullScreen && isSharePath()) {
            // Keep a share link in the address bar so it can be reloaded or copied again.
            return `${location.pathname}${location.search}${location.hash}`;
        }
        const prefix = process.env.ROOT && process.env.ROOT !== '/' ?
            `/${process.env.ROOT.replace(/^\/+|\/+$/g, '')}` : '';
        let path = prefix || '/';
        if (isFullScreen) path += '/fullscreen';
        else if (isPlayerOnly) path += '/player';
        return `${path.replace(/^\/\//, '/')}${location.search}${location.hash}`;
    }
}

const routers = {
    none: Router,
    hash: HashRouter,
    filehash: FileHashRouter,
    wildcard: WildcardRouter,
    path: PathRouter
};

/**
 * Return the optimal Router for the current environment
 * @param {string} style Routing style name
 * @param {*} callbacks Redux callbacks
 * @returns {Router} The optimal router for the current environment
 */
const createRouter = (style, callbacks) => {
    const supportedStyles = ['none', 'hash', 'path'];

    // FileHashRouter is not supported on non-http(s) protocols.
    const isHTTP = location.protocol === 'http:' || location.protocol === 'https:';
    if (isHTTP) {
        supportedStyles.push('filehash');
    }

    // WildcardRouter is not supported if ROOT is not set.
    if (process.env.ROOT) {
        supportedStyles.push('wildcard');
    }

    if (!supportedStyles.includes(style)) {
        log.warn(`routing style is unknown or not supported: ${style}, falling back to hash`);
        style = 'hash';
    }

    if (Object.prototype.hasOwnProperty.call(routers, style)) {
        return new routers[style](callbacks);
    }

    throw new Error(`unknown router: ${style}`);
};

const TWStateManager = function (WrappedComponent) {
    class StateManagerComponent extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'handleHashChange',
                'handlePopState',
                'onSetProjectId',
                'onSetIsPlayerOnly',
                'onSetIsFullScreen'
            ]);
        }
        componentDidMount () {
            const urlParams = new URLSearchParams(location.search);

            if (urlParams.has('username')) {
                const username = urlParams.get('username');
                // Do not save username when loaded from URL
                this.doNotPersistUsername = username;
                this.props.onSetUsername(username);
            } else {
                const persistentUsername = this.props.isEmbedded ? null : getLocalStorage(USERNAME_KEY);
                if (persistentUsername === null) {
                    const randomUsername = generateRandomUsername();
                    this.props.onSetUsername(randomUsername);
                    if (this.props.isEmbedded) {
                        this.doNotPersistUsername = randomUsername;
                    }
                } else {
                    this.props.onSetUsername(persistentUsername);
                }
            }

            // High quality pen rendering is always enabled in Shading.
            this.props.vm.renderer.setUseHighQualityRender(true);

            // Advanced Settings live in the project file. Remove them from links while
            // retaining all other URL options.
            if (LEGACY_SETTINGS_PARAMS.some(param => urlParams.has(param))) {
                for (const param of LEGACY_SETTINGS_PARAMS) {
                    urlParams.delete(param);
                }
                setSearchParams(urlParams);
            }

            if (urlParams.has('turbo')) {
                this.props.vm.setTurboMode(true);
            }

            for (const extension of urlParams.getAll('extension')) {
                this.props.vm.extensionManager.loadExtensionURL(extension);
            }

            const routerCallbacks = {
                onSetProjectId: this.onSetProjectId,
                onSetIsPlayerOnly: this.onSetIsPlayerOnly,
                onSetIsFullScreen: this.onSetIsFullScreen
            };
            this.router = createRouter(this.props.routingStyle, routerCallbacks);
            this.router.onhashchange();
            window.addEventListener('hashchange', this.handleHashChange);
            window.addEventListener('popstate', this.handlePopState);
        }
        componentDidUpdate (prevProps) {
            if (this.props.username !== prevProps.username && this.props.username !== this.doNotPersistUsername) {
                // TODO: this always restores the current username once at startup, which is unnecessary
                setLocalStorage(USERNAME_KEY, this.props.username);
            }

            if (
                this.props.reduxProjectId !== prevProps.reduxProjectId ||
                this.props.isPlayerOnly !== prevProps.isPlayerOnly ||
                this.props.isFullScreen !== prevProps.isFullScreen
            ) {
                const oldPath = `${location.pathname}${location.search}${location.hash}`;
                const routerState = {
                    projectId: this.props.reduxProjectId,
                    isPlayerOnly: this.props.isPlayerOnly,
                    isFullScreen: this.props.isFullScreen
                };
                const newPath = this.router.generateURL(routerState);
                if (newPath && newPath !== oldPath) {
                    history.pushState(null, null, newPath);
                }
            }

            if (this.props.turbo !== prevProps.turbo) {
                const searchParams = new URLSearchParams(location.search);
                if (this.props.turbo) {
                    searchParams.set('turbo', '');
                } else {
                    searchParams.delete('turbo');
                }
                setSearchParams(searchParams);
            }
        }
        componentWillUnmount () {
            window.removeEventListener('hashchange', this.handleHashChange);
            window.removeEventListener('popstate', this.handlePopState);
        }
        handleHashChange () {
            this.router.onhashchange();
        }
        handlePopState () {
            this.router.onpathchange();
        }
        onSetProjectId (id) {
            if (`${id}` === `${this.props.reduxProjectId}`) {
                return true;
            }
            if (this.props.projectChanged) {
                if (!confirm('Are you sure you want to switch project?')) {
                    return false;
                }
            }
            this.props.onSetProjectId(id);
            return true;
        }
        onSetIsPlayerOnly (isPlayerOnly) {
            this.props.onSetIsPlayerOnly(isPlayerOnly);
        }
        onSetIsFullScreen (isFullScreen) {
            this.props.onSetIsFullScreen(isFullScreen);
        }
        render () {
            const {
                /* eslint-disable no-unused-vars */
                intl,
                isFullScreen,
                isPlayerOnly,
                isEmbedded,
                projectChanged,
                turbo,
                onSetIsFullScreen,
                onSetIsPlayerOnly,
                onSetProjectId,
                onSetUsername,
                reduxProjectId,
                routingStyle,
                username,
                vm,
                /* eslint-enable no-unused-vars */
                ...props
            } = this.props;
            return (
                <WrappedComponent
                    {...props}
                />
            );
        }
    }
    StateManagerComponent.propTypes = {
        intl: intlShape,
        isFullScreen: PropTypes.bool,
        isPlayerOnly: PropTypes.bool,
        isEmbedded: PropTypes.bool,
        projectChanged: PropTypes.bool,
        projectId: PropTypes.string,
        turbo: PropTypes.bool,
        onSetIsFullScreen: PropTypes.func,
        onSetIsPlayerOnly: PropTypes.func,
        onSetProjectId: PropTypes.func,
        onSetUsername: PropTypes.func,
        reduxProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        routingStyle: PropTypes.oneOf(Object.keys(routers)),
        username: PropTypes.string,
        vm: PropTypes.instanceOf(VM)
    };
    StateManagerComponent.defaultProps = {
        routingStyle: 'path'
    };
    const mapStateToProps = state => ({
        isFullScreen: state.scratchGui.mode.isFullScreen,
        isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
        isEmbedded: state.scratchGui.mode.isEmbedded,
        projectChanged: state.scratchGui.projectChanged,
        reduxProjectId: state.scratchGui.projectState.projectId,
        turbo: state.scratchGui.vmStatus.turbo,
        username: state.scratchGui.tw.username,
        vm: state.scratchGui.vm
    });
    const mapDispatchToProps = dispatch => ({
        onSetIsFullScreen: isFullScreen => dispatch(setFullScreen(isFullScreen)),
        onSetIsPlayerOnly: isPlayerOnly => dispatch(setPlayer(isPlayerOnly)),
        onSetProjectId: projectId => dispatch(setProjectId(projectId)),
        onSetUsername: username => dispatch(setUsername(username))
    });
    return injectIntl(connect(
        mapStateToProps,
        mapDispatchToProps
    )(StateManagerComponent));
};

export {
    TWStateManager as default
};
