/* global Scratch */
// TurboWarp extension that replaces the page with shading.app. build-extension.cjs fills in the
// placeholders with the bundled app, its pages and its static files.
//
// The pages run in iframes made from blob: URLs. They get a fresh JavaScript realm (TurboWarp's own
// GUI and VM stay out of the way), and they keep turbowarp.org's origin, so they can use the blob:
// URLs created here and the browser storage that preamble.js namespaces.
(Scratch => {
    const VERSION = __SHADING_VERSION__;
    const EXTENSION_ID = 'shadingapp';
    const COLORS = {color1: '#ffb020', color2: '#e69a00', color3: '#cc8800'};

    if (typeof document === 'undefined' || !Scratch.extensions.unsandboxed) {
        // A sandboxed extension runs in a worker and cannot touch the page.
        Scratch.extensions.register({
            getInfo: () => ({
                id: EXTENSION_ID,
                name: 'shading.app',
                ...COLORS,
                blocks: [{
                    blockType: Scratch.BlockType.LABEL,
                    text: 'Load this file with "Run extension without sandbox" checked.'
                }]
            })
        });
        return;
    }

    let state = window.__shadingAppExtension;
    if (!state || state.version !== VERSION) {
        if (state && state.root) state.root.remove();
        const pages = __SHADING_PAGES__;
        const appURL = URL.createObjectURL(
            new Blob([__SHADING_APP_SOURCE__], {type: 'text/javascript;charset=utf-8'})
        );
        const pageURLs = {};
        state = window.__shadingAppExtension = {
            version: VERSION,
            files: __SHADING_FILES__,
            root: null,
            main: null,
            popup: null,
            pageURL: (name, hash) => {
                if (!pageURLs[name]) {
                    const html = pages[name].split('__SHADING_APP_URL__').join(appURL);
                    pageURLs[name] = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'}));
                }
                return pageURLs[name] + (hash ? `#${hash}` : '');
            }
        };
    }

    const makeFrame = (name, hash) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('allow', [
            'fullscreen', 'clipboard-read', 'clipboard-write', 'autoplay', 'camera', 'microphone',
            'display-capture', 'gamepad', 'screen-wake-lock'
        ].join('; '));
        frame.setAttribute('allowfullscreen', '');
        frame.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#1c1c1e;';
        frame.src = state.pageURL(name, hash);
        frame.addEventListener('load', () => frame.focus());
        return frame;
    };

    const navigate = (frame, url) => {
        if (frame.contentWindow.location.href === url) frame.contentWindow.location.reload();
        else frame.src = url;
    };

    const closePopup = () => {
        if (state.popup) {
            state.popup.remove();
            state.popup = null;
        }
        if (state.main) state.main.focus();
    };

    // Pages that the site opens in a new tab (plugin installer, addon settings) appear over the editor.
    const openPopup = (name, hash) => {
        closePopup();
        const popup = document.createElement('div');
        popup.style.cssText = 'position:absolute;inset:24px;display:flex;flex-direction:column;' +
            'border-radius:8px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.6);background:#1c1c1e;';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;justify-content:flex-end;padding:4px;background:#2c2c2e;';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Close';
        close.style.cssText = 'width:32px;height:28px;border:0;border-radius:4px;background:transparent;' +
            'color:#e0e0e5;font-size:20px;line-height:1;cursor:pointer;';
        close.addEventListener('click', closePopup);
        bar.appendChild(close);
        const frame = makeFrame(name, hash);
        frame.style.flex = '1';
        frame.style.height = 'auto';
        popup.appendChild(bar);
        popup.appendChild(frame);
        state.root.appendChild(popup);
        state.popup = popup;
    };

    // Called by preamble.js for links and window.open() calls to the site's own pages.
    state.openPage = (name, {hash, newWindow, from}) => {
        const popupFrame = state.popup && state.popup.querySelector('iframe');
        const fromPopup = Boolean(popupFrame) && from === popupFrame.contentWindow;
        if (name === 'editor' && fromPopup) {
            // "Open the editor" in the installer: reload the editor so it loads the new plugins.
            closePopup();
            navigate(state.main, state.pageURL('editor'));
        } else if (name === 'editor' && newWindow) {
            // The editor is already open.
        } else if (newWindow) {
            openPopup(name, hash);
        } else {
            navigate(fromPopup ? popupFrame : state.main, state.pageURL(name, hash));
        }
    };

    state.setTitle = title => {
        if (title) document.title = title;
    };

    const launch = () => {
        if (state.root && state.root.isConnected) {
            state.root.style.display = '';
            if (state.main) state.main.focus();
            return;
        }
        try {
            Scratch.vm.stopAll();
            Scratch.vm.quit();
        } catch (error) {
            // Older TurboWarp versions: the hidden project keeps its last frame.
        }
        for (let child = document.body.firstElementChild; child; child = child.nextElementSibling) {
            child.style.display = 'none';
        }
        const root = document.createElement('div');
        root.id = 'shading-app-extension';
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1c1c1e;';
        state.root = root;
        state.main = makeFrame('editor');
        root.appendChild(state.main);
        document.body.appendChild(root);
        document.documentElement.style.overflow = 'hidden';
        document.title = 'shading.app';
    };

    Scratch.extensions.register({
        getInfo: () => ({
            id: EXTENSION_ID,
            name: 'shading.app',
            ...COLORS,
            blocks: [{
                blockType: Scratch.BlockType.BUTTON,
                func: 'open',
                text: 'Open shading.app'
            }]
        }),
        open: launch
    });

    // Let TurboWarp finish registering (and close its dialog) before the page is replaced.
    setTimeout(launch, 0);
})(Scratch);
