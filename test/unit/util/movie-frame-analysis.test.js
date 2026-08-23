import {analyzeMovieFrames} from '../../../src/lib/movie-frame-analysis';

const numberBlock = (id, value) => ({
    fields: {NUM: {value: String(value)}},
    id,
    inputs: {},
    next: null,
    opcode: 'math_number'
});

const makeBlocks = definitions => {
    const blocks = Object.fromEntries(definitions.map(block => [block.id, block]));
    return {
        _blocks: blocks,
        getBlock: id => blocks[id],
        getScripts: () => ['hat']
    };
};

describe('Movie frame analysis', () => {
    test('derives read-only ranges and warns about history-dependent blocks', () => {
        const blocks = makeBlocks([
            {id: 'hat', inputs: {}, next: 'range', opcode: 'event_renderframe'},
            {
                id: 'range',
                inputs: {
                    START: {block: 'start'},
                    END: {block: 'end'},
                    SUBSTACK: {block: 'change'}
                },
                next: null,
                opcode: 'objects_timeRange'
            },
            numberBlock('start', 2),
            numberBlock('end', 4),
            {id: 'change', inputs: {}, next: 'draw', opcode: 'data_changevariableby'},
            {
                fields: {ASSET: {value: 'costume:Title'}, SOURCE: {value: 'costume'}},
                id: 'draw',
                inputs: {T1: {block: 'draw-start'}, T2: {block: 'draw-end'}},
                next: null,
                opcode: 'objects_draw'
            },
            numberBlock('draw-start', 0),
            numberBlock('draw-end', 2)
        ]);
        const target = {
            blocks,
            getName: () => 'Main',
            id: 'sprite',
            isOriginal: true
        };
        const analysis = analyzeMovieFrames({targets: [target]}, {
            currentTime: 3,
            duration: 10,
            framerate: 30
        });

        expect(analysis.warnings).toEqual([expect.objectContaining({
            blockId: 'change',
            category: 'state',
            targetId: 'sprite'
        })]);
        expect(analysis.ranges).toEqual(expect.arrayContaining([
            expect.objectContaining({blockId: 'range', start: 2, end: 4}),
            expect.objectContaining({blockId: 'draw', start: 2, end: 4})
        ]));
    });

    test('maps nested offset and scale ranges back to global time', () => {
        const blocks = makeBlocks([
            {id: 'hat', inputs: {}, next: 'offset', opcode: 'event_renderframe'},
            {
                id: 'offset',
                inputs: {TIME: {block: 'offset-value'}, SUBSTACK: {block: 'scale'}},
                next: null,
                opcode: 'objects_timeOffset'
            },
            numberBlock('offset-value', 2),
            {
                id: 'scale',
                inputs: {SCALE: {block: 'scale-value'}, SUBSTACK: {block: 'draw'}},
                next: null,
                opcode: 'objects_timeScale'
            },
            numberBlock('scale-value', 0.5),
            {
                fields: {ASSET: {value: 'costume:Card'}},
                id: 'draw',
                inputs: {T1: {block: 'draw-start'}, T2: {block: 'draw-end'}},
                next: null,
                opcode: 'objects_draw'
            },
            numberBlock('draw-start', 0),
            numberBlock('draw-end', 1)
        ]);
        const target = {blocks, id: 'sprite', isOriginal: true};
        const analysis = analyzeMovieFrames({targets: [target]}, {duration: 10, framerate: 30});

        expect(analysis.ranges).toEqual([
            expect.objectContaining({blockId: 'draw', start: 2, end: 4})
        ]);
    });
});
