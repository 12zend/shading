import defaultProjectGenerator from '../../../src/lib/default-project/index.js';

describe('defaultProject', () => {
    // This test ensures that the assets referenced in the default project JSON
    // do not get out of sync with the raw assets that are included alongside.
    // see https://github.com/LLK/scratch-gui/issues/4844
    test('assets referenced by the project are included', () => {
        const translatorFn = () => '';
        const defaultProject = defaultProjectGenerator(translatorFn);
        const includedAssetIds = defaultProject.map(obj => obj.id);
        const projectData = JSON.parse(defaultProject[0].data);
        projectData.targets.forEach(target => {
            target.costumes.forEach(costume => {
                expect(includedAssetIds.includes(costume.assetId)).toBe(true);
            });
            target.sounds.forEach(sound => {
                expect(includedAssetIds.includes(sound.assetId)).toBe(true);
            });
        });
    });

    test('a new project starts with a render-frame hat in its sprite', () => {
        const projectData = JSON.parse(defaultProjectGenerator(() => '')[0].data);
        const sprite = projectData.targets.find(target => !target.isStage);
        const scripts = Object.values(sprite.blocks).filter(block => block.topLevel);
        expect(scripts).toHaveLength(1);
        expect(scripts[0]).toMatchObject({opcode: 'event_renderframe', next: null, parent: null});
    });
});
