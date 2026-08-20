/* eslint-disable indent, react/jsx-no-bind */
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import installCollaborationManager from '../../lib/collaboration-manager';
import {
    ChatIcon,
    ClockIcon,
    CloseIcon,
    CopyIcon,
    LinkIcon,
    NoteIcon,
    PeopleIcon,
    PinIcon
} from './icons.jsx';
import styles from './collaboration-panel.css';

const ROLE_LABELS = {
    admin: '管理者',
    member: 'メンバー',
    viewer: '閲覧者'
};

const TABS = [
    {id: 'chat', label: 'チャット', icon: ChatIcon},
    {id: 'notes', label: '共有メモ', icon: NoteIcon},
    {id: 'people', label: 'メンバー', icon: PeopleIcon}
];

const RESIZE_HANDLES = [
    {edge: 'north', className: 'resizeNorth', label: '上方向にサイズ変更'},
    {edge: 'east', className: 'resizeEast', label: '右方向にサイズ変更'},
    {edge: 'south', className: 'resizeSouth', label: '下方向にサイズ変更'},
    {edge: 'west', className: 'resizeWest', label: '左方向にサイズ変更'},
    {edge: 'north-east', className: 'resizeNorthEast', label: '右上方向にサイズ変更'},
    {edge: 'south-east', className: 'resizeSouthEast', label: '右下方向にサイズ変更'},
    {edge: 'south-west', className: 'resizeSouthWest', label: '左下方向にサイズ変更'},
    {edge: 'north-west', className: 'resizeNorthWest', label: '左上方向にサイズ変更'}
];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const formatSeconds = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const remainder = value - (minutes * 60);
    return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
};

const formatDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
};

