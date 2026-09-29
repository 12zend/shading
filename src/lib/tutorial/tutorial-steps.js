import en from './locales/en.json';
import ja from './locales/ja.json';

// The pages of the first-run tutorial. Texts live in ./locales; this file describes what each page does:
//   chapter    Number shown in the progress label (the outline the tutorial follows).
//   stage      Tutorial script the project shows on this page (see tutorial-blocks.js). Stages are cumulative,
//              so moving back and forth, or resuming after a reload, always leads to the same project.
//   tab        Editor tab to open ('code', 'costumes', 'sounds', 'videos', 'fonts', 'models', 'shaders', 'plugins').
//   category   Toolbox category to scroll to.
//   highlight  What to point at: {category}, {flyoutBlock: opcode}, {block: key}, {tab}, or {selector}.
//   requires   'plugins' keeps Next disabled until the official plugins are active.
//   advanceOn  'renderSettingsOpen' moves on by itself once the rendering settings are open.
//   dock       'window' puts the card at the bottom right of the window instead of the code area, for pages
//              about a long script or another tab.

const REQUIRED_PLUGINS = Object.freeze(['color-adjust']);

const TIMELINE = 'section[aria-label="Timeline"]';
const RENDER_SETTINGS_BUTTON = 'button[aria-label="Rendering settings"][aria-expanded]';
const RENDER_SETTINGS_PANEL = '[role="dialog"][aria-label="Rendering settings"]';

const STEPS = Object.freeze([
    {id: 'welcome', chapter: 1, stage: 'none', tab: 'code', requires: 'plugins'},
    {id: 'renderFrame', chapter: 2, stage: 'none', tab: 'code', category: 'events', highlight: {category: 'events'}},
    {id: 'renderFramePlaced', chapter: 2, stage: 'hat', tab: 'code', highlight: {block: 'hat'}},
    {id: 'objects', chapter: 3, stage: 'hat', tab: 'code', category: 'objects', highlight: {category: 'objects'}},
    {
        id: 'drawMedia',
        chapter: 3,
        stage: 'hat',
        tab: 'code',
        category: 'objects',
        highlight: {flyoutBlock: 'objects_draw'}
    },
    {id: 'drawPlaced', chapter: 3, stage: 'draw', tab: 'code', highlight: {block: 'draw'}},
    {id: 'camera', chapter: 4, stage: 'draw', tab: 'code', category: 'motion', highlight: {category: 'motion'}},
    {id: 'cameraPlaced', chapter: 4, stage: 'camera', tab: 'code', highlight: {block: 'camera'}},
    {
        id: 'operators',
        chapter: 5,
        stage: 'camera',
        tab: 'code',
        category: 'operators',
        highlight: {category: 'operators'}
    },
    {
        id: 'easing',
        chapter: 5,
        stage: 'camera',
        tab: 'code',
        category: 'operators',
        highlight: {flyoutBlock: 'operator_easing'}
    },
    {id: 'easingPlaced', chapter: 5, stage: 'cameraEasing', tab: 'code', highlight: {block: 'cameraEasing'}},
    {id: 'timeline', chapter: 6, stage: 'cameraEasing', tab: 'code', highlight: {selector: TIMELINE}},
    {id: 'combine', chapter: 7, stage: 'cameraEasing', tab: 'code', highlight: {block: 'draw'}},
    {id: 'combinePlaced', chapter: 7, stage: 'xEasing', tab: 'code', highlight: {block: 'xSum'}},
    {
        id: 'variables',
        chapter: 8,
        stage: 'xEasing',
        tab: 'code',
        category: 'variables',
        highlight: {category: 'variables'}
    },
    {id: 'lists', chapter: 8, stage: 'xEasing', tab: 'code', category: 'variables', highlight: {category: 'variables'}},
    {id: 'tmp', chapter: 8, stage: 'xEasing', tab: 'code', highlight: {block: 'xSum'}},
    {id: 'tmpPlaced', chapter: 8, stage: 'tmp', tab: 'code', highlight: {block: 'setTmp'}},
    {
        id: 'grouping',
        chapter: 9,
        stage: 'tmp',
        tab: 'code',
        category: 'objects',
        highlight: {flyoutBlock: 'objects_grouping'}
    },
    {id: 'groupingPlaced', chapter: 9, stage: 'grouping', tab: 'code', highlight: {block: 'grouping'}},
    {id: 'looks', chapter: 10, stage: 'grouping', tab: 'code', category: 'penfx', highlight: {category: 'penfx'}},
    {id: 'costumes', chapter: 11, stage: 'grouping', tab: 'costumes', highlight: {tab: 'costumes'}},
    {id: 'sounds', chapter: 12, stage: 'grouping', tab: 'sounds', highlight: {tab: 'sounds'}},
    {id: 'videos', chapter: 13, stage: 'grouping', tab: 'videos', highlight: {tab: 'videos'}},
    {id: 'fonts', chapter: 13, stage: 'grouping', tab: 'fonts', highlight: {tab: 'fonts'}},
    {id: 'models', chapter: 13, stage: 'grouping', tab: 'models', highlight: {tab: 'models'}},
    {id: 'shader', chapter: 14, stage: 'grouping', tab: 'shaders', highlight: {tab: 'shaders'}},
    {id: 'pluginsTab', chapter: 15, stage: 'grouping', tab: 'plugins', highlight: {tab: 'plugins'}},
    {id: 'blockShapes', chapter: 16, stage: 'grouping', tab: 'code', dock: 'window', highlight: {block: 'hat'}},
    {
        id: 'timer',
        chapter: 17,
        stage: 'grouping',
        tab: 'code',
        category: 'sensing',
        highlight: {flyoutBlock: 'sensing_timer'}
    },
    {
        id: 'timeWithin',
        chapter: 17,
        stage: 'grouping',
        tab: 'code',
        category: 'objects',
        highlight: {flyoutBlock: 'objects_timeWithin'}
    },
    {id: 'example', chapter: 18, stage: 'grouping', tab: 'code', dock: 'window', highlight: {block: 'hat'}},
    {id: 'examplePlaced', chapter: 18, stage: 'example', tab: 'code', dock: 'window', highlight: {block: 'hat'}},
    {
        id: 'render',
        chapter: 19,
        stage: 'example',
        tab: 'code',
        highlight: {selector: RENDER_SETTINGS_BUTTON},
        advanceOn: 'renderSettingsOpen'
    },
    {id: 'renderSettings', chapter: 19, stage: 'example', tab: 'code', highlight: {selector: RENDER_SETTINGS_PANEL}},
    {id: 'finish', chapter: 20, stage: 'example', tab: 'code'}
]);

const CHAPTER_COUNT = STEPS[STEPS.length - 1].chapter;

const MESSAGES = Object.freeze({en, ja});

const isJapanese = locale => typeof locale === 'string' && /^ja(\b|-|$)/.test(locale);

/**
 * Texts for the tutorial in the editor's language (Japanese for ja / ja-Hira, English otherwise).
 * @param {string} locale Editor locale.
 * @returns {object} Messages: {ui: {...}, steps: {[id]: {title, body}}}.
 */
const getTutorialMessages = locale => MESSAGES[isJapanese(locale) ? 'ja' : 'en'];

const getStepIndex = id => {
    const index = STEPS.findIndex(step => step.id === id);
    return index < 0 ? 0 : index;
};

export {
    CHAPTER_COUNT,
    RENDER_SETTINGS_PANEL,
    REQUIRED_PLUGINS,
    STEPS,
    getStepIndex,
    getTutorialMessages,
    isJapanese
};
