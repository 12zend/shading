import {
    invertBlocklyEvent,
    isPureCoordinateMove,
    isShareableBlocklyEvent,
    serializeBlocklyEvent
} from '../../../src/lib/collaboration-events';

describe('collaboration block events', () => {
    test('does not share a block position-only move', () => {
        const event = {
            newCoordinate: {x: 30, y: 40},
            oldCoordinate: {x: 10, y: 20},
            type: 'move'
        };

        expect(isPureCoordinateMove(event)).toBe(true);
        expect(isShareableBlocklyEvent(event)).toBe(false);
        expect(serializeBlocklyEvent(event)).toBe(null);
    });

    test('shares a structural block connection move', () => {
        const event = {
            blockId: 'block',
            newInputName: 'SUBSTACK',
            newParentId: 'new-parent',
            oldParentId: 'old-parent',
            recordUndo: true,
            toJson: () => ({blockId: 'block', type: 'move'}),
            type: 'move'
        };
        const serialized = serializeBlocklyEvent(event);

        expect(isShareableBlocklyEvent(event)).toBe(true);
        expect(serialized.newParentId).toBe('new-parent');
        expect(invertBlocklyEvent(serialized)).toMatchObject({
            newParentId: 'old-parent',
            oldParentId: 'new-parent',
            type: 'move'
        });
    });

    test('creates a reversible delete event with its original XML', () => {
        const ScratchBlocks = {
            Xml: {domToText: jest.fn(() => '<block id="block" />')}
        };
        const serialized = serializeBlocklyEvent({
            oldXml: {},
            recordUndo: true,
            toJson: () => ({blockId: 'block', type: 'delete'}),
            type: 'delete'
        }, ScratchBlocks);

        expect(invertBlocklyEvent(serialized)).toEqual(expect.objectContaining({
            type: 'create',
            xml: '<block id="block" />'
        }));
    });

    test('preserves the previous value when reversing a change', () => {
        const inverse = invertBlocklyEvent({
            element: 'field',
            name: 'TEXT',
            newValue: 'after',
            oldValue: 'before',
            type: 'change'
        });

        expect(inverse.oldValue).toBe('after');
        expect(inverse.newValue).toBe('before');
    });
});
