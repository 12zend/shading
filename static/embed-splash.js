/* eslint-env browser */
const splash = document.getElementById('splash-need-js');
splash.hidden = false;
window.SplashEnd = () => {
    splash.hidden = true;
};
