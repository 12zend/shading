// Keep the editor's CSS size independent from its rendering buffer, including on HiDPI displays.
const installMoviePreviewRenderer = (renderer, manager) => {
    if (!renderer || typeof renderer.resize !== 'function' || renderer._moviePreviewInstalled) return;
    renderer._moviePreviewInstalled = true;
    const resize = renderer.resize.bind(renderer);
    renderer.resize = () => {
        const [stageWidth, stageHeight] = manager.getStageSize();
        const scale = manager.normalizePreviewScale(manager.timeline.previewScale);
        const exporting = Boolean(manager.previewRendererSize);
        const width = exporting ? manager.timeline.width : Math.max(1, Math.round(stageWidth * scale));
        const height = exporting ? manager.timeline.height : Math.max(1, Math.round(stageHeight * scale));
        const pixelRatio = manager.getRendererPixelRatio();
        resize(width / pixelRatio, height / pixelRatio);
    };
    // Scratch Render normally ties pen detail to the high-quality toggle. Movie's pen buffer must
    // instead follow the selected preview/export resolution, even when that toggle is off.
    if (typeof renderer._updateRenderQuality === 'function') {
        renderer._updateRenderQuality = () => {
            const skin = renderer._allSkins[renderer._penSkinId];
            if (skin) skin.setRenderQuality(renderer.canvas.width / renderer.getNativeSize()[0]);
            for (const drawable of renderer._allDrawables) {
                if (drawable) drawable.setHighQuality(renderer.useHighQualityRender);
            }
        };
    }
    renderer.resize();
};

export default installMoviePreviewRenderer;
