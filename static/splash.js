/* eslint-env browser */
// Team routes (and their founding claim) are now created on demand by the
// collaboration panel instead of eagerly for every editor visit. Plain
// shading.app links stay collaboration-free until a link is generated.

let theme = '';
let accent = '#ff4c4c';
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
        if (parsed.accent === 'purple') accent = '#855cd6';
        if (parsed.accent === 'blue') accent = '#4c97ff';
        if (parsed.gui === 'dark' || parsed.gui === 'light') theme = parsed.gui;
    } catch (error) {
        // Ignore malformed legacy theme settings.
    }
}

if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const splash = document.querySelector('.spash-waiting-for-js');
splash.setAttribute('data-theme', theme);
if (theme !== 'dark') {
    if (document.body.getAttribute('data-splash-editor') === 'true') {
        splash.style.backgroundColor = accent;
        splash.style.color = 'white';
    } else {
        splash.style.color = accent;
    }
}
splash.hidden = false;

const splashErrorTitle = document.querySelector('.splash-error-title');
const splashError = document.querySelector('.splash-errors');
const splashReset = document.querySelector('.splash-reset');
let totalErrors = 0;

window.onerror = (event, source, line, col, error) => {
    totalErrors += 1;
    if (totalErrors > 5) return;
    splashErrorTitle.hidden = false;
    splashError.hidden = false;
    splashReset.hidden = false;
    const element = document.createElement('div');
    element.textContent = `Error (splash) in ${source} (${line}:${col}): ${error}`;
    splashError.appendChild(element);
};

splashReset.onclick = () => {
    splashReset.disabled = true;
    const hardRefresh = () => {
        const search = location.search.replace(/[?&]nocache=[\d.]+(?=$|&)/, '');
        document.cookie = 'tw_clear_cache_once=1; max-age=60; path=/; samesite=strict; secure';
        const separator = search ? '&' : '?';
        location.replace(`${location.pathname}${search}${separator}nocache=${Math.floor(Math.random() * 10000000)}`);
    };
    if ('serviceWorker' in navigator) {
        setTimeout(hardRefresh, 5000);
        navigator.serviceWorker.getRegistration(document.body.getAttribute('data-splash-root') || '/')
            .then(registration => {
                if (registration) return registration.unregister();
            })
            .then(hardRefresh)
            .catch(hardRefresh);
    } else {
        hardRefresh();
    }
};

window.SplashEnd = () => {
    splash.hidden = true;
    window.onerror = null;
};
