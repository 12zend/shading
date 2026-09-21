const BITMAP_RESOLUTION = 2;
const TEXT_BITMAP_RESOLUTION = 4;
const MAX_TEXT_CANVAS_CACHE = 1024;
const MAX_TEXT_CANVAS_PIXELS = 16 * 1024 * 1024;
const TEXT_FONT_SIZE = 96;
const TEXT_PADDING = 16;
const TEXT_LINE_HEIGHT = Math.round(TEXT_FONT_SIZE * 1.2);
const TEXT_RENDER_SCALE = TEXT_BITMAP_RESOLUTION / BITMAP_RESOLUTION;
const getTextCacheKey = (font, text) => `${font.name}\0${font.family}\0${text}`;

class MovieTextSource {
    createTextCanvas (font, text, cacheKey = null) {
        if (!(this.textCanvasCache instanceof Map)) {
            this.textCanvasCache = new Map();
            this.textCanvasCachePixels = 0;
        }
        const stringText = typeof text === 'string' ? text : String(text);
        const key = cacheKey || getTextCacheKey(font, stringText);
        const cached = this.textCanvasCache.get(key);
        if (cached) {
            this.textCanvasCache.delete(key);
            this.textCanvasCache.set(key, cached);
            return cached.canvas;
        }
        const baseFontSize = TEXT_FONT_SIZE * TEXT_RENDER_SCALE;
        const basePadding = TEXT_PADDING * TEXT_RENDER_SCALE;
        const baseLineHeight = TEXT_LINE_HEIGHT * TEXT_RENDER_SCALE;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const fontDeclaration = `${baseFontSize}px ${font.family}`;
        context.font = fontDeclaration;
        // Fast single-line path avoids the regex split and the spread allocation used previously.
        // Multi-line texts use an explicit loop instead of map+spread to avoid stack growth.
        let lineCount = 1;
        let width = 2;
        let lines = null;
        if (stringText.indexOf('\n') === -1 && stringText.indexOf('\r') === -1) {
            width = Math.max(2, Math.ceil(context.measureText(stringText || ' ').width));
        } else {
            lines = stringText.split(/\r?\n/);
            lineCount = lines.length;
            for (let index = 0; index < lines.length; index++) {
                const lineWidth = Math.ceil(context.measureText(lines[index] || ' ').width);
                if (lineWidth > width) width = lineWidth;
            }
            if (width < 2) width = 2;
        }
        const requestedWidth = width + (basePadding * 2);
        const requestedHeight = Math.max(2, (baseLineHeight * lineCount) + (basePadding * 2));
        const maxEdge = 4096;
        let scale = 1;
        if (requestedWidth > maxEdge || requestedHeight > maxEdge ||
            (requestedWidth * requestedHeight) > MAX_TEXT_CANVAS_PIXELS) {
            const scaleX = maxEdge / requestedWidth;
            const scaleY = maxEdge / requestedHeight;
            const scaleArea = Math.sqrt(MAX_TEXT_CANVAS_PIXELS / (requestedWidth * requestedHeight));
            scale = Math.min(1, scaleX, scaleY, scaleArea);
        }
        const fontSize = baseFontSize * scale;
        const padding = basePadding * scale;
        const lineHeight = baseLineHeight * scale;
        canvas.width = Math.max(2, Math.ceil(requestedWidth * scale));
        canvas.height = Math.max(2, Math.ceil(requestedHeight * scale));
        canvas.movieBitmapResolution = TEXT_BITMAP_RESOLUTION * scale;
        context.font = `${fontSize}px ${font.family}`;
        context.fillStyle = '#000000';
        context.textBaseline = 'top';
        if (lines) {
            for (let index = 0; index < lines.length; index++) {
                context.fillText(lines[index], padding, padding + (index * lineHeight));
            }
        } else {
            context.fillText(stringText, padding, padding);
        }
        canvas.reusable = false;
        const pixels = canvas.width * canvas.height;
        this.textCanvasCache.set(key, {canvas, pixels});
        this.textCanvasCachePixels += pixels;
        while (this.textCanvasCache.size > MAX_TEXT_CANVAS_CACHE ||
            this.textCanvasCachePixels > MAX_TEXT_CANVAS_PIXELS) {
            const oldestKey = this.textCanvasCache.keys().next().value;
            const oldest = this.textCanvasCache.get(oldestKey);
            this.textCanvasCache.delete(oldestKey);
            this.textCanvasCachePixels -= oldest ? oldest.pixels : 0;
        }
        return canvas;
    }
}
module.exports = MovieTextSource;
