// Shading dark theme: Apple's dark system greys.
// Every grey comes from one 11-step ramp (z0 = deepest, z10 = emphasis ink).
// System blue (accent) marks what is selected; system red is reserved for rendering.
const zone = [
    '#141416', // z0  deepest: stage surround, full screen
    '#1c1c1e', // z1  page, toolbox, flyout
    '#232325', // z2  panel: workspace, timeline, modals
    '#2c2c2e', // z3  raised: popovers, hover, fields
    '#3a3a3c', // z4  control
    '#48484a', // z5  control hover, scrollbar
    '#636366', // z6  disabled ink
    '#8e8e93', // z7  quiet ink (non-text / large only)
    '#a1a1a6', // z8  secondary ink
    '#e0e0e5', // z9  primary ink
    '#f5f5f7' // z10 emphasis ink
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

    'toolbar-background': '#2a2a2c',
    'toolbar-hover': '#ffffff14',
    'sidebar-background': '#1f1f21',
    'sidebar-selected': '#ffffff1a',
    'sidebar-ink': zone[8],
    'sidebar-ink-strong': zone[10],
    'sidebar-icon-filter': 'brightness(0) invert(66%)',
    'sidebar-icon-filter-selected': 'brightness(0) invert(96%)',
    'toolbar-icon-filter': 'brightness(0) invert(88%)',
    'segment-selected': '#636366',
    'menu-background': '#2c2c2ee6',
    'menu-rule': '#ffffff1f',
    'menu-edge': '#000000',

    'rec': '#ff453a',
    'rec-transparent': '#ff453a33',
    'rule': '#ffffff1a',
    'rule-strong': '#ffffff29',

    'ui-primary': zone[1],
    'ui-secondary': zone[2],
    'ui-tertiary': zone[3],

    'ui-modal-overlay': '#00000080',
    'ui-modal-background': zone[2],
    'ui-modal-foreground': zone[9],
    'ui-modal-header-background': zone[2],
    'ui-modal-header-foreground': zone[10],

    'ui-white': zone[2],
    'ui-white-dim': '#232325bf',
    'ui-white-transparent': '#ffffff0f',
    'ui-transparent': '#23232500',

    'ui-black-transparent': '#ffffff1a',

    'text-primary': zone[9],
    'text-primary-transparent': zone[8],

    'error-primary': '#ff9f0a',
    'error-light': '#ffc166',
    'error-transparent': '#ff9f0a40',

    'menu-bar-background': '#2a2a2c',
    'menu-bar-background-image': 'none',
    'menu-bar-foreground': zone[9],

    'assets-background': zone[1],

    'input-background': zone[3],

    'popover-background': zone[3],

    'shadow': '#0000008c',

    'badge-background': '#0a84ff24',
    'badge-border': '#0a84ff59',

    'fullscreen-background': zone[0],
    'fullscreen-accent': zone[0],

    'page-background': zone[1],
    'page-foreground': zone[9],

    'project-title-inactive': 'transparent',
    'project-title-hover': zone[3],

    'link-color': '#409cff',

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
    contextMenuBorder: '#ffffff1f',
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
