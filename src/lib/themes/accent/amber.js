// Shading's default accent: the amber of a monitor's "selected" marker.
// Ink on amber is dark; see 'accent-foreground'.
const guiColors = {
    'motion-primary': '#ffb020',
    'motion-primary-transparent': '#ffb020e6',
    'motion-tertiary': '#d68f0a',

    'looks-secondary': '#ffb020',
    'looks-transparent': '#ffb02059',
    'looks-light-transparent': '#ffb02024',
    'looks-secondary-dark': '#d68f0a',
    // Paint tool glyphs are monochrome instrumentation; amber stays on the selected tool's key.
    'paint-accent-icon-filter': 'grayscale(100%) brightness(0.72)',

    'accent-foreground': '#1a1200',

    'extensions-primary': '#ffb020',
    'extensions-tertiary': '#d68f0a',
    'extensions-transparent': '#ffb02059',
    'extensions-light': '#3a2a08',

    'drop-highlight': '#ffcf6b'
};

const blockColors = {
    checkboxActiveBackground: '#ffb020',
    checkboxActiveBorder: '#d68f0a'
};

export {
    guiColors,
    blockColors
};
