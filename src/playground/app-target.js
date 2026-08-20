import ReactDOM from 'react-dom';
import {setAppElement} from 'react-modal';

const appTarget = document.getElementById('app');

// Remove everything from the target to fix macOS Safari "Save Page As",
while (appTarget.firstChild) {
    appTarget.removeChild(appTarget.firstChild);
}

setAppElement(appTarget);

const render = children => {
    const renderApp = () => {
        ReactDOM.render(children, appTarget);

        if (window.SplashEnd) {
            window.SplashEnd();
        }
    };
    if (window.ShadingTeamReady && typeof window.ShadingTeamReady.then === 'function') {
        window.ShadingTeamReady.then(renderApp, renderApp);
    } else {
        renderApp();
    }
};

export default render;
