// Shading's default accent: Apple system blue.
// Fills use a blue deep enough to carry white labels (4.6:1); ink on blue is white.
const guiColors = {
    'motion-primary': '#0071e3',
    'motion-primary-transparent': '#0071e3e6',
    'motion-tertiary': '#0062c4',

    'looks-secondary': '#0071e3',
    'looks-transparent': '#0a84ff73',
    'looks-light-transparent': '#0a84ff24',
    'looks-secondary-dark': '#0062c4',
    // Paint tool glyphs stay monochrome, like SF Symbols; blue marks only the selected tool.
    'paint-accent-icon-filter': 'grayscale(100%) brightness(0.72)',

    'accent-foreground': '#ffffff',

    'extensions-primary': '#0071e3',
    'extensions-tertiary': '#0062c4',
    'extensions-transparent': '#0a84ff59',
    'extensions-light': '#0a84ff24',

    'drop-highlight': '#409cff'
};

const blockColors = {
    checkboxActiveBackground: '#0071e3',
    checkboxActiveBorder: '#0062c4'
};

export {
    guiColors,
    blockColors
};
