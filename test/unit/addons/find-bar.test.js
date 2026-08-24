import {isSearchableEventBlock} from '../../../src/addons/addons/find-bar/userscript';

describe('find bar event indexing', () => {
    test('includes Movie hats', () => {
        expect(isSearchableEventBlock('event_initialize')).toBe(true);
        expect(isSearchableEventBlock('event_renderframe')).toBe(true);
        expect(isSearchableEventBlock('event_whenkeypressed')).toBe(true);
        expect(isSearchableEventBlock('motion_movesteps')).toBe(false);
    });
});
