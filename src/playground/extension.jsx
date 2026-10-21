// Entry for the TurboWarp extension build (BUILD_MODE=extension). Every page shares this one
// script; the extension host sets SHADING_EXTENSION_PAGE before loading it.
/* eslint-disable global-require */

const page = window.SHADING_EXTENSION_PAGE;
if (page === 'install') {
    require('./install.jsx');
} else if (page === 'addons') {
    require('./addon-settings.jsx');
} else {
    require('./editor.jsx');
}
