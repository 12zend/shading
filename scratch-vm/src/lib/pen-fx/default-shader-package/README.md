# Built-in PenFX

This folder contains the built-in package manifest and translations. `index.js`
loads the editable shader modules directly from `scratch-render/src/pen-fx/shaders/`.
That source folder is shared with the renderer; no generated zip or rebuild script
is needed. Add program bindings and block metadata in `shading-shader.json` and
Japanese labels in `locales-ja.json`. External shader zip imports remain supported.
