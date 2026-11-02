import VM from 'scratch-vm';

import installObjectBlocks from '../../../scratch-vm/src/lib/object-blocks';
import {calculateEasingValue} from '../../../scratch-vm/src/lib/movie-easing';
import {ShadingPluginManager} from '../../../src/lib/plugins/manager';
import {MemoryPluginStorage} from '../../../src/lib/plugins/storage';
import {hasOfficialPlugins, readPluginDirectory, requirePluginModule} from '../../helpers/official-plugins';

const describeWithPlugins = hasOfficialPlugins ? describe : describe.skip;

const DEFAULT_ARGS = {
    CHAR: '歌詞 ab',
    FONT: 'Zen Kaku Gothic New Bold',
    KANJI_FONT: 'Shippori Mincho Bold',
    RADIUS: 200,
    EASE: 'Expo',
    SPEED: 0,
    PX: 10,
    PY: 20,
    PZ: 480,
    SIZE: 100,
    DIRECTION: 'horizontal reading',
    TEXT_SIZE: 80,
    KANJI_SIZE: 100,
    SPACING: 0,
    T1: 0,
    T2: 1,
    INTERVAL: 0.5,
    CLIP: false,
    RANDOMNESS: 0,
    FPS: 12,
    SHAKE_SPEED: 0,
    SHAKE_X: 0,
    SHAKE_Y: 0
};

const loadLyricMotion = async () => {
    const vm = new VM();
    installObjectBlocks(vm);
    const draws = [];
    let time = 0;
    vm.runtime.movieAssetManager = {
        timeline: {currentTime: 0, framerate: 30},
        drawObject: (target, configuration) => draws.push(configuration)
    };
    Object.defineProperty(vm.runtime.movieAssetManager.timeline, 'currentTime', {get: () => time});
    const manager = new ShadingPluginManager(vm, {storage: new MemoryPluginStorage()});
    vm.shadingPlugins = manager;
    const record = manager.loadArchive(readPluginDirectory('lyric-motion'));
    if (record.state === 'error') throw new Error(record.error);
    await vm.extensionManager.refreshBlocks('objects');
    const run = (args = {}) => {
        draws.length = 0;
        const util = {target: {id: 'sprite'}, thread: {peekStack: () => 'block-1'}};
        const result = vm.runtime._primitives.objects_lyricMotion(Object.assign({}, DEFAULT_ARGS, args), util);
        return {result, draws: draws.slice()};
    };
    return {vm, manager, run, setTime: value => {
        time = value;
    }};
};

