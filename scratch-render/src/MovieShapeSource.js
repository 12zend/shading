// Procedural source generation belongs to the renderer, including scene-plane sources.
const BITMAP_RESOLUTION = 2;
const toNumber = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const SHAPE_TYPES = ['polygon', 'star', 'curved star', 'flower'];
const PROCEDURAL_SHAPE_TYPES = SHAPE_TYPES.concat(['arc', 'circular segment', 'line']);
const MAX_SHAPE_SIZE = 4096;
const MAX_SHAPE_BITMAP_PIXELS = 1024 * 1024;
const SHAPE_RADIUS_SCALE = 0.5;
const DEFAULT_SHAPE_RATIO = 0.5;
const MAX_CACHED_SHAPE_SKINS = 256;
const MAX_CACHED_SHAPE_SKIN_PIXELS = 4096 * 4096;

const normalizeShapeType = value => {
    const shape = String(value || '').toLowerCase();
    return PROCEDURAL_SHAPE_TYPES.includes(shape) ? shape : SHAPE_TYPES[0];
};

const normalizeShapeRatio = value => clamp(toNumber(value, DEFAULT_SHAPE_RATIO), 0, 1);

const getShapeBitmapCacheKey = configuration => {
    const shape = normalizeShapeType(configuration.shape);
    const color = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    const opacity = clamp(toNumber(configuration.opacity, 100), 0, 100);
    if (shape === 'line') {
        const point1 = configuration.position1 || {};
        const point2 = configuration.position2 || {};
        return JSON.stringify([
            shape,
            toNumber(point2.x) - toNumber(point1.x),
            toNumber(point2.y) - toNumber(point1.y),
            Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5))),
            color,
            opacity
        ]);
    }

    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    const ratio = shape === 'star' || shape === 'curved star' || shape === 'flower' ?
        normalizeShapeRatio(configuration.ratio) : null;
    const angle = configuration.angle || {};
    return JSON.stringify([
        shape,
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.width, 100))))),
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.height, 100))))),
        Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6))))),
        outerRadius,
        innerRadius,
        ratio,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.start, 0) : 0,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.end, 360) : 360,
        color,
        opacity
    ]);
};

const createLineBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const point1 = configuration.position1 || {};
    const point2 = configuration.position2 || {};
    const thickness = Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5)));
    const padding = thickness / 2;
    const width = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.x) - toNumber(point1.x)) + (padding * 2)
    )));
    const height = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.y) - toNumber(point1.y)) + (padding * 2)
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;
    canvas.width = width;
    canvas.height = height;
    const deltaX = toNumber(point2.x) - toNumber(point1.x);
    const deltaY = toNumber(point2.y) - toNumber(point1.y);
    context.clearRect(0, 0, width, height);
    context.beginPath();
    // Scratch's world coordinates grow upward while a canvas bitmap's pixel coordinates grow downward.
    // Flip only the local bitmap Y coordinate so the scene transform can keep using Scratch coordinates.
    // Center around the endpoint midpoint, including any extra pixels from rounding the canvas size.
    context.moveTo((width - deltaX) / 2, (height + deltaY) / 2);
    context.lineTo((width + deltaX) / 2, (height - deltaY) / 2);
    context.lineWidth = thickness;
    context.strokeStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.stroke();
    // Line geometry is already measured in Scratch units, unlike 2x costume bitmaps.
    canvas.movieBitmapResolution = 1;
    canvas.reusable = false;
    return canvas;
};

const createShapeBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const requestedWidth = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.width, 100))
    )));
    const requestedHeight = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.height, 100))
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;

    const shape = normalizeShapeType(configuration.shape);
    if (shape === 'line') return null;
    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    const ratio = shape === 'star' || shape === 'curved star' || shape === 'flower' ?
        normalizeShapeRatio(configuration.ratio) : null;
    // Keep radius in the same coordinate system as the block's default 100px outer radius. The bitmap grows
    // when a larger radius is requested instead of normalizing every shape back to the requested dimensions.
    const scale = SHAPE_RADIUS_SCALE;
    const diameter = Math.max(2, Math.ceil(outerRadius * scale * 2));
    const logicalBitmapWidth = Math.max(requestedWidth, diameter);
    const logicalBitmapHeight = Math.max(requestedHeight, diameter);
    // Very large canvases are disproportionately expensive to clear, rasterize and upload to WebGL. Render the
    // same geometry into a bounded texture and lower its bitmap resolution so Scratch Render keeps the original
    // logical size. Using one uniform factor preserves circles and the shape's aspect ratio; limiting area instead
    // of each axis also keeps thin shapes sharp without allocating unnecessary pixels.
    const bitmapScale = Math.min(
        1,
        Math.sqrt(MAX_SHAPE_BITMAP_PIXELS / (
            logicalBitmapWidth * logicalBitmapHeight * BITMAP_RESOLUTION * BITMAP_RESOLUTION
        ))
    );
    const bitmapResolution = BITMAP_RESOLUTION * bitmapScale;
    const width = Math.max(2, Math.round(logicalBitmapWidth * bitmapResolution));
    const height = Math.max(2, Math.round(logicalBitmapHeight * bitmapResolution));
    canvas.width = width;
    canvas.height = height;
    canvas.movieBitmapResolution = bitmapResolution;
    const centerX = width / 2;
    const centerY = height / 2;
    const sides = Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6)))));
    const pointCount = shape === 'polygon' ? sides : shape === 'flower' ? Math.max(24, sides * 12) : sides * 2;

    const radiusAt = (radiusValue, angle) => {
        if (shape === 'polygon') return radiusValue;
        if (shape === 'star' || shape === 'curved star') {
            return angle % 2 === 0 ? radiusValue : radiusValue * ratio;
        }
        const petal = (Math.cos((angle / pointCount) * sides * Math.PI * 2) + 1) / 2;
        return radiusValue * (ratio + ((1 - ratio) * Math.pow(petal, 0.45)));
    };

    const drawPath = (count, distanceAt, reverse = false) => {
        for (let index = 0; index < count; index++) {
            const pathIndex = reverse ? count - index - 1 : index;
            const angle = (-Math.PI / 2) + ((pathIndex / count) * Math.PI * 2);
            const distance = distanceAt(pathIndex) * scale * bitmapResolution;
            const x = centerX + (Math.cos(angle) * distance);
            const y = centerY + (Math.sin(angle) * distance);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();
    };

    const drawCurvedStarPath = (radiusValue, reverse = false) => {
        const pointAt = pointIndex => {
            const normalizedIndex = (pointIndex + pointCount) % pointCount;
            const angle = (-Math.PI / 2) + ((normalizedIndex / pointCount) * Math.PI * 2);
            const distance = radiusAt(radiusValue, normalizedIndex) * scale * bitmapResolution;
            return {
                x: centerX + (Math.cos(angle) * distance),
                y: centerY + (Math.sin(angle) * distance)
            };
        };
        const start = pointAt(0);
        context.moveTo(start.x, start.y);
        for (let index = 0; index < sides; index++) {
            const outerIndex = reverse ? ((sides - index) % sides) * 2 : index * 2;
            const nextOuterIndex = reverse ?
                (outerIndex - 2 + pointCount) % pointCount : (outerIndex + 2) % pointCount;
            const controlIndex = reverse ?
                (nextOuterIndex + 1) % pointCount : outerIndex + 1;
            const control = pointAt(controlIndex);
            const next = pointAt(nextOuterIndex);
            context.quadraticCurveTo(control.x, control.y, next.x, next.y);
        }
        context.closePath();
    };

    context.clearRect(0, 0, width, height);
    context.beginPath();
    if (shape === 'arc' || shape === 'circular segment') {
        const angle = configuration.angle || {};
        const start = (toNumber(angle.start, 0) - 90) * Math.PI / 180;
        const end = (toNumber(angle.end, 360) - 90) * Math.PI / 180;
        // Keep the endpoints unwrapped so their order describes the sweep direction.
        const anticlockwise = end < start;
        const outerStartX = centerX + (Math.cos(start) * outerRadius * scale * bitmapResolution);
        const outerStartY = centerY + (Math.sin(start) * outerRadius * scale * bitmapResolution);
        context.moveTo(outerStartX, outerStartY);
        context.arc(centerX, centerY, outerRadius * scale * bitmapResolution, start, end, anticlockwise);
        if (shape === 'arc') {
            if (innerRadius > 0) {
                context.arc(centerX, centerY, innerRadius * scale * bitmapResolution, end, start, !anticlockwise);
            } else {
                // An arc with no inner radius is a sector. Closing the path directly between the two outer
                // endpoints would instead turn it into the circular-segment primitive.
                context.lineTo(centerX, centerY);
            }
        } else {
            context.lineTo(outerStartX, outerStartY);
        }
    } else if (shape === 'curved star') {
        drawCurvedStarPath(outerRadius);
        if (innerRadius > 0) drawCurvedStarPath(innerRadius, true);
    } else {
        drawPath(pointCount, angle => radiusAt(outerRadius, angle));
        if (innerRadius > 0) drawPath(pointCount, angle => radiusAt(innerRadius, angle), true);
    }
    context.fillStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.fill('evenodd');
    canvas.reusable = false;
    return canvas;
};

module.exports = {
    normalizeShapeRatio,
    createLineBitmap,
    createShapeBitmap,
    getShapeBitmapCacheKey,
    normalizeShapeType,
    MAX_CACHED_SHAPE_SKINS,
    MAX_CACHED_SHAPE_SKIN_PIXELS
};
