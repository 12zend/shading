import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import AddonHooks from '../../addons/hooks';
import installMovieAssetManager from '../../lib/movie-asset-manager';
import {
    CHAPTER_COUNT,
    RENDER_SETTINGS_PANEL,
    REQUIRED_PLUGINS,
    STEPS,
    getStepIndex,
    getTutorialMessages
} from '../../lib/tutorial/tutorial-steps';
import {
    STAGE_VARIABLES,
    applyTutorialStage,
    getTutorialTarget,
    releaseTutorialBlocks,
    tutorialBlockId
} from '../../lib/tutorial/tutorial-blocks';
import {
    STATUS_ACTIVE,
    STATUS_COMPLETED,
    STATUS_SKIPPED,
    onTutorialRestart,
    readTutorialState,
    writeTutorialState
} from '../../lib/tutorial/tutorial-storage';

import styles from './shading-tutorial.css';

const CARD_WIDTH = 368;
const EDGE_MARGIN = 16;
const HIGHLIGHT_PADDING = 6;

const installPageURL = () => {
    const root = process.env.ROOT || '/';
    return `${root}${root.endsWith('/') ? '' : '/'}install.html`;
};

const sameRect = (a, b) => (
    a === b || (a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
);

const toRect = domRect => {
    if (!domRect || domRect.width <= 0 || domRect.height <= 0) return null;
    return {
        left: Math.round(domRect.left - HIGHLIGHT_PADDING),
        top: Math.round(domRect.top - HIGHLIGHT_PADDING),
        width: Math.round(domRect.width + (HIGHLIGHT_PADDING * 2)),
        height: Math.round(domRect.height + (HIGHLIGHT_PADDING * 2))
    };
};

// Only point at things the user can actually see.
const clipToElement = (rect, element) => {
    if (!rect || !element) return rect;
    const bounds = element.getBoundingClientRect();
    const left = Math.max(rect.left, bounds.left);
    const top = Math.max(rect.top, bounds.top);
    const right = Math.min(rect.left + rect.width, bounds.right);
    const bottom = Math.min(rect.top + rect.height, bounds.bottom);
    if (right - left < 8 || bottom - top < 8) return null;
    return {left, top, width: right - left, height: bottom - top};
};

const blockShapeRect = block => {
    if (!block) return null;
    const shape = block.svgPath_ || (typeof block.getSvgRoot === 'function' ? block.getSvgRoot() : null);
    return shape ? toRect(shape.getBoundingClientRect()) : null;
};

// `**bold**`, `*emphasis*` and `block names` inside the tutorial texts.
const renderInline = text => String(text)
    .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
            return <em key={index}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return (
                <code
                    className={styles.blockName}
                    key={index}
                >{part.slice(1, -1)}</code>
            );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
    });

const renderBody = body => body.map((item, index) => {
    if (item && Array.isArray(item.list)) {
        return (
            <ul
                className={styles.list}
                key={index}
            >
                {item.list.map((entry, entryIndex) => (
                    <li key={entryIndex}>{renderInline(entry)}</li>
                ))}
            </ul>
        );
    }
    return <p key={index}>{renderInline(item)}</p>;
});

class ShadingTutorial extends React.Component {
    constructor (props) {
        super(props);
        const saved = readTutorialState();
        this.state = {
            anchor: null,
            dockHeight: null,
            confirmingSkip: false,
            highlight: null,
            minimized: false,
            pluginStatus: 'checking',
            position: null,
            renderStatus: 'idle',
            stepIndex: getStepIndex(saved.step),
            visible: saved.status === STATUS_ACTIVE
        };
        this.appliedStage = null;
        this.enteredStepIndex = -1;
        this.cardElement = null;
        this.handleBack = this.handleBack.bind(this);
        this.handleNext = this.handleNext.bind(this);
        this.handleSkip = this.handleSkip.bind(this);
        this.handleConfirmSkip = this.handleConfirmSkip.bind(this);
        this.handleCancelSkip = this.handleCancelSkip.bind(this);
        this.handleToggleMinimized = this.handleToggleMinimized.bind(this);
        this.handleReload = this.handleReload.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragMove = this.handleDragMove.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
        this.handlePluginsAttached = this.handlePluginsAttached.bind(this);
        this.updatePluginStatus = this.updatePluginStatus.bind(this);
        this.handleTimelineChanged = this.handleTimelineChanged.bind(this);
        this.tick = this.tick.bind(this);
        this.setCardElement = element => {
            this.cardElement = element;
        };
    }

