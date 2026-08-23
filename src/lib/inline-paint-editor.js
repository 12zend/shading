import React from 'react';
import ReactDOM from 'react-dom';
import {Provider} from 'react-redux';

import PaintEditorWrapper from '../containers/paint-editor-wrapper.jsx';
import ConnectedIntlProvider from './connected-intl-provider.jsx';
import {initializeScratchPaint} from './tw-scratch-paint';

const getAppStore = () => (
    typeof window === 'undefined' ? null : window.ReduxStore
);

const mountInlinePaintEditor = (container, selectedCostumeIndex, onCostumeRenamed) => {
    const store = getAppStore();
    if (!container || !store) return false;
    store.dispatch(initializeScratchPaint());

    ReactDOM.render(React.createElement(
        Provider,
        {store},
        React.createElement(
            ConnectedIntlProvider,
            null,
            React.createElement(PaintEditorWrapper, {
                selectedCostumeIndex,
                onCostumeRenamed
            })
        )
    ), container);
    return true;
};

const unmountInlinePaintEditor = container => {
    if (container) ReactDOM.unmountComponentAtNode(container);
};

export {
    mountInlinePaintEditor,
    unmountInlinePaintEditor
};
