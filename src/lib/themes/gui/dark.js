// Shading "monitor" theme.
// Every grey comes from one 11-step zone ramp (z0 = black glass, z10 = paper white).
// Amber (accent) marks what is selected; REC red is reserved for running/recording.
const zone = [
    '#08090a', // z0  glass
    '#0e0f11', // z1  page
    '#141619', // z2  panel
    '#1b1d21', // z3  raised
    '#24272c', // z4  control
    '#30343a', // z5  control hover / strong rule
    '#464b53', // z6  disabled ink, scrollbar
    '#6b7079', // z7  quiet ink (non-text / large only)
    '#9a9ea5', // z8  secondary ink
    '#c9cbcf', // z9  primary ink
    '#eceae5' // z10 emphasis ink
];

const guiColors = {
    'color-scheme': 'dark',

    'zone-0': zone[0],
    'zone-1': zone[1],
    'zone-2': zone[2],
    'zone-3': zone[3],
    'zone-4': zone[4],
    'zone-5': zone[5],
    'zone-6': zone[6],
    'zone-7': zone[7],
    'zone-8': zone[8],
    'zone-9': zone[9],
    'zone-10': zone[10],

    'rail-background': zone[0],
    'rail-hover': zone[3],
    'rail-ink': zone[8],
    'rail-ink-strong': zone[10],
    'rail-icon-filter': 'grayscale(100%) brightness(1.9) contrast(0.85)',
    'rail-icon-filter-selected': 'grayscale(100%) brightness(2.4)',

    'rec': '#ff3b30',
    'rec-transparent': '#ff3b3033',
    'rule': '#eceae514',
    'rule-strong': '#eceae526',

    'ui-primary': zone[1],
    'ui-secondary': zone[2],
    'ui-tertiary': zone[3],

    'ui-modal-overlay': '#000000b8',
    'ui-modal-background': zone[2],
    'ui-modal-foreground': zone[9],
    'ui-modal-header-background': zone[1],
    'ui-modal-header-foreground': zone[10],

    'ui-white': zone[2],
    'ui-white-dim': '#141619bf',
    'ui-white-transparent': '#eceae50f',
    'ui-transparent': '#14161900',

    'ui-black-transparent': '#eceae51a',

    'text-primary': zone[9],
    'text-primary-transparent': zone[8],

    'error-primary': '#ff6a3d',
    'error-light': '#ff9a7a',
    'error-transparent': '#ff6a3d40',

    'menu-bar-background': zone[0],
    'menu-bar-background-image': 'none',
    'menu-bar-foreground': zone[9],

    'assets-background': zone[1],

    'input-background': zone[0],

    'popover-background': zone[3],

    'shadow': '#00000099',

    'badge-background': '#2a2008',
    'badge-border': '#5a4410',

    'fullscreen-background': zone[0],
    'fullscreen-accent': zone[0],

    'page-background': zone[1],
    'page-foreground': zone[9],

    'project-title-inactive': 'transparent',
    'project-title-hover': zone[3],

    'link-color': '#ffc453',

    'filter-icon-black': 'invert(92%)',
    'filter-icon-gray': 'grayscale(100%) brightness(1.6)',
    'filter-icon-white': 'brightness(0) invert(88%)',

    'paint-filter-icon-gray': 'brightness(1.6)'
};

const blockColors = {
    insertionMarker: zone[8],
    workspace: zone[2],
    toolboxSelected: zone[3],
    toolboxText: zone[8],
    toolbox: zone[1],
    flyout: zone[1],
    scrollbar: zone[6],
    valueReportBackground: zone[3],
    valueReportBorder: zone[5],
    valueReportForeground: zone[10],
    contextMenuBackground: zone[3],
    contextMenuBorder: '#eceae51a',
    contextMenuForeground: zone[9],
    contextMenuActiveBackground: zone[5],
    contextMenuDisabledForeground: zone[6],
    flyoutLabelColor: zone[8],
    checkboxInactiveBackground: zone[4],
    checkboxInactiveBorder: zone[7],
    buttonBorder: zone[6],
    buttonActiveBackground: zone[4],
    buttonForeground: zone[9],
    zoomIconFilter: 'invert(80%)',
    gridColor: zone[4]
};

export {
    guiColors,
    blockColors
};
