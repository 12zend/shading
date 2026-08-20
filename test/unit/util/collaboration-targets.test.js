import {
    describeCollaborationTarget,
    resolveCollaborationTarget
} from '../../../src/lib/collaboration-targets';

const makeTarget = (id, name, isStage = false) => ({
    getName: () => name,
    id,
    isOriginal: true,
    isStage
});

describe('collaboration targets', () => {
    test('resolves a target after project loading regenerated its local id', () => {
        const stage = makeTarget('local-stage', 'Stage', true);
        const sprite = makeTarget('local-sprite', 'Sprite 1');
        const runtime = {
            getTargetById: jest.fn(id => [stage, sprite].find(target => target.id === id)),
            getTargetForStage: jest.fn(() => stage),
            targets: [stage, sprite]
        };

        expect(resolveCollaborationTarget(runtime, {
            id: 'remote-sprite',
            index: 1,
            isStage: false,
            name: 'Sprite 1'
        }, 'remote-sprite')).toBe(sprite);
    });

    test('describes targets without relying only on a participant-local id', () => {
        const stage = makeTarget('stage-id', 'Stage', true);
        const sprite = makeTarget('sprite-id', 'Actor');
        const runtime = {targets: [stage, sprite]};

        expect(describeCollaborationTarget(runtime, sprite)).toEqual({
            id: 'sprite-id',
            index: 1,
            isStage: false,
            name: 'Actor'
        });
    });

    test('uses the stage identity before stale ids or indexes', () => {
        const stage = makeTarget('new-stage', 'Stage', true);
        const sprite = makeTarget('new-sprite', 'Sprite');
        const runtime = {
            getTargetById: jest.fn(),
            getTargetForStage: jest.fn(() => stage),
            targets: [stage, sprite]
        };

        expect(resolveCollaborationTarget(runtime, {
            id: 'old-stage',
            index: 99,
            isStage: true,
            name: 'Old Stage'
        }, 'old-stage')).toBe(stage);
    });
});
