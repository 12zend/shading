/* eslint-env browser */
let theme = '';
let themeSetting;
try {
    themeSetting = localStorage.getItem('tw:theme');
} catch (error) {
    // Ignore browsers that disable local storage.
}
if (themeSetting === 'light' || themeSetting === 'dark') {
    theme = themeSetting;
} else if (themeSetting) {
    try {
        const parsed = JSON.parse(themeSetting);
        if (parsed.gui === 'dark' || parsed.gui === 'light') theme = parsed.gui;
    } catch (error) {
        // Ignore malformed legacy theme settings.
    }
}
if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.body.setAttribute('data-splash-theme', theme);
