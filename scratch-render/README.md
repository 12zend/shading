# TurboWarp/scratch-render

scratch-render modified for use in [TurboWarp](https://turbowarp.org/). We've optimized some operations and added a lot of options.

## Setup

See https://github.com/TurboWarp/scratch-gui/wiki/Getting-Started to setup the complete TurboWarp environment.

If you just want to play with the render then it's the same process as upstream scratch-render.

## API

Public APIs are compatible with a vanilla scratch-render. TurboWarp/scratch-render is a drop-in replacement for scratch-render.

Notable public API additions include:

 - `renderer.setUseHighQualityRender(enabled: boolean)` toggles high quality rendering. A `UseHighQualityRenderChanged` event is emitted on the renderer when this is called. You can read the current setting with `renderer.useHighQualityRender` but don't try to directly modify this value.
 - `renderer.markSkinAsPrivate(skinID: number)` marks a skin as "private".
 - `renderer.allowPrivateSkinAccess` controls whether blocks like "touching color" can access "private" skins.
 - `renderer.offscreenTouching` controls whether collision blocks work offscreen.
 - Skins no longer extend EventEmitter
 - `RenderWebGL.powerPreference` can be set to change the WebGL powerPreference option for future RenderWebGL instances. (default, high-performance, or low-power)

## License

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

This program is based on [scratchfoundation/scratch-vm](https://github.com/scratchfoundation/scratch-vm), which is under this license:

```
Copyright (c) 2016, Massachusetts Institute of Technology
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

<!--

## scratch-render
#### WebGL-based rendering engine for Scratch 3.0

[![CircleCI](https://circleci.com/gh/LLK/scratch-render/tree/develop.svg?style=shield&circle-token=310da166a745295d515b3b90f3bad10f23b84405)](https://circleci.com/gh/LLK/scratch-render?branch=develop)

[![Greenkeeper badge](https://badges.greenkeeper.io/LLK/scratch-render.svg)](https://greenkeeper.io/)

## Installation
```bash
npm install https://github.com/LLK/scratch-render.git
```

## Setup
```html
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Scratch WebGL rendering demo</title>
    </head>

    <body>
        <canvas id="myStage"></canvas>
        <canvas id="myDebug"></canvas>
    </body>
</html>
```

```js
var canvas = document.getElementById('myStage');
var debug = document.getElementById('myDebug');

// Instantiate the renderer
var renderer = new require('scratch-render')(canvas);

// Connect to debug canvas
renderer.setDebugCanvas(debug);

// Start drawing
function drawStep() {
    renderer.draw();
    requestAnimationFrame(drawStep);
}
drawStep();

// Connect to worker (see "playground" example)
var worker = new Worker('worker.js');
renderer.connectWorker(worker);
```

## Standalone Build
```bash
npm run build
```

```html
<script src="/path/to/render.js"></script>
<script>
    var renderer = new window.RenderWebGLLocal();
    // do things
</script>
```

## Testing
```bash
npm test
```

## Donate
We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a [donation](https://secure.donationpay.org/scratchfoundation/) to support our continued engineering, design, community, and resource development efforts. Donations of any size are appreciated. Thank you!

-->