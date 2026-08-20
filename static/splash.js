/* eslint-env browser */
const TEAM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TEAM_CLAIM_PREFIX = 'movie:team-claim:';
const TEAM_CREATED_PREFIX = 'movie:team-created:';

const prepareTeamRoute = async () => {
    const rootValue = document.body.getAttribute('data-splash-root') || '/';
    const rootPath = `/${rootValue.replace(/^\/+|\/+$/g, '')}${rootValue === '/' ? '' : '/'}`;
    const isEditor = document.body.getAttribute('data-splash-editor') === 'true';
    if (!isEditor || location.pathname !== rootPath) return;
    if (typeof crypto === 'undefined' || !crypto.getRandomValues || !crypto.subtle) return;

    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const claimToken = Array.from(secretBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    const encoded = new TextEncoder().encode(claimToken);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    let teamId = '';
    for (let index = 0; index < 20; index++) {
        teamId += TEAM_ALPHABET[digest[index] % TEAM_ALPHABET.length];
    }
    try {
        sessionStorage.setItem(`${TEAM_CLAIM_PREFIX}${teamId}`, claimToken);
        sessionStorage.setItem(`${TEAM_CREATED_PREFIX}${teamId}`, '1');
    } catch (error) {
        window.ShadingTeamClaim = {teamId, token: claimToken};
    }
    const prefix = rootPath === '/' ? '' : rootPath.replace(/\/$/, '');
    history.replaceState(null, '', `${prefix}/${teamId}${location.search}${location.hash}`);
};

window.ShadingTeamReady = prepareTeamRoute();

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
