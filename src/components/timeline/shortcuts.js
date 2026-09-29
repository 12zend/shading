import bowser from 'bowser';

const isMac = () => Boolean(bowser.mac);

const modifierLabel = () => (isMac() ? '⌘' : 'Ctrl');

const withModifier = key => `${modifierLabel()}+${key}`;

// Normalises a keyboard event into a single lower-case key name so layouts that
// report shifted characters (for example "+" or "?") match the same shortcut.
const getShortcutKey = event => {
    if (event.key === ' ' || event.code === 'Space') return 'space';
    if (event.key && event.key !== 'Unidentified' && event.key !== 'Dead') {
        return event.key.length === 1 ? event.key.toLowerCase() : event.key;
    }
    const legacyKeys = {
        8: 'Backspace',
        27: 'Escape',
        35: 'End',
        36: 'Home',
        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',
        46: 'Delete'
    };
    return legacyKeys[event.keyCode] || '';
};

const isModifierPressed = event => (isMac() ? event.metaKey : event.ctrlKey);

const getShortcutGroups = () => [
    {
        title: 'Playback',
        items: [
            {keys: ['Space'], label: 'Play / pause'},
            {keys: ['Shift+Space'], label: 'Stop and return to start'},
            {keys: ['Home'], label: 'Go to start'},
            {keys: ['End'], label: 'Go to end'}
        ]
    },
    {
        title: 'Navigation',
        items: [
            {keys: ['←', '→'], label: 'Previous / next frame'},
            {keys: [',', '.'], label: 'Previous / next frame'},
            {keys: ['Shift+←', 'Shift+→'], label: 'Back / forward 1 second'},
            {keys: ['[', ']'], label: 'Previous / next keyframe'}
        ]
    },
    {
        title: 'Keyframes',
        items: [
            {keys: ['K'], label: 'Add keyframe at playhead'},
            {keys: ['Shift+K'], label: 'Delete selected keyframe'}
        ]
    },
    {
        title: 'View',
        items: [
            {keys: ['+', '−'], label: 'Zoom timeline in / out'},
            {keys: ['0'], label: 'Reset timeline zoom'},
            {keys: ['\\'], label: 'Fit whole timeline'}
        ]
    },
    {
        title: 'Project',
        items: [
            {keys: [withModifier('S')], label: 'Save project'},
            {keys: [withModifier('O')], label: 'Load project from your computer'},
            {keys: [withModifier('E')], label: 'Rendering settings / export'},
            {keys: [withModifier('Enter')], label: 'Render / export (in rendering settings)'},
            {keys: ['?'], label: 'Show keyboard shortcuts'},
            {keys: ['Esc'], label: 'Close panel'}
        ]
    }
];

export {
    getShortcutGroups,
    getShortcutKey,
    isModifierPressed,
    withModifier
};
