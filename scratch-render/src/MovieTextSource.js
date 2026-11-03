const BITMAP_RESOLUTION = 2;
// 2x supersampling over the 3 bitmap pixels per stage unit a 640x360 stage needs at 1920x1080.
const TEXT_BITMAP_RESOLUTION = 6;
const MAX_TEXT_CANVAS_CACHE = 1024;
const MAX_TEXT_CANVAS_PIXELS = 16 * 1024 * 1024;
const TEXT_FONT_SIZE = 96;
const TEXT_PADDING = 16;
const TEXT_LINE_HEIGHT = Math.round(TEXT_FONT_SIZE * 1.2);
const TEXT_RENDER_SCALE = TEXT_BITMAP_RESOLUTION / BITMAP_RESOLUTION;
const MAX_TEXT_ITALIC = 4;
// Italic is a horizontal shear: each pixel moves right by italic * (its height above the text bottom).
const normalizeTextItalic = italic => {
    const value = Number(italic);
    if (!Number.isFinite(value)) return 0;
    return Math.max(-MAX_TEXT_ITALIC, Math.min(MAX_TEXT_ITALIC, value));
};
const DEFAULT_TEXT_COLOR = '#000000';
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Text is filled with a hex color. Scratch colors may also arrive as RGB numbers; anything else falls back to black.
const normalizeTextColor = color => {
    if (typeof color === 'string') {
        const trimmed = color.trim();
        if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
        if (trimmed === '' || !Number.isFinite(Number(trimmed))) return DEFAULT_TEXT_COLOR;
        color = Number(trimmed);
    }
    if (typeof color !== 'number' || !Number.isFinite(color)) return DEFAULT_TEXT_COLOR;
    const rgb = Math.max(0, Math.min(0xffffff, Math.floor(color)));
    return `#${rgb.toString(16).padStart(6, '0')}`;
};
// Upright black text keeps its original key so existing caches and callers stay compatible.
const getTextCacheKey = (font, text, italic = 0, color = DEFAULT_TEXT_COLOR) => {
    let key = `${font.name}\0${font.family}\0${text}`;
    const normalizedItalic = normalizeTextItalic(italic);
    if (normalizedItalic) key = `${key}\0italic:${normalizedItalic}`;
    const normalizedColor = normalizeTextColor(color);
    return normalizedColor === DEFAULT_TEXT_COLOR ? key : `${key}\0color:${normalizedColor}`;
};

class MovieTextSource {
    createTextCanvas (font, text, cacheKey = null, italic = 0, color = DEFAULT_TEXT_COLOR) {
        if (!(this.textCanvasCache instanceof Map)) {
            this.textCanvasCache = new Map();
            this.textCanvasCachePixels = 0;
        }
        const stringText = typeof text === 'string' ? text : String(text);
        const italicShear = normalizeTextItalic(italic);
        const fillColor = normalizeTextColor(color);
        const key = cacheKey || getTextCacheKey(font, stringText, italicShear, fillColor);
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
        const baseSlant = Math.abs(italicShear) * baseLineHeight * lineCount;
        const requestedWidth = width + baseSlant + (basePadding * 2);
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
        const textBottom = padding + (lineHeight * lineCount);
        const slantOffset = italicShear < 0 ? baseSlant * scale : 0;
        canvas.width = Math.max(2, Math.ceil(requestedWidth * scale));
        canvas.height = Math.max(2, Math.ceil(requestedHeight * scale));
        canvas.movieBitmapResolution = TEXT_BITMAP_RESOLUTION * scale;
        context.font = `${fontSize}px ${font.family}`;
        context.fillStyle = fillColor;
        context.textBaseline = 'top';
        if (italicShear) {
            // x' = x + italic * (textBottom - y), so positive values lean the tops of glyphs to the right.
            context.setTransform(1, 0, -italicShear, 1, slantOffset + (italicShear * textBottom), 0);
        }
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
MovieTextSource.getTextCacheKey = getTextCacheKey;
MovieTextSource.normalizeTextItalic = normalizeTextItalic;
MovieTextSource.normalizeTextColor = normalizeTextColor;
module.exports = MovieTextSource;
