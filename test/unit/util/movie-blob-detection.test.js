import detectMovieBlobs, {drawMovieBlobOverlay} from '../../../src/lib/movie-blob-detection';

const frame = rows => {
    const width = rows[0].length;
    const data = new Uint8Array(width * rows.length * 4);
    rows.forEach((row, y) => {
        Array.from(row).forEach((pixel, x) => {
            const offset = ((y * width) + x) * 4;
            const colors = {
                '#': [255, 255, 255, 255],
                '.': [0, 0, 0, 255],
                'R': [255, 0, 0, 255],
                'T': [0, 0, 0, 0]
            };
            data.set(colors[pixel], offset);
        });
    });
    return {data, height: rows.length, width};
};

describe('Movie blob bounding boxes', () => {
    test('finds multiple four-connected regions and sorts the largest box first', () => {
        const boxes = detectMovieBlobs(frame([
            '##......',
            '##......',
            '.....#..',
            '.....#..'
        ]), {
            maximumSize: 100,
            minimumSize: 0,
            mode: 'bright',
            threshold: 200
        });

        expect(boxes).toHaveLength(2);
        expect(boxes[0]).toMatchObject({
            centerX: 1,
            centerY: 1,
            height: 2,
            id: 1,
            maximumX: 1,
            maximumY: 1,
            minimumX: 0,
            minimumY: 0,
            pixelArea: 4,
            width: 2
        });
        expect(boxes[1]).toMatchObject({id: 2, minimumX: 5, pixelArea: 2});
    });

    test('supports dark, color, alpha, and motion keying', () => {
        const current = frame([
            '#R.T',
            '....'
        ]);
        const before = frame([
            '#..T',
            '....'
        ]);

        expect(detectMovieBlobs(current, {mode: 'dark', threshold: 10})).toHaveLength(1);
        expect(detectMovieBlobs(current, {
            mode: 'color',
            targetColor: [1, 0, 0],
            threshold: 10
        })).toEqual([expect.objectContaining({minimumX: 1, minimumY: 0, pixelArea: 1})]);
        expect(detectMovieBlobs(current, {mode: 'alpha', threshold: 250})).toHaveLength(1);
        expect(detectMovieBlobs(current, {mode: 'motion', threshold: 10})).toEqual([]);
        expect(detectMovieBlobs(current, {mode: 'motion', threshold: 10}, before)).toEqual([
            expect.objectContaining({minimumX: 0, minimumY: 0, maximumX: 3, maximumY: 1})
        ]);
    });

    test('filters boxes by long-edge percentage of the frame', () => {
        const boxes = detectMovieBlobs(frame([
            '##......',
            '##......',
            '.....#..',
            '........'
        ]), {
            maximumSize: 100,
            minimumSize: 20,
            mode: 'bright',
            threshold: 200
        });

        expect(boxes).toHaveLength(1);
        expect(boxes[0]).toMatchObject({height: 2, width: 2});
    });

    test('draws a box, optional fill, and center marker over every detected region', () => {
        const source = frame([
            '........',
            '.###....',
            '.###....',
            '.###....',
            '.....##.',
            '.....##.',
            '........'
        ]);
        const boxes = detectMovieBlobs(source, {mode: 'bright', threshold: 200});
        const output = drawMovieBlobOverlay(source, boxes, {
            color: [0, 1, 1],
            fillOpacity: 0.25,
            marker: true,
            shape: 'rectangle',
            strokeOpacity: 1,
            strokeWidth: 1
        });

        expect(boxes).toHaveLength(2);
        const cyanOffset = ((1 * source.width) + 1) * 4;
        expect(Array.from(output.slice(cyanOffset, cyanOffset + 4))).toEqual([0, 255, 255, 255]);
        const untouchedOffset = ((0 * source.width) + 7) * 4;
        expect(Array.from(output.slice(untouchedOffset, untouchedOffset + 4))).toEqual([0, 0, 0, 255]);
    });
});