describeWithPlugins('Lyric Motion plugin', () => {
    const motion = requirePluginModule('lyric-motion', 'lib/motion.js');
    const helpers = {hash: text => Array.from(text).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7),
        easeValue: calculateEasingValue};

    test('adds the block to the Objects category and returns undefined in the same tick', async () => {
        const {vm, manager, run, setTime} = await loadLyricMotion();
        const info = vm.runtime._blockInfo.find(category => category.id === 'objects');
        const block = info.blocks.find(entry => entry.info.opcode === 'lyricMotion');
        expect(block).toBeTruthy();
        expect(Object.keys(block.info.arguments)).toEqual(Object.keys(DEFAULT_ARGS));
        expect(manager.getObjectsToolboxXML()).toContain('type="objects_lyricMotion"');

        setTime(10);
        const {result, draws} = run();
        expect(result).toBeUndefined();
        // Spaces are not drawn; kanji use the kanji font and size, other characters the font and text size.
        expect(draws.map(draw => draw.text)).toEqual(['歌', '詞', 'a', 'b']);
        expect(draws.map(draw => draw.asset)).toEqual([
            'Shippori Mincho Bold', 'Shippori Mincho Bold', 'Zen Kaku Gothic New Bold', 'Zen Kaku Gothic New Bold'
        ]);
        expect(draws.map(draw => draw.size)).toEqual([100, 100, 80, 80]);
        // After every character arrived they sit on one line around the position, left to right.
        expect(draws.every(draw => draw.position.y === 20 && draw.position.z === 480)).toBe(true);
        const xs = draws.map(draw => draw.position.x);
        expect(xs).toEqual(xs.slice().sort((a, b) => a - b));
        // Without a document, kanji are 48 wide at size 100 and the other characters half that (at text size 80).
        expect(((xs[0] - 24) + (xs[3] + 9.6)) / 2).toBeCloseTo(10, 6);
    });

    test('starts each character a time interval after the previous one and hides them before', async () => {
        const {run, setTime} = await loadLyricMotion();
        setTime(0.6);
        expect(run({CHAR: 'abc'}).draws.map(draw => draw.text)).toEqual(['a', 'b']);
        setTime(1.2);
        expect(run({CHAR: 'abc'}).draws.map(draw => draw.text)).toEqual(['a', 'b', 'c']);
        // With clip, a character disappears when its own time range ends.
        expect(run({CHAR: 'abc', CLIP: true}).draws.map(draw => draw.text)).toEqual(['b', 'c']);
    });

    test('flies in from radius at a random angle with the Out easing', () => {
        const glyph = {index: 0, x: 0, y: 0};
        const params = {radius: 100, ease: 'Power', speed: 0, start: 0, end: 1, interval: 0};
        const atStart = motion.glyphOffset(glyph, params, 0, helpers, 'seed');
        expect(Math.hypot(atStart.x, atStart.y)).toBeCloseTo(100, 6);
        // Power Out (power 2) at half time leaves a quarter of the distance.
        const half = motion.glyphOffset(glyph, params, 0.5, helpers, 'seed');
        expect(Math.hypot(half.x, half.y)).toBeCloseTo(25, 6);
        expect(half.x / half.y).toBeCloseTo(atStart.x / atStart.y, 6);
        expect(motion.glyphOffset(glyph, params, 1, helpers, 'seed')).toEqual({x: 0, y: 0});
        // The angle is stable for a block instance and differs between characters.
        expect(motion.glyphOffset(glyph, params, 0, helpers, 'seed')).toEqual(atStart);
        expect(motion.glyphOffset({index: 1, x: 0, y: 0}, params, 0, helpers, 'seed')).not.toEqual(atStart);
        // Elastic speed uses the easing block's oscillation, so speed 0 is the plain easing.
        const elastic = motion.glyphOffset(glyph, Object.assign({}, params, {speed: Math.PI}), 0.5, helpers, 'seed');
        const expected = 1 - calculateEasingValue(
            {type: 'PowerOut', v0: 0, v1: 1, t0: 0, t1: 1, power: 2, speed: Math.PI}, 0.5);
        expect(Math.hypot(elastic.x, elastic.y)).toBeCloseTo(Math.abs(expected) * 100, 6);
    });

    test('adds jitter that changes at the posterize fps and a shake from the timer', () => {
        const glyph = {index: 0, x: 0, y: 0};
        const base = {radius: 0, ease: 'Expo', start: 0, end: 1, interval: 0, randomness: 10, fps: 4};
        const a = motion.glyphOffset(glyph, base, 2.0, helpers, 'seed');
        const b = motion.glyphOffset(glyph, base, 2.2, helpers, 'seed');
        const c = motion.glyphOffset(glyph, base, 2.3, helpers, 'seed');
        expect(a).toEqual(b);
        expect(c).not.toEqual(a);
        expect(Math.abs(a.x)).toBeLessThanOrEqual(10);
        expect(Math.abs(a.y)).toBeLessThanOrEqual(10);
        const shake = motion.glyphOffset(glyph, {radius: 0, start: 0, end: 1, shakeSpeed: 2, shakeX: 5, shakeY: 3},
            3, helpers, 'seed');
        expect(shake.x).toBeCloseTo(Math.cos(6) * 5, 6);
        expect(shake.y).toBeCloseTo(Math.sin(6) * 3, 6);
    });

    test('reads vertically from top to bottom and turns long vowel marks', () => {
        const glyphs = motion.layoutLine({
            text: 'あー漢', font: 'f', kanjiFont: 'k', size: 100, textSize: 50, kanjiSize: 100, spacing: 10,
            direction: 'vertical reading', em: 48, measure: () => 0
        });
        expect(glyphs.map(glyph => glyph.x)).toEqual([0, 0, 0]);
        expect(glyphs[0].y).toBeGreaterThan(glyphs[1].y);
        expect(glyphs[1].y).toBeGreaterThan(glyphs[2].y);
        // 24 + 10 + 24 + 10 + 48 = 116 long, centered: the first character's center is 116 / 2 - 12 above.
        expect(glyphs[0].y).toBeCloseTo(46, 6);
        expect(glyphs.map(glyph => glyph.rotation)).toEqual([0, -90, 0]);
        expect(glyphs.map(glyph => glyph.font)).toEqual(['f', 'f', 'k']);
    });
});
