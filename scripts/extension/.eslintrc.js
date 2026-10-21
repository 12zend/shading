module.exports = {
    // These files run in the browser: host.js in TurboWarp's page, preamble.js in each shading.app page.
    root: true,
    extends: ['scratch', 'scratch/es6'],
    env: {browser: true},
    globals: {
        __SHADING_APP_SOURCE__: 'readonly',
        __SHADING_FILES__: 'readonly',
        __SHADING_PAGE__: 'readonly',
        __SHADING_PAGES__: 'readonly',
        __SHADING_VERSION__: 'readonly'
    }
};
