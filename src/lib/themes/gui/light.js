const guiColors = {
    'color-scheme': 'light',

    'zone-0': '#ffffff',
    'zone-1': '#f5f5f7',
    'zone-2': '#fbfbfd',
    'zone-3': '#ececf0',
    'zone-4': '#e3e3e8',
    'zone-5': '#d1d1d6',
    'zone-6': '#aeaeb2',
    'zone-7': '#8e8e93',
    'zone-8': '#6e6e73',
    'zone-9': '#2c2c2e',
    'zone-10': '#1d1d1f',

    'rec': '#ff3b30',
    'rec-transparent': '#ff3b3026',
    'rule': '#0000001a',
    'rule-strong': '#00000026',

    'accent-foreground': '#ffffff',

    'toolbar-background': '#f6f6f8',
    'toolbar-hover': '#0000000f',
    'sidebar-background': '#ededf0',
    'sidebar-selected': '#00000014',
    'sidebar-ink': '#6e6e73',
    'sidebar-ink-strong': '#1d1d1f',
    'sidebar-icon-filter': 'brightness(0) opacity(0.6)',
    'sidebar-icon-filter-selected': 'brightness(0) opacity(0.88)',
    'toolbar-icon-filter': 'brightness(0) opacity(0.75)',
    'segment-selected': '#ffffff',
    'menu-background': '#f6f6f8e6',
    'menu-rule': '#0000001a',
    'menu-edge': '#00000033',

    'ui-primary': '#f5f5f7',
    'ui-secondary': '#fbfbfd',
    'ui-tertiary': '#ececf0',

    'ui-modal-overlay': '#00000040',
    'ui-modal-background': 'hsla(0, 100%, 100%, 1)', /* #FFFFFF */
    'ui-modal-foreground': '#2c2c2e',
    'ui-modal-header-background': 'hsla(0, 100%, 100%, 1)',
    'ui-modal-header-foreground': '#1d1d1f',

    'ui-white': 'hsla(0, 100%, 100%, 1)', /* #FFFFFF */
    'ui-white-dim': 'hsla(0, 100%, 100%, 0.75)', /* 25% transparent version of ui-white */
    'ui-white-transparent': 'hsla(0, 100%, 100%, 0.25)', /* 25% transparent version of ui-white */
    'ui-transparent': 'hsla(0, 100%, 100%, 0)', /* 25% transparent version of ui-white */

    'ui-black-transparent': 'hsla(0, 0%, 0%, 0.15)', /* 15% transparent version of black */

    'text-primary': '#2c2c2e',
    'text-primary-transparent': '#6e6e73',

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

    'error-primary': '#c93400',
    'error-light': '#ff9500',
    'error-transparent': '#ff950040',

    'extensions-primary': 'hsla(163, 85%, 40%, 1)', /* #0FBD8C */
    'extensions-tertiary': 'hsla(163, 85%, 30%, 1)', /* #0B8E69 */
    'extensions-transparent': 'hsla(163, 85%, 40%, 0.35)', /* 35% transparent version of extensions-primary */
    'extensions-light': 'hsla(163, 57%, 85%, 1)', /* opaque version of extensions-transparent, on white bg */

    'drop-highlight': 'hsla(215, 100%, 77%, 1)', /* lighter than motion-primary */

    'menu-bar-background': '#f6f6f8',
    'menu-bar-background-image': 'none',
    'menu-bar-foreground': '#2c2c2e',

    'assets-background': '#ffffff',

    'input-background': '#ffffff',

    'popover-background': '#ffffff',

    'shadow': 'hsla(0, 0%, 0%, 0.15)',

    'badge-background': '#e5f0ff',
    'badge-border': '#b3d4ff',

    'fullscreen-background': '#ffffff',
    'fullscreen-accent': '#f5f5f7',

    'page-background': '#ffffff',
    'page-foreground': '#1d1d1f',

    'project-title-inactive': 'transparent',
    'project-title-hover': '#0000000f',

    'link-color': '#0066cc',

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