    componentDidMount () {
        this.removeRestartListener = onTutorialRestart(this.handleRestart);
        const vm = this.props.vm;
        if (vm.shadingPlugins) {
            this.handlePluginsAttached(vm.shadingPlugins);
        } else {
            vm.on('SHADING_PLUGINS_ATTACHED', this.handlePluginsAttached);
        }
        this.movieManager = installMovieAssetManager(vm);
        this.movieManager.on('timelineChanged', this.handleTimelineChanged);
        this.syncStep();
        this.frame = requestAnimationFrame(this.tick);
    }

    componentDidUpdate (prevProps, prevState) {
        if (this.toolboxNeedsRefresh && prevProps.activeTabIndex !== this.props.activeTabIndex) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = setTimeout(() => {
                try {
                    this.refreshToolboxIfNeeded();
                } catch (error) {
                    console.error('[tutorial] Could not refresh the block palette:', error);
                }
            }, 120);
        }
        if (
            prevProps.isProjectReady !== this.props.isProjectReady ||
            prevState.stepIndex !== this.state.stepIndex ||
            prevState.visible !== this.state.visible
        ) {
            this.syncStep();
        }
    }

    componentWillUnmount () {
        cancelAnimationFrame(this.frame);
        clearTimeout(this.tabTimeout);
        clearTimeout(this.revealTimeout);
        clearTimeout(this.refreshTimeout);
        if (this.removeRestartListener) this.removeRestartListener();
        this.props.vm.removeListener('SHADING_PLUGINS_ATTACHED', this.handlePluginsAttached);
        if (this.plugins) this.plugins.removeListener('changed', this.updatePluginStatus);
        if (this.movieManager) this.movieManager.removeListener('timelineChanged', this.handleTimelineChanged);
        this.handleDragEnd();
    }

    get step () {
        return STEPS[this.state.stepIndex];
    }

    handlePluginsAttached (plugins) {
        if (this.plugins || !plugins) return;
        this.plugins = plugins;
        plugins.on('changed', this.updatePluginStatus);
        Promise.resolve(plugins.ready).then(this.updatePluginStatus, this.updatePluginStatus);
    }

    updatePluginStatus () {
        if (!this.plugins) return;
        const ready = REQUIRED_PLUGINS.every(id => this.plugins.isActive(id));
        this.setState({pluginStatus: ready ? 'ready' : 'missing'});
    }

    handleTimelineChanged (timeline) {
        const recording = Boolean(timeline && timeline.recording);
        this.setState(state => {
            if (recording && state.renderStatus !== 'rendering') return {renderStatus: 'rendering'};
            if (!recording && state.renderStatus === 'rendering') return {renderStatus: 'done'};
            return null;
        });
    }

    handleRestart () {
        this.appliedStage = null;
        this.enteredStepIndex = -1;
        // Entered explicitly: a restart while already on the first page does not change the step.
        this.setState(
            {confirmingSkip: false, minimized: false, renderStatus: 'idle', stepIndex: 0, visible: true},
            () => this.syncStep()
        );
    }

    // Bring the project and the editor to what the current page describes.
    syncStep () {
        if (!this.state.visible || !this.props.isProjectReady) return;
        const index = this.state.stepIndex;
        if (index === this.enteredStepIndex) return;
        this.enteredStepIndex = index;
        const step = STEPS[index];
        writeTutorialState({status: STATUS_ACTIVE, step: step.id});
        // Moving back to the rendering page with the settings still open must not skip ahead again.
        this.renderSettingsOpenOnEntry = Boolean(document.querySelector(RENDER_SETTINGS_PANEL));
        if (step.stage !== this.appliedStage) {
            try {
                applyTutorialStage(this.props.vm, step.stage, {freePosition: this.findFreePosition()});
                this.appliedStage = step.stage;
                // Variables the stage created only show up in the Variables category after a refresh.
                if (STAGE_VARIABLES[step.stage]) this.toolboxNeedsRefresh = true;
            } catch (error) {
                // Never let the tutorial break the editor; the page can still be read.
                console.error('[tutorial] Could not place the tutorial blocks:', error);
            }
        }
        // Deferred: when a project finishes loading, the project loader switches to the code tab in the same
        // commit (its componentDidUpdate runs after this one), which would undo the switch below.
        clearTimeout(this.tabTimeout);
        clearTimeout(this.revealTimeout);
        this.tabTimeout = setTimeout(() => {
            if (this.step !== step || !this.state.visible) return;
            const tabIndex = this.props.tabIndexes[step.tab];
            if (typeof tabIndex === 'number' && tabIndex !== this.props.activeTabIndex) {
                this.props.onActivateTab(tabIndex);
            }
            // Blocks measured while the code tab is hidden get wrong sizes; re-render the flyout once it is back.
            if (step.tab !== 'code') this.toolboxNeedsRefresh = true;
            // Scratch-blocks re-renders the workspace and toolbox asynchronously after tab and project changes.
            this.revealTimeout = setTimeout(() => this.revealStep(step), 120);
        }, 0);
    }

    // Below the scripts already in the code area, so a new tutorial script does not cover the user's work.
    findFreePosition () {
        const workspace = AddonHooks.blocklyWorkspace;
        const vm = this.props.vm;
        if (!workspace || !vm.editingTarget || vm.editingTarget !== getTutorialTarget(vm)) return null;
        if (workspace.getBlockById(tutorialBlockId('hat'))) return null;
        try {
            const box = workspace.getBlocksBoundingBox();
            if (!box || box.height <= 0) return null;
            return {x: Math.round(box.x), y: Math.round(box.y + box.height + 64)};
        } catch (error) {
            return null;
        }
    }

    revealStep (step) {
        if (this.step !== step || step.tab !== 'code') return;
        const workspace = AddonHooks.blocklyWorkspace;
        if (!workspace) return;
        try {
            this.refreshToolboxIfNeeded();
            const toolbox = workspace.getToolbox && workspace.getToolbox();
            if (step.category && toolbox && typeof toolbox.setSelectedCategoryById === 'function') {
                toolbox.setSelectedCategoryById(step.category);
            }
            const hat = workspace.getBlockById(tutorialBlockId('hat'));
            if (hat && workspace.scrollbar) {
                // Put the tutorial's script at the top left of the visible code area.
                const xy = hat.getRelativeToSurfaceXY();
                const metrics = workspace.getMetrics();
                const margin = 32;
                workspace.scrollbar.set(
                    (xy.x * workspace.scale) - metrics.contentLeft - margin,
                    (xy.y * workspace.scale) - metrics.contentTop - margin
                );
            }
        } catch (error) {
            console.error('[tutorial] Could not scroll the code area:', error);
        }
    }

    refreshToolboxIfNeeded () {
        const workspace = AddonHooks.blocklyWorkspace;
        const toolbox = workspace && workspace.getToolbox && workspace.getToolbox();
        if (!this.toolboxNeedsRefresh || !toolbox || typeof toolbox.refreshSelection !== 'function') return;
        if (this.props.activeTabIndex !== this.props.tabIndexes.code) return;
        this.toolboxNeedsRefresh = false;
        toolbox.refreshSelection();
    }

    // Follows the highlighted element (it moves with scrolling, resizing and re-rendering) and watches for
    // the rendering settings to open.
    tick () {
        this.frame = requestAnimationFrame(this.tick);
        if (!this.state.visible) return;
        const step = this.step;
        if (step.advanceOn === 'renderSettingsOpen' && this.props.isProjectReady) {
            const open = Boolean(document.querySelector(RENDER_SETTINGS_PANEL));
            if (open && !this.renderSettingsOpenOnEntry) {
                this.goTo(this.state.stepIndex + 1);
                return;
            }
            if (!open) this.renderSettingsOpenOnEntry = false;
        }
        if (!this.state.anchor) {
            const anchor = this.findAnchor();
            if (anchor) this.setState({anchor});
        }
        const dockHeight = this.findDockHeight();
        if (dockHeight !== this.state.dockHeight) this.setState({dockHeight});
        const highlight = this.state.minimized ? null : this.findHighlight(step.highlight);
        if (!sameRect(highlight, this.state.highlight)) this.setState({highlight});
    }

    // By default the card sits at the bottom right of the code area, clear of the zoom buttons.
    findAnchor () {
        const workspace = AddonHooks.blocklyWorkspace;
        const svg = workspace && workspace.getParentSvg && workspace.getParentSvg();
        const rect = svg && svg.getBoundingClientRect();
        if (!rect || rect.width <= 0) return null;
        return {
            right: Math.max(EDGE_MARGIN, Math.round(window.innerWidth - rect.right + 76)),
            bottom: Math.max(EDGE_MARGIN, Math.round(window.innerHeight - rect.bottom + EDGE_MARGIN))
        };
    }

    // Docked over the timeline, the card stays below the play controls so ▶ remains reachable.
    findDockHeight () {
        const playback = document.querySelector('[data-movie-timeline-playback]');
        if (!playback) return null;
        const top = playback.getBoundingClientRect().bottom + 12;
        return Math.max(220, Math.round(window.innerHeight - top - EDGE_MARGIN));
    }

    findHighlight (spec) {
        if (!spec) return null;
        try {
            if (spec.selector) {
                const element = document.querySelector(spec.selector);
                return element ? toRect(element.getBoundingClientRect()) : null;
            }
            if (spec.tab) {
                const element = document.querySelector(`[data-tutorial-tab="${spec.tab}"]`);
                return element ? toRect(element.getBoundingClientRect()) : null;
            }
            if (this.props.activeTabIndex !== this.props.tabIndexes.code) return null;
            const workspace = AddonHooks.blocklyWorkspace;
            if (spec.category) {
                const element = document.querySelector(`.scratchCategoryId-${spec.category}`);
                return element ? toRect(element.getBoundingClientRect()) : null;
            }
            if (!workspace) return null;
            if (spec.flyoutBlock) {
                const flyout = workspace.getFlyout();
                const block = flyout.getWorkspace().getTopBlocks()
                    .find(candidate => candidate.type === spec.flyoutBlock);
                return clipToElement(blockShapeRect(block), flyout.svgGroup_);
            }
            if (spec.block) {
                const block = workspace.getBlockById(tutorialBlockId(spec.block));
                return clipToElement(blockShapeRect(block), workspace.getParentSvg());
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    goTo (index) {
        const stepIndex = Math.max(0, Math.min(STEPS.length - 1, index));
        this.setState({confirmingSkip: false, highlight: null, stepIndex});
    }

    handleBack () {
        this.goTo(this.state.stepIndex - 1);
    }

    handleNext () {
        if (this.state.stepIndex >= STEPS.length - 1) {
            this.close(STATUS_COMPLETED);
            return;
        }
        this.goTo(this.state.stepIndex + 1);
    }

    handleSkip () {
        this.setState({confirmingSkip: true});
    }

    handleCancelSkip () {
        this.setState({confirmingSkip: false});
    }

    handleConfirmSkip () {
        this.close(STATUS_SKIPPED);
    }

    close (status) {
        writeTutorialState({status, step: this.step.id});
        // What the tutorial built now belongs to the user; running the tutorial again will not replace it.
        try {
            releaseTutorialBlocks(this.props.vm);
        } catch (error) {
            console.error('[tutorial] Could not hand over the tutorial blocks:', error);
        }
        this.appliedStage = null;
        this.enteredStepIndex = -1;
        this.setState({confirmingSkip: false, highlight: null, visible: false});
    }

    handleToggleMinimized () {
        this.setState(state => ({minimized: !state.minimized}));
    }

    handleReload () {
        location.reload();
    }

    handleDragStart (event) {
        if (event.button !== 0 || event.target.closest('button') || !this.cardElement) return;
        event.preventDefault();
        const rect = this.cardElement.getBoundingClientRect();
        this.dragOffset = {x: event.clientX - rect.left, y: event.clientY - rect.top};
        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('mouseup', this.handleDragEnd);
    }

    handleDragMove (event) {
        if (!this.dragOffset || !this.cardElement) return;
        const rect = this.cardElement.getBoundingClientRect();
        const maxX = Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN);
        const maxY = Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN);
        this.setState({
            position: {
                x: Math.min(maxX, Math.max(EDGE_MARGIN, event.clientX - this.dragOffset.x)),
                y: Math.min(maxY, Math.max(EDGE_MARGIN, event.clientY - this.dragOffset.y))
            }
        });
    }

    handleDragEnd () {
        this.dragOffset = null;
        document.removeEventListener('mousemove', this.handleDragMove);
        document.removeEventListener('mouseup', this.handleDragEnd);
    }

    renderStatus (messages) {
        const step = this.step;
        const ui = messages.ui;
        if (step.requires === 'plugins') {
            if (this.state.pluginStatus === 'checking') {
                return <p className={styles.status}>{ui.pluginsChecking}</p>;
            }
            if (this.state.pluginStatus === 'ready') {
                return <p className={classNames(styles.status, styles.statusReady)}>{ui.pluginsReady}</p>;
            }
            return (
                <div className={styles.requirement}>
                    <p className={styles.statusMissing}>{ui.pluginsMissing}</p>
                    <ol className={styles.list}>
                        {ui.pluginsHowTo.map((entry, index) => (
                            <li key={index}>{renderInline(entry)}</li>
                        ))}
                    </ol>
                    <div className={styles.requirementActions}>
                        <a
                            className={styles.primaryButton}
                            href={installPageURL()}
                            rel="noopener noreferrer"
                            target="_blank"
                        >{ui.openInstall}</a>
                        <button
                            className={styles.secondaryButton}
                            type="button"
                            onClick={this.handleReload}
                        >{ui.reload}</button>
                    </div>
                </div>
            );
        }
        if (step.advanceOn === 'renderSettingsOpen') {
            return <p className={styles.status}>{ui.renderOpenHint}</p>;
        }
        if (step.id === 'renderSettings' && this.state.renderStatus !== 'idle') {
            return (
                <p
                    className={classNames(styles.status, {
                        [styles.statusReady]: this.state.renderStatus === 'done'
                    })}
                >{this.state.renderStatus === 'done' ? ui.rendered : ui.rendering}</p>
            );
        }
        return null;
    }

    renderHighlight () {
        const rect = this.state.highlight;
        if (!rect) return null;
        return (
            <div
                aria-hidden="true"
                className={styles.highlight}
                style={{
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`
                }}
            />
        );
    }

    render () {
        if (!this.state.visible || !this.props.isProjectReady) return null;
        const messages = getTutorialMessages(this.props.locale);
        const ui = messages.ui;
        const step = this.step;
        const text = messages.steps[step.id];
        const isFirst = this.state.stepIndex === 0;
        const isLast = this.state.stepIndex === STEPS.length - 1;
        const blocked = step.requires === 'plugins' && this.state.pluginStatus !== 'ready';
        const progress = ui.progress
            .replace('{chapter}', step.chapter)
            .replace('{total}', CHAPTER_COUNT);
        const position = this.state.position;
        const anchor = this.state.anchor;
        let placement = null;
        if (position) {
            placement = {left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto'};
        } else if (anchor && step.tab === 'code' && step.dock !== 'window') {
            placement = {right: `${anchor.right}px`, bottom: `${anchor.bottom}px`};
        } else if (this.state.dockHeight) {
            placement = {maxHeight: `${this.state.dockHeight}px`};
        }
        // Otherwise the card docks at the bottom right of the window (over the timeline), so it does not cover
        // the tab or script it describes and the stage stays visible.

        if (this.state.minimized) {
            return (
                <button
                    className={styles.pill}
                    style={placement}
                    title={ui.expand}
                    type="button"
                    onClick={this.handleToggleMinimized}
                >
                    <span className={styles.pillDot} />
                    <span>{ui.label}</span>
                    <span className={styles.pillProgress}>{progress}</span>
                </button>
            );
        }

        return (
            <React.Fragment>
                {this.renderHighlight()}
                <section
                    aria-label={ui.label}
                    aria-live="polite"
                    className={styles.card}
                    ref={this.setCardElement}
                    role="dialog"
                    style={Object.assign({width: `${CARD_WIDTH}px`}, placement)}
                >
                    <header
                        className={styles.header}
                        title={ui.dragHint}
                        onMouseDown={this.handleDragStart}
                    >
                        <span className={styles.eyebrow}>
                            <span>{ui.label}</span>
                            <span className={styles.progressText}>{progress}</span>
                        </span>
                        <button
                            aria-label={ui.minimize}
                            className={styles.iconButton}
                            title={ui.minimize}
                            type="button"
                            onClick={this.handleToggleMinimized}
                        >
                            <span
                                aria-hidden="true"
                                className={styles.minimizeGlyph}
                            />
                        </button>
                    </header>
                    <div
                        aria-hidden="true"
                        className={styles.progressTrack}
                    >
                        <span
                            className={styles.progressBar}
                            style={{width: `${(step.chapter / CHAPTER_COUNT) * 100}%`}}
                        />
                    </div>
                    <div className={styles.content}>
                        <h2 className={styles.title}>{text.title}</h2>
                        <div className={styles.body}>
                            {renderBody(text.body)}
                            {this.renderStatus(messages)}
                        </div>
                    </div>
                    {this.state.confirmingSkip ? (
                        <footer className={classNames(styles.footer, styles.confirm)}>
                            <p>{ui.skipConfirm}</p>
                            <div className={styles.actions}>
                                <button
                                    className={styles.secondaryButton}
                                    type="button"
                                    onClick={this.handleCancelSkip}
                                >{ui.back}</button>
                                <button
                                    className={styles.primaryButton}
                                    type="button"
                                    onClick={this.handleConfirmSkip}
                                >{ui.skip}</button>
                            </div>
                        </footer>
                    ) : (
                        <footer className={styles.footer}>
                            {isLast ? <span /> : (
                                <button
                                    className={styles.linkButton}
                                    type="button"
                                    onClick={this.handleSkip}
                                >{ui.skip}</button>
                            )}
                            <div className={styles.actions}>
                                {isFirst ? null : (
                                    <button
                                        className={styles.secondaryButton}
                                        type="button"
                                        onClick={this.handleBack}
                                    >{ui.back}</button>
                                )}
                                <button
                                    className={styles.primaryButton}
                                    disabled={blocked}
                                    type="button"
                                    onClick={this.handleNext}
                                >{isLast ? ui.finish : ui.next}</button>
                            </div>
                        </footer>
                    )}
                </section>
            </React.Fragment>
        );
    }
}

ShadingTutorial.propTypes = {
    activeTabIndex: PropTypes.number.isRequired,
    isProjectReady: PropTypes.bool.isRequired,
    locale: PropTypes.string.isRequired,
    onActivateTab: PropTypes.func.isRequired,
    tabIndexes: PropTypes.objectOf(PropTypes.number).isRequired,
    vm: PropTypes.shape({
        editingTarget: PropTypes.object,
        on: PropTypes.func,
        removeListener: PropTypes.func,
        runtime: PropTypes.object,
        shadingPlugins: PropTypes.object
    }).isRequired
};

export default ShadingTutorial;
