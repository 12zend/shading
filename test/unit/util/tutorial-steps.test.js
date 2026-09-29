import en from '../../../src/lib/tutorial/locales/en.json';
import ja from '../../../src/lib/tutorial/locales/ja.json';
import {
    CHAPTER_COUNT,
    STEPS,
    getStepIndex,
    getTutorialMessages
} from '../../../src/lib/tutorial/tutorial-steps';
import {TUTORIAL_STAGES, buildStageBlocks, tutorialBlockId} from '../../../src/lib/tutorial/tutorial-blocks';
import {
    STATUS_ACTIVE,
    STATUS_COMPLETED,
    STORAGE_KEY,
    onTutorialRestart,
    readTutorialState,
    restartTutorial,
    shouldShowTutorial,
    writeTutorialState
} from '../../../src/lib/tutorial/tutorial-storage';

const TABS = ['code', 'costumes', 'sounds', 'videos', 'fonts', 'models', 'shaders', 'plugins'];

const collectText = body => body.flatMap(item => (typeof item === 'string' ? [item] : item.list));

describe('tutorial steps', () => {
    test('cover the twenty chapters in order', () => {
        expect(CHAPTER_COUNT).toBe(20);
        const chapters = STEPS.map(step => step.chapter);
        expect(new Set(chapters).size).toBe(20);
        chapters.forEach((chapter, index) => {
            if (index > 0) expect(chapter - chapters[index - 1]).toBeGreaterThanOrEqual(0);
            if (index > 0) expect(chapter - chapters[index - 1]).toBeLessThanOrEqual(1);
        });
        expect(new Set(STEPS.map(step => step.id)).size).toBe(STEPS.length);
    });

    test('use known stages and tabs, and never go back to an earlier stage', () => {
        let previous = 0;
        for (const step of STEPS) {
            const index = TUTORIAL_STAGES.indexOf(step.stage);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeGreaterThanOrEqual(previous);
            previous = index;
            expect(TABS).toContain(step.tab);
        }
    });

    test('point only at blocks that exist on their page', () => {
        for (const step of STEPS) {
            if (!step.highlight || !step.highlight.block) continue;
            const ids = buildStageBlocks(step.stage).map(block => block.id);
            expect(ids).toContain(tutorialBlockId(step.highlight.block));
        }
    });

    test('have English and Japanese texts for every page', () => {
        expect(Object.keys(ja.ui).sort()).toEqual(Object.keys(en.ui).sort());
        expect(Object.keys(ja.steps).sort()).toEqual(STEPS.map(step => step.id).sort());
        expect(Object.keys(en.steps).sort()).toEqual(STEPS.map(step => step.id).sort());
        for (const messages of [en, ja]) {
            for (const step of STEPS) {
                const text = messages.steps[step.id];
                expect(text.title).toEqual(expect.any(String));
                expect(text.body.length).toBeGreaterThan(0);
                for (const line of collectText(text.body)) {
                    expect(line).toEqual(expect.any(String));
                    // Markup must be balanced or it shows up as raw characters.
                    expect((line.match(/`/g) || []).length % 2).toBe(0);
                    expect((line.match(/\*\*/g) || []).length % 2).toBe(0);
                }
            }
        }
    });

    test('follow the editor language', () => {
        expect(getTutorialMessages('ja')).toBe(ja);
        expect(getTutorialMessages('ja-Hira')).toBe(ja);
        expect(getTutorialMessages('en')).toBe(en);
        expect(getTutorialMessages('de')).toBe(en);
        expect(getStepIndex('renderFrame')).toBe(1);
        expect(getStepIndex('unknown')).toBe(0);
    });
});

describe('tutorial progress', () => {
    beforeEach(() => {
        const values = new Map();
        global.localStorage = {
            getItem: key => (values.has(key) ? values.get(key) : null),
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        };
    });

    afterEach(() => {
        delete global.localStorage;
    });

    test('still shows the tutorial when storage is unavailable', () => {
        delete global.localStorage;
        expect(shouldShowTutorial()).toBe(true);
        expect(() => writeTutorialState({status: STATUS_COMPLETED})).not.toThrow();
    });

    test('is shown until it is finished or skipped', () => {
        expect(readTutorialState()).toEqual({status: STATUS_ACTIVE, step: null});
        expect(shouldShowTutorial()).toBe(true);
        writeTutorialState({status: STATUS_ACTIVE, step: 'camera'});
        expect(readTutorialState()).toEqual({status: STATUS_ACTIVE, step: 'camera'});
        writeTutorialState({status: STATUS_COMPLETED, step: 'finish'});
        expect(shouldShowTutorial()).toBe(false);
    });

    test('ignores broken saved data', () => {
        localStorage.setItem(STORAGE_KEY, '{broken');
        expect(shouldShowTutorial()).toBe(true);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({status: 'nonsense', step: 3}));
        expect(readTutorialState()).toEqual({status: STATUS_ACTIVE, step: null});
    });

    test('can be restarted from the menu', () => {
        writeTutorialState({status: STATUS_COMPLETED, step: 'finish'});
        const listener = jest.fn();
        const dispose = onTutorialRestart(listener);
        restartTutorial();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(readTutorialState()).toEqual({status: STATUS_ACTIVE, step: null});
        dispose();
        restartTutorial();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
