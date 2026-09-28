const guiColors = {
    'color-scheme': 'light',

    'zone-0': '#ffffff',
    'zone-1': '#f5f4f1',
    'zone-2': '#efeeea',
    'zone-3': '#e6e5e1',
    'zone-4': '#dcdad5',
    'zone-5': '#c9c7c1',
    'zone-6': '#a3a19b',
    'zone-7': '#6b7079',
    'zone-8': '#4f545c',
    'zone-9': '#24272c',
    'zone-10': '#0e0f11',

    'rec': '#e0281e',
    'rec-transparent': '#e0281e26',
    'rule': '#0e0f1114',
    'rule-strong': '#0e0f1126',

    'accent-foreground': '#ffffff',

    // The OSD strip and page rail stay black glass in every theme.
    'osd-glass': '#08090a',
    'osd-field': '#0e0f11',
    'osd-hover': '#24272c',
    'osd-rule': '#eceae51f',
    'osd-ink': '#eceae5',
    'osd-ink-dim': '#9a9ea5',
    'osd-ink-quiet': '#6b7079',
    'rail-background': '#e6e5e1',
    'rail-hover': '#dcdad5',
    'rail-ink': '#4f545c',
    'rail-ink-strong': '#0e0f11',
    'rail-icon-filter': 'grayscale(100%) brightness(0.45)',
    'rail-icon-filter-selected': 'grayscale(100%) brightness(0)',

    'ui-primary': '#e6e5e1',
    'ui-secondary': '#efeeea',
    'ui-tertiary': '#dcdad5',

    'ui-modal-overlay': '#14161999',
    'ui-modal-background': 'hsla(0, 100%, 100%, 1)', /* #FFFFFF */
    'ui-modal-foreground': '#24272c',
    'ui-modal-header-background': '#e6e5e1',
    'ui-modal-header-foreground': '#0e0f11',

    'ui-white': 'hsla(0, 100%, 100%, 1)', /* #FFFFFF */
    'ui-white-dim': 'hsla(0, 100%, 100%, 0.75)', /* 25% transparent version of ui-white */
    'ui-white-transparent': 'hsla(0, 100%, 100%, 0.25)', /* 25% transparent version of ui-white */
    'ui-transparent': 'hsla(0, 100%, 100%, 0)', /* 25% transparent version of ui-white */

    'ui-black-transparent': 'hsla(0, 0%, 0%, 0.15)', /* 15% transparent version of black */

    'text-primary': '#24272c',
    'text-primary-transparent': '#4f545c',

    'motion-primary': 'hsla(215, 100%, 65%, 1)', /* #4C97FF */
    'motion-primary-transparent': 'hsla(215, 100%, 65%, 0.9)', /* 90% transparent version of motion-primary */
    'motion-tertiary': 'hsla(215, 60%, 50%, 1)', /* #3373CC */

    'looks-secondary': 'hsla(260, 60%, 60%, 1)', /* #855CD6 */
    'looks-transparent': 'hsla(260, 60%, 60%, 0.35)', /* 35% transparent version of looks-tertiary */
    'looks-light-transparent': 'hsla(260, 60%, 60%, 0.15)', /* 15% transparent version of looks-tertiary */
    'looks-secondary-dark': 'hsla(260, 42%, 51%, 1)', /* #714EB6 */

    'red-primary': 'hsla(20, 100%, 55%, 1)', /* #FF661A */
    'red-tertiary': 'hsla(20, 100%, 45%, 1)', /* #E64D00 */

    'sound-primary': 'hsla(300, 53%, 60%, 1)', /* #CF63CF */
    'sound-tertiary': 'hsla(300, 48%, 50%, 1)', /* #BD42BD */

    'control-primary': 'hsla(38, 100%, 55%, 1)', /* #FFAB19 */

    'data-primary': 'hsla(30, 100%, 55%, 1)', /* #FF8C1A */

    'pen-primary': 'hsla(163, 85%, 40%, 1)', /* #0FBD8C */
    'pen-transparent': 'hsla(163, 85%, 40%, 0.25)', /* #0FBD8C */
    'pen-tertiary': 'hsla(163, 86%, 30%, 1)', /* #0B8E69 */

    'error-primary': 'hsla(30, 100%, 55%, 1)', /* #FF8C1A */
    'error-light': 'hsla(30, 100%, 70%, 1)', /* #FFB366 */
    'error-transparent': 'hsla(30, 100%, 55%, 0.25)', /* #FF8C1A */

    'extensions-primary': 'hsla(163, 85%, 40%, 1)', /* #0FBD8C */
    'extensions-tertiary': 'hsla(163, 85%, 30%, 1)', /* #0B8E69 */
    'extensions-transparent': 'hsla(163, 85%, 40%, 0.35)', /* 35% transparent version of extensions-primary */
    'extensions-light': 'hsla(163, 57%, 85%, 1)', /* opaque version of extensions-transparent, on white bg */

    'drop-highlight': 'hsla(215, 100%, 77%, 1)', /* lighter than motion-primary */

    'menu-bar-background': '#08090a',
    'menu-bar-background-image': 'none',
    'menu-bar-foreground': '#c9cbcf',

    'assets-background': '#ffffff',

    'input-background': '#ffffff',

    'popover-background': '#ffffff',

    'shadow': 'hsla(0, 0%, 0%, 0.15)',

    'badge-background': '#dbebff',
    'badge-border': '#b9d6ff',

    'fullscreen-background': '#ffffff',
    'fullscreen-accent': '#e8edf1',

    'page-background': '#ffffff',
    'page-foreground': '#000000',

    'project-title-inactive': 'transparent',
    'project-title-hover': '#24272c',

    'link-color': '#2255dd',

    'filter-icon-black': 'none',
    'filter-icon-gray': 'grayscale(100%)',
    'filter-icon-white': 'none',

    'paint-ui-pane-border': 'var(--ui-black-transparent)',
    'paint-text-primary': 'var(--text-primary)',
    'paint-form-border': 'var(--ui-black-transparent)',
    'paint-looks-secondary': 'var(--looks-secondary)',
    'paint-looks-transparent': 'var(--looks-transparent)',
    'paint-input-background': 'var(--input-background)',
    'paint-popover-background': 'var(--popover-background)',
    'paint-filter-icon-gray': 'none'
};

const blockColors = {};

export {
    guiColors,
    blockColors
};