class CollaborationPanel extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            activeTab: 'chat',
            attachment: null,
            chatDraft: '',
            composeError: null,
            copied: false,
            editingEntryId: null,
            editingText: '',
            isCompact: window.innerWidth <= 700 || window.innerHeight <= 560,
            managerState: null,
            noteDraft: '',
            open: false,
            panelHeight: 672,
            panelWidth: 384,
            panelX: Math.max(12, window.innerWidth - 396),
            panelY: 60,
            secondsDraft: ''
        };
        this.handleManagerState = this.handleManagerState.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleAttach = this.handleAttach.bind(this);
        this.handleUseCurrentTime = this.handleUseCurrentTime.bind(this);
        this.handleCopyInvite = this.handleCopyInvite.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handlePanelKeyDown = this.handlePanelKeyDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
    }

    componentDidMount () {
        this.manager = installCollaborationManager(this.props.vm, {username: this.props.username});
        this.manager.on('stateChanged', this.handleManagerState);
        this.handleManagerState(this.manager.getState());
        window.addEventListener('resize', this.handleWindowResize);
        this.handleWindowResize();
    }

    componentDidUpdate (prevProps, prevState) {
        if (prevProps.username !== this.props.username && this.manager) {
            this.manager.setUsername(this.props.username);
        }
        if (prevState.open !== this.state.open || prevState.isCompact !== this.state.isCompact) {
            this.updateModalIsolation();
        }
        if (!prevState.open && this.state.open) {
            this.previouslyFocusedElement = document.activeElement;
            if (this.panelElement) this.panelElement.focus();
        } else if (prevState.open && !this.state.open) {
            const focusTarget = this.launcherElement || this.previouslyFocusedElement;
            if (focusTarget && focusTarget.focus) focusTarget.focus();
        }
    }

    componentWillUnmount () {
        if (this.manager) this.manager.removeListener('stateChanged', this.handleManagerState);
        clearTimeout(this.copiedTimer);
        window.removeEventListener('resize', this.handleWindowResize);
        this.stopPointerAction();
        this.restoreModalIsolation();
    }

    handleManagerState (managerState) {
        this.setState({managerState});
    }

    handleSubmit (event) {
        event.preventDefault();
        const isNote = this.state.activeTab === 'notes';
        const field = isNote ? 'noteDraft' : 'chatDraft';
        const text = this.state[field];
        const success = this.manager.addEntry(isNote ? 'note' : 'chat', text, {
            attachment: this.state.attachment,
            seconds: this.state.secondsDraft
        });
        if (!success) return;
        this.setState({
            [field]: '',
            attachment: null,
            composeError: null,
            secondsDraft: ''
        });
    }

    handleAttach () {
        const attachment = this.manager.captureHatAttachment();
        this.setState({
            attachment,
            composeError: attachment ? null : 'スクリプトの先頭にあるハットブロックを選択してください。'
        });
    }

    handleUseCurrentTime () {
        this.setState({secondsDraft: this.manager.getCurrentTimelineSeconds().toFixed(2)});
    }

    copyText (value) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            return Promise.reject(new Error('Clipboard unavailable'));
        }
        return navigator.clipboard.writeText(value);
    }

    handleCopyInvite (role = 'viewer') {
        this.manager.createInvite(role)
            .then(invite => this.copyText(invite.url)
                .then(() => {
                    this.setState({copied: true});
                    clearTimeout(this.copiedTimer);
                    this.copiedTimer = setTimeout(() => this.setState({copied: false}), 1800);
                })
                .catch(() => {
                    this.setState({composeError: `招待URL: ${invite.url}`});
                }))
            .catch(error => {
                this.setState({composeError: error.message});
            });
    }

    handleWindowResize () {
        this.setState(state => {
            const width = Math.min(state.panelWidth, Math.max(320, window.innerWidth - 16));
            const height = Math.min(state.panelHeight, Math.max(400, window.innerHeight - 16));
            return {
                isCompact: window.innerWidth <= 700 || window.innerHeight <= 560,
                panelHeight: height,
                panelWidth: width,
                panelX: clamp(state.panelX, 0, Math.max(0, window.innerWidth - width)),
                panelY: clamp(state.panelY, 0, Math.max(0, window.innerHeight - height))
            };
        });
    }

    handleDragStart (event) {
        if (this.state.isCompact || (event.target.closest && event.target.closest('button'))) return;
        event.preventDefault();
        this.startPointerAction(event, 'move');
    }

    handleResizeStart (event, edge) {
        if (this.state.isCompact) return;
        event.preventDefault();
        event.stopPropagation();
        this.startPointerAction(event, edge);
    }

    startPointerAction (event, action) {
        this.pointerAction = {
            action,
            height: this.state.panelHeight,
            pointerX: event.clientX,
            pointerY: event.clientY,
            width: this.state.panelWidth,
            x: this.state.panelX,
            y: this.state.panelY
        };
        document.body.style.userSelect = 'none';
        document.addEventListener('pointermove', this.handlePointerMove);
        document.addEventListener('pointerup', this.handlePointerUp);
        document.addEventListener('pointercancel', this.handlePointerUp);
    }

    handlePointerMove (event) {
        if (!this.pointerAction) return;
        const start = this.pointerAction;
        const deltaX = event.clientX - start.pointerX;
        const deltaY = event.clientY - start.pointerY;
        if (start.action === 'move') {
            this.setState({
                panelX: clamp(start.x + deltaX, 0, Math.max(0, window.innerWidth - start.width)),
                panelY: clamp(start.y + deltaY, 0, Math.max(0, window.innerHeight - start.height))
            });
            return;
        }

        this.resizeWindow(start.action, deltaX, deltaY, start);
    }

    resizeWindow (action, deltaX, deltaY, start = this.state) {
        let x = typeof start.x === 'number' ? start.x : start.panelX;
        let y = typeof start.y === 'number' ? start.y : start.panelY;
        const startWidth = typeof start.width === 'number' ? start.width : start.panelWidth;
        const startHeight = typeof start.height === 'number' ? start.height : start.panelHeight;
        let width = startWidth;
        let height = startHeight;
        if (action.indexOf('east') !== -1) width = startWidth + deltaX;
        if (action.indexOf('south') !== -1) height = startHeight + deltaY;
        if (action.indexOf('west') !== -1) {
            width = startWidth - deltaX;
            x += deltaX;
        }
        if (action.indexOf('north') !== -1) {
            height = startHeight - deltaY;
            y += deltaY;
        }
        const nextWidth = clamp(width, 320, window.innerWidth - 8);
        const nextHeight = clamp(height, 400, window.innerHeight - 8);
        if (action.indexOf('west') !== -1) {
            x = (typeof start.x === 'number' ? start.x : start.panelX) + (startWidth - nextWidth);
        }
        if (action.indexOf('north') !== -1) {
            y = (typeof start.y === 'number' ? start.y : start.panelY) + (startHeight - nextHeight);
        }
        this.setState({
            panelHeight: nextHeight,
            panelWidth: nextWidth,
            panelX: clamp(x, 0, window.innerWidth - nextWidth),
            panelY: clamp(y, 0, window.innerHeight - nextHeight)
        });
    }

    handleWindowKeyDown (event) {
        if (this.state.isCompact || event.target !== event.currentTarget) return;
        const offsets = {
            ArrowDown: [0, 1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1]
        };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const step = event.shiftKey ? 24 : 8;
        this.setState(state => ({
            panelX: clamp(state.panelX + (offset[0] * step), 0,
                Math.max(0, window.innerWidth - state.panelWidth)),
            panelY: clamp(state.panelY + (offset[1] * step), 0,
                Math.max(0, window.innerHeight - state.panelHeight))
        }));
    }

    handleResizeKeyDown (event, edge) {
        if (this.state.isCompact) return;
        const offsets = {
            ArrowDown: [0, 1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1]
        };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 24 : 8;
        this.resizeWindow(edge, offset[0] * step, offset[1] * step);
    }

    handlePanelKeyDown (event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.setState({open: false});
            return;
        }
        if (!this.state.isCompact || event.key !== 'Tab' || !this.panelElement) return;
        const focusable = Array.from(this.panelElement.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
            '[href], [tabindex]:not([tabindex="-1"])'
        )).filter(element => !element.hidden && element.offsetParent !== null);
        if (!focusable.length) {
            event.preventDefault();
            this.panelElement.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panelElement)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    updateModalIsolation () {
        this.restoreModalIsolation();
        if (!this.state.open || !this.state.isCompact || !this.rootElement || !this.rootElement.parentElement) return;
        this.isolatedElements = Array.from(this.rootElement.parentElement.children)
            .filter(element => element !== this.rootElement)
            .map(element => ({
                element,
                hadInert: element.hasAttribute('inert'),
                previousAriaHidden: element.getAttribute('aria-hidden')
            }));
        this.isolatedElements.forEach(record => {
            record.element.setAttribute('inert', '');
            record.element.setAttribute('aria-hidden', 'true');
        });
    }

    restoreModalIsolation () {
        if (!this.isolatedElements) return;
        this.isolatedElements.forEach(record => {
            if (!record.hadInert) record.element.removeAttribute('inert');
            if (record.previousAriaHidden === null) record.element.removeAttribute('aria-hidden');
            else record.element.setAttribute('aria-hidden', record.previousAriaHidden);
        });
        this.isolatedElements = null;
    }

    handlePointerUp () {
        this.stopPointerAction();
    }

    stopPointerAction () {
        this.pointerAction = null;
        if (document.body) document.body.style.userSelect = '';
        document.removeEventListener('pointermove', this.handlePointerMove);
        document.removeEventListener('pointerup', this.handlePointerUp);
        document.removeEventListener('pointercancel', this.handlePointerUp);
    }

    renderStatus () {
        const managerState = this.state.managerState;
        if (!managerState) return null;
        const label = managerState.synchronizing ? 'プロジェクト同期中' :
            (managerState.status === 'connected' ? '同期中' :
            (managerState.status === 'connecting' ? '接続中' : 'オフライン'));
        return (
            <div className={styles.teamHeader}>
                <div>
                    <div className={styles.teamIdentity}>
                        <span className={classNames(styles.statusDot, styles[managerState.status])} />
                        <strong>{label}</strong>
                        <span className={styles.roleBadge}>{ROLE_LABELS[managerState.me.role]}</span>
                    </div>
                    <span className={styles.teamId}>{managerState.teamId}</span>
                </div>
                {managerState.me.role === 'admin' ? (
                    <button
                        className={styles.compactButton}
                        type="button"
                        onClick={() => this.handleCopyInvite('viewer')}
                    >
                        <CopyIcon />
                        {this.state.copied ? 'コピー済み' : '閲覧用招待'}
                    </button>
                ) : null}
            </div>
        );
    }

    renderEntry (entry) {
        const managerState = this.state.managerState;
        const isMine = entry.authorId === managerState.me.id;
        const canManage = isMine || managerState.me.role === 'admin';
        const isEditing = this.state.editingEntryId === entry.id;
        return (
            <article
                className={classNames(styles.entry, styles[entry.kind], {
                    [styles.deleted]: entry.deleted
                })}
                key={entry.id}
            >
                <header className={styles.entryHeader}>
                    <span
                        className={styles.avatar}
                        aria-hidden="true"
                    >
                        {(entry.authorName || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{entry.authorName || '不明なユーザー'}</strong>
                    <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </header>
                {isEditing ? (
                    <form
                        className={styles.inlineEdit}
                        onSubmit={event => {
                            event.preventDefault();
                            this.manager.editEntry(entry.id, this.state.editingText);
                            this.setState({editingEntryId: null, editingText: ''});
                        }}
                    >
                        <textarea
                            autoFocus
                            value={this.state.editingText}
                            onChange={event => this.setState({editingText: event.target.value})}
                        />
                        <div>
                            <button
                                type="button"
                                onClick={() => this.setState({editingEntryId: null})}
                            >
                                {'キャンセル'}
                            </button>
                            <button type="submit">{'保存'}</button>
                        </div>
                    </form>
                ) : (
                    <p>{entry.deleted ? 'この投稿は削除されました。' : entry.text}</p>
                )}
                {!entry.deleted && (entry.seconds !== null || entry.attachment) ? (
                    <div className={styles.entryLinks}>
                        {entry.seconds === null ? null : (
                            <button
                                type="button"
                                onClick={() => this.manager.seekTimeline(entry.seconds)}
                            >
                                <ClockIcon />
                                {formatSeconds(entry.seconds)}
                            </button>
                        )}
                        {entry.attachment ? (
                            <button
                                type="button"
                                onClick={() => this.manager.jumpToAttachment(entry.attachment)}
                            >
                                <LinkIcon />
                                {entry.attachment.targetName}{' · '}{entry.attachment.label}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {!entry.deleted && canManage && !isEditing ? (
                    <div className={styles.entryActions}>
                        {isMine ? (
                            <button
                                type="button"
                                onClick={() => this.setState({
                                    editingEntryId: entry.id,
                                    editingText: entry.text
                                })}
                            >{'編集'}</button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => this.manager.deleteEntry(entry.id)}
                        >{'削除'}</button>
                    </div>
                ) : null}
            </article>
        );
    }

    renderEntries () {
        const kind = this.state.activeTab === 'notes' ? 'note' : 'chat';
        const entries = this.state.managerState.entries.filter(entry => entry.kind === kind);
        if (!entries.length) {
            return (
                <div className={styles.emptyState}>
                    {kind === 'note' ? <NoteIcon /> : <ChatIcon />}
                    <strong>{kind === 'note' ? '共有メモはまだありません' : '会話を始めましょう'}</strong>
                    <span>{'時間やハットブロックの位置も一緒に残せます。'}</span>
                </div>
            );
        }
        return <div className={styles.entryList}>{entries.map(entry => this.renderEntry(entry))}</div>;
    }

    renderComposer () {
        const isNote = this.state.activeTab === 'notes';
        const field = isNote ? 'noteDraft' : 'chatDraft';
        const isViewer = this.state.managerState.me.role === 'viewer' || this.state.managerState.synchronizing;
        return (
            <form
                className={styles.composer}
                onSubmit={this.handleSubmit}
            >
                <textarea
                    aria-label={isNote ? '共有メモ' : 'チャットメッセージ'}
                    disabled={isViewer}
                    maxLength="4000"
                    placeholder={isViewer ? '閲覧者は投稿できません' :
                        (isNote ? '確認事項やアイデアを共有…' : 'メッセージを入力…')}
                    value={this.state[field]}
                    onChange={event => this.setState({[field]: event.target.value})}
                />
                <div className={styles.contextRow}>
                    <label>
                        <ClockIcon />
                        <span className={styles.visuallyHidden}>{'秒数'}</span>
                        <input
                            disabled={isViewer}
                            min="0"
                            placeholder="秒"
                            step="0.01"
                            type="number"
                            value={this.state.secondsDraft}
                            onChange={event => this.setState({secondsDraft: event.target.value})}
                        />
                    </label>
                    <button
                        disabled={isViewer}
                        type="button"
                        onClick={this.handleUseCurrentTime}
                    >{'現在'}</button>
                    <button
                        disabled={isViewer}
                        type="button"
                        onClick={this.handleAttach}
                    >
                        <PinIcon />
                        {'位置を添付'}
                    </button>
                </div>
                {this.state.attachment ? (
                    <div className={styles.attachmentPreview}>
                        <LinkIcon />
                        <span>{this.state.attachment.targetName}{' · '}{this.state.attachment.label}</span>
                        <button
                            aria-label="位置の添付を外す"
                            type="button"
                            onClick={() => this.setState({attachment: null})}
                        ><CloseIcon /></button>
                    </div>
                ) : null}
                {this.state.composeError ? <p className={styles.composeError}>{this.state.composeError}</p> : null}
                <button
                    className={styles.sendButton}
                    disabled={isViewer || !this.state[field].trim()}
                    type="submit"
                >{isNote ? 'メモを共有' : '送信'}</button>
            </form>
        );
    }

    renderPeople () {
        const managerState = this.state.managerState;
        return (
            <div className={styles.peopleList}>
                {managerState.me.role === 'admin' ? (
                    <div className={styles.inviteActions}>
                        <button
                            type="button"
                            onClick={() => this.handleCopyInvite('member')}
                        >
                            <CopyIcon />{'メンバー招待'}
                        </button>
                        <button
                            type="button"
                            onClick={() => this.handleCopyInvite('viewer')}
                        >
                            <CopyIcon />{'閲覧者招待'}
                        </button>
                    </div>
                ) : null}
                {managerState.members.map(member => {
                    const online = managerState.onlineUserIds.indexOf(member.id) !== -1;
                    const awareness = managerState.awareness[member.id];
                    const isMe = member.id === managerState.me.id;
                    const awarenessLabel = awareness && awareness.targetName ?
                        `${awareness.targetName}${awareness.blockLabel ? ` · ${awareness.blockLabel}` : ''}` :
                        (online ? 'エディターを閲覧中' : 'オフライン');
                    const roleControlLabel = `${member.name}の権限`;
                    return (
                        <section
                            className={styles.person}
                            key={member.id}
                        >
                            <span
                                className={styles.avatar}
                                aria-hidden="true"
                            >
                                {(member.name || '?').slice(0, 1).toUpperCase()}
                                <i className={classNames({[styles.online]: online})} />
                            </span>
                            <div className={styles.personDetails}>
                                <strong>{member.name}{isMe ? '（自分）' : ''}</strong>
                                <span>{awarenessLabel}</span>
                            </div>
                            {managerState.me.role === 'admin' && !isMe && member.role !== 'admin' ? (
                                <div className={styles.roleControls}>
                                    <select
                                        aria-label={roleControlLabel}
                                        value={member.role}
                                        onChange={event => this.manager.changeRole(member.id, event.target.value)}
                                    >
                                        <option value="member">{'メンバー'}</option>
                                        <option value="viewer">{'閲覧者'}</option>
                                    </select>
                                    {member.role === 'member' ? (
                                        <button
                                            type="button"
                                            onClick={() => this.manager.addAdmin(member.id)}
                                        >
                                            {'管理者を増やす'}
                                        </button>
                                    ) : null}
                                </div>
                            ) : <span className={styles.roleBadge}>{ROLE_LABELS[member.role]}</span>}
                        </section>
                    );
                })}
            </div>
        );
    }

    renderPanel () {
        const managerState = this.state.managerState;
        if (!managerState) return null;
        const isFeed = this.state.activeTab === 'chat' || this.state.activeTab === 'notes';
        return (
            <aside
                aria-label="チーム共同編集"
                aria-modal={this.state.isCompact ? 'true' : null}
                className={classNames(styles.panel, {[styles.open]: this.state.open})}
                hidden={!this.state.open}
                role={this.state.isCompact ? 'dialog' : null}
                style={{
                    height: `${this.state.panelHeight}px`,
                    left: `${this.state.panelX}px`,
                    top: `${this.state.panelY}px`,
                    width: `${this.state.panelWidth}px`
                }}
                tabIndex={-1}
                onKeyDown={this.handlePanelKeyDown}
                ref={element => {
                    this.panelElement = element;
                }}
            >
                <header
                    aria-label="矢印キーで共同編集ウィンドウを移動"
                    className={styles.panelHeader}
                    tabIndex={this.state.isCompact ? null : 0}
                    onKeyDown={this.handleWindowKeyDown}
                    onPointerDown={this.handleDragStart}
                >
                    <div>
                        <strong>{'チーム'}</strong>
                        <span>{managerState.onlineUserIds.length}{'人がオンライン'}</span>
                    </div>
                    <button
                        aria-label="共同編集パネルを閉じる"
                        className={styles.iconButton}
                        type="button"
                        onClick={() => this.setState({open: false})}
                    ><CloseIcon /></button>
                </header>
                {this.renderStatus()}
                {managerState.syncMessage ? <div className={styles.syncNotice}>{managerState.syncMessage}</div> : null}
                {managerState.error ? <div className={styles.connectionError}>{managerState.error}</div> : null}
                <nav
                    aria-label="共同編集の項目"
                    className={styles.tabs}
                    role="tablist"
                >
                    {TABS.map(tab => {
                        const TabIcon = tab.icon;
                        return (
                            <button
                                aria-selected={this.state.activeTab === tab.id}
                                className={classNames({[styles.active]: this.state.activeTab === tab.id})}
                                key={tab.id}
                                role="tab"
                                type="button"
                                onClick={() => this.setState({activeTab: tab.id, composeError: null})}
                            >
                                <TabIcon />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
                <div
                    className={styles.panelBody}
                    role="tabpanel"
                >
                    {isFeed ? this.renderEntries() : null}
                    {this.state.activeTab === 'people' ? this.renderPeople() : null}
                </div>
                {isFeed ? this.renderComposer() : null}
                {RESIZE_HANDLES.map(handle => (
                    <button
                        aria-label={handle.label}
                        className={classNames(styles.resizeHandle, styles[handle.className])}
                        key={handle.edge}
                        tabIndex={this.state.isCompact ? -1 : 0}
                        type="button"
                        onKeyDown={event => this.handleResizeKeyDown(event, handle.edge)}
                        onPointerDown={event => this.handleResizeStart(event, handle.edge)}
                    />
                ))}
            </aside>
        );
    }

    render () {
        const managerState = this.state.managerState;
        const onlineCount = managerState ? managerState.onlineUserIds.length : 0;
        return (
            <div
                className={styles.root}
                ref={element => {
                    this.rootElement = element;
                }}
            >
                <button
                    aria-expanded={this.state.open}
                    aria-label="チーム共同編集を開く"
                    className={classNames(styles.launcher, {[styles.launcherOpen]: this.state.open})}
                    title="チーム共同編集"
                    type="button"
                    onClick={() => this.setState(state => ({open: !state.open}))}
                    ref={element => {
                        this.launcherElement = element;
                    }}
                >
                    <PeopleIcon />
                    {onlineCount ? <span>{onlineCount}</span> : null}
                </button>
                {this.renderPanel()}
            </div>
        );
    }
}

CollaborationPanel.propTypes = {
    username: PropTypes.string,
    vm: PropTypes.instanceOf(VM).isRequired
};

CollaborationPanel.defaultProps = {
    username: 'ゲスト'
};

export {CollaborationPanel};
export default CollaborationPanel;
