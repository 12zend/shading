import {
    calculateAnimationValue,
    calculateLoopValue,
    calculatePingPongValue,
    calculateWiggleValue,
    evaluateAngleCurve,
    evaluateBezierPath,
    evaluateColorCurve,
    evaluateNumberCurve,
    evaluateStepCurve,
    evaluateTimeScopes,
    getAnimationProgress,
    getObjectTime,
    interpolateAngle,
    interpolateColor,
    isTimeWithin,
    posterizeTime
} from '../../../src/lib/object-animation';
import {
    ANIMATION_EASING_TYPES,
    calculateEasingProgress,
    normalizeEasingType
} from '../../../src/lib/movie-easing';

describe('Objects animation values', () => {
    test('provides the shared animation easing language including the requested examples', () => {
        expect(ANIMATION_EASING_TYPES).toEqual(expect.arrayContaining([
            'Linear', 'ExpoOut', 'BackOut'
        ]));
        expect(normalizeEasingType('Expo Out')).toBe('ExpoOut');
        expect(calculateEasingProgress('Linear', 0.25)).toBe(0.25);
        expect(calculateEasingProgress('Back Out', 0.75)).toBeGreaterThan(1);
    });

    test('animates any numeric value against explicit timeline bounds', () => {
        const options = {from: -300, to: 0, start: 0.5, end: 1.5, easing: 'Linear'};
        expect(calculateAnimationValue(options, 0)).toBe(-300);
        expect(calculateAnimationValue(options, 1)).toBe(-150);
        expect(calculateAnimationValue(options, 2)).toBe(0);
        expect(getAnimationProgress({start: 0.5, end: 1.5, easing: 'Linear'}, 1)).toBe(0.5);
    });

    test('loops and ping-pongs deterministically when seeking in either direction', () => {
        expect(calculateLoopValue(0, 100, 2, 0.5)).toBe(25);
        expect(calculateLoopValue(0, 100, 2, 2.5)).toBe(25);
        expect(calculateLoopValue(0, 100, 2, -0.5)).toBe(75);
        expect(calculatePingPongValue(0, 100, 2, 0.5)).toBe(50);
        expect(calculatePingPongValue(0, 100, 2, 1)).toBe(100);
        expect(calculatePingPongValue(0, 100, 2, 1.5)).toBe(50);
    });

    test('wiggle is smooth, seeded, bounded, and independent of evaluation history', () => {
        const first = calculateWiggleValue(2, 20, 7, 1.25);
        const repeated = calculateWiggleValue(2, 20, 7, 1.25);
        const differentSeed = calculateWiggleValue(2, 20, 8, 1.25);
        expect(repeated).toBe(first);
        expect(Math.abs(first)).toBeLessThanOrEqual(20);
        expect(differentSeed).not.toBe(first);
        expect(calculateWiggleValue(0, 20, 7, 1.25)).toBe(0);
    });

    test('reads deterministic timeline time and applies a component time offset', () => {
        const runtime = {movieAssetManager: {timeline: {currentTime: 4.25}}};
        const util = {thread: {objectTimeOffset: 0.75}};
        expect(getObjectTime(runtime, util)).toBe(3.5);
    });

    test('falls back to the Scratch timer outside a Movie timeline', () => {
        const util = {
            ioQuery: jest.fn(() => 2.5),
            thread: {objectTimeOffset: 0.5}
        };
        expect(getObjectTime({}, util)).toBe(2);
        expect(util.ioQuery).toHaveBeenCalledWith('clock', 'projectTimer');
    });

    test('reports ranges and posterized timeline samples', () => {
        expect(isTimeWithin(2, 1, 3)).toBe(true);
        expect(isTimeWithin(4, 1, 3)).toBe(false);
        expect(isTimeWithin(2, 3, 1)).toBe(true);
        expect(posterizeTime(1.099, 10)).toBe(1);
        expect(posterizeTime(1.1, 10)).toBe(1.1);
        expect(posterizeTime(10, 0)).toBe(0);
    });

    test('interpolates colors and chooses the shortest angle path', () => {
        expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(interpolateColor('#f00', '#00f', 0.5)).toBe('#800080');
        expect(interpolateAngle(350, 10, 0.5)).toBe(360);
        expect(interpolateAngle(10, 350, 0.5)).toBe(0);
    });

    test('composes deterministic local-time scopes without evaluation history', () => {
        const scopes = [
            {type: 'range', start: 2},
            {type: 'scale', scale: 0.5},
            {type: 'loop', duration: 2}
        ];
        expect(evaluateTimeScopes(5, scopes)).toBe(1.5);
        expect(evaluateTimeScopes(9, scopes)).toBe(1.5);
        expect(evaluateTimeScopes(5, [{type: 'reverse', duration: 8}])).toBe(3);
        expect(evaluateTimeScopes(5, [{type: 'freeze', time: 1.25}])).toBe(1.25);
        expect(evaluateTimeScopes(1.5, [{type: 'remap', map: '0:0; 1:0.8; 2:0.2'}])).toBeCloseTo(0.5);
    });

    test('evaluates named curve values directly from local time', () => {
        expect(evaluateNumberCurve('0:0; 1:100', 0.25)).toBe(25);
        expect(evaluateColorCurve('0:#000000; 1:#ffffff', 0.5)).toBe('#808080');
        expect(evaluateAngleCurve('0:350; 1:10', 0.5)).toBe(360);
        expect(evaluateStepCurve('0:one; 1:two', 0.999)).toBe('one');
        expect(evaluateStepCurve('0:one; 1:two', 1)).toBe('two');
    });

    test('evaluates connected cubic Bezier segments from space-separated Scratch list values', () => {
        const path = '0 0 0 100 100 100 100 0 100 -100 200 -100 200 0';

        expect(evaluateBezierPath(path, 'x', 0)).toBe(0);
        expect(evaluateBezierPath(path, 'x', 0.5)).toBe(50);
        expect(evaluateBezierPath(path, 'y', 0.5)).toBe(75);
        expect(evaluateBezierPath(path, 'x', 1)).toBe(100);
        expect(evaluateBezierPath(path, 'x', 1.5)).toBe(150);
        expect(evaluateBezierPath(path, 'y', 1.5)).toBe(-75);
        expect(evaluateBezierPath(path, 'x', 2)).toBe(200);
    });

    test('accepts array path values and clamps malformed or out-of-range input safely', () => {
        const path = [[0, 10], [0, 20], [30, 20], [30, 10]];

        expect(evaluateBezierPath(path, 'y', -1)).toBe(10);
        expect(evaluateBezierPath(path, 'x', 10)).toBe(30);
        expect(evaluateBezierPath('4 5', 'x', 0.5)).toBe(4);
        expect(evaluateBezierPath('', 'x', 0.5)).toBe(0);
    });
});
