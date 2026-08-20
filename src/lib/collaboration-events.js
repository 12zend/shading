const SHAREABLE_EVENT_TYPES = new Set([
    'create',
    'delete',
    'change',
    'move'
]);

const coordinateToString = coordinate => {
    if (!coordinate) return null;
    if (typeof coordinate === 'string') return coordinate;
    if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) return null;
    return `${Math.round(coordinate.x)}, ${Math.round(coordinate.y)}`;
};

const isPureCoordinateMove = event => (
    event && event.type === 'move' &&
    !event.oldParentId && !event.newParentId &&
    Boolean(event.oldCoordinate || event.newCoordinate)
);

const isShareableBlocklyEvent = event => (
    Boolean(event) &&
    SHAREABLE_EVENT_TYPES.has(event.type) &&
    event.recordUndo !== false
);

const serializeBlocklyEvent = (event, ScratchBlocks) => {
    if (!isShareableBlocklyEvent(event)) return null;
    const json = typeof event.toJson === 'function' ? event.toJson() : Object.assign({}, event);

    if (event.type === 'change') json.oldValue = event.oldValue;
    if (event.type === 'delete' && event.oldXml && ScratchBlocks) {
        json.oldXml = ScratchBlocks.Xml.domToText(event.oldXml);
    }
    if (event.type === 'move') {
        json.oldParentId = event.oldParentId || null;
        json.oldInputName = event.oldInputName || null;
        json.newParentId = event.newParentId || null;
        json.newInputName = event.newInputName || null;
        json.oldCoordinate = coordinateToString(event.oldCoordinate);
        json.newCoordinate = coordinateToString(event.newCoordinate);
    }
    return json;
};

const invertBlocklyEvent = event => {
    if (!event || !event.type) return null;
    const inverse = Object.assign({}, event);
    delete inverse.group;

    switch (event.type) {
    case 'create':
        inverse.type = 'delete';
        inverse.oldXml = event.xml;
        delete inverse.xml;
        break;
    case 'delete':
        if (!event.oldXml) return null;
        inverse.type = 'create';
        inverse.xml = event.oldXml;
        delete inverse.oldXml;
        break;
    case 'change':
        inverse.oldValue = event.newValue;
        inverse.newValue = event.oldValue;
        break;
    case 'move':
        inverse.oldParentId = event.newParentId || null;
        inverse.oldInputName = event.newInputName || null;
        inverse.oldCoordinate = event.newCoordinate || null;
        inverse.newParentId = event.oldParentId || null;
        inverse.newInputName = event.oldInputName || null;
        inverse.newCoordinate = event.oldCoordinate || null;
        break;
    default:
        return null;
    }
    return inverse;
};

const describeBlocklyEvent = event => {
    if (!event) return 'プロジェクトを変更';
    switch (event.type) {
    case 'create': return 'ブロックを追加';
    case 'delete': return 'ブロックを削除';
    case 'change': return 'ブロックの値を変更';
    case 'move': return 'ブロックの接続を変更';
    default: return 'プロジェクトを変更';
    }
};

export {
    SHAREABLE_EVENT_TYPES,
    describeBlocklyEvent,
    invertBlocklyEvent,
    isPureCoordinateMove,
    isShareableBlocklyEvent,
    serializeBlocklyEvent
};
