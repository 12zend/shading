import {getInitialRole, useSessionIdentity} from '../../../src/lib/collaboration-manager';
import {
    ensureTeamId,
    getTeamIdFromPath,
    getTeamPath,
    normalizeTeamId,
    randomTeamId,
    wasTeamCreatedInSession
} from '../../../src/lib/team-route';

describe('team route', () => {
    beforeEach(() => {
        const makeStorage = () => {
            const values = new Map();
            return {
                clear: () => values.clear(),
                getItem: key => values.has(key) ? values.get(key) : null,
                setItem: (key, value) => values.set(key, String(value))
            };
        };
        global.location = {
            hash: '',
            host: 'localhost:8601',
            origin: 'http://localhost:8601',
            pathname: '/',
            protocol: 'http:',
            search: ''
        };
        global.history = {
            replaceState: (state, title, path) => {
                const url = new URL(path, global.location.origin);
                global.location.hash = url.hash;
                global.location.pathname = url.pathname;
                global.location.search = url.search;
            }
        };
        global.localStorage = makeStorage();
        global.sessionStorage = makeStorage();
    });

    test('creates a persistent team path at the site root', () => {
        const teamId = ensureTeamId();

        expect(global.location.pathname).toBe(`/${teamId}`);
        expect(getTeamIdFromPath()).toBe(teamId);
        expect(wasTeamCreatedInSession(teamId)).toBe(true);
        expect(getInitialRole(teamId)).toBe('admin');
    });

    test('does not treat an existing team URL as newly created', () => {
        global.history.replaceState(null, '', '/existing-team');

        expect(ensureTeamId()).toBe('existing-team');
        expect(wasTeamCreatedInSession('existing-team')).toBe(false);
        expect(getInitialRole('existing-team')).toBe('viewer');
    });

    test('uses a tab-scoped identity when an invite is opened', () => {
        expect(useSessionIdentity('existing-team')).toBe(false);
        expect(useSessionIdentity('existing-team', 'one-use-invite')).toBe(true);
        expect(getInitialRole('existing-team', true)).toBe('viewer');

        global.sessionStorage.setItem('movie:collaboration:role:existing-team', 'member');
        expect(getInitialRole('existing-team', true)).toBe('member');
    });

    test('normalizes and validates team IDs', () => {
        expect(normalizeTeamId('  Team-123  ')).toBe('team-123');
        expect(normalizeTeamId('editor')).toBe(null);
        expect(normalizeTeamId('bad/id')).toBe(null);
        expect(getTeamPath('Team-123')).toBe('/team-123');
    });

    test('generates hard-to-guess URL-safe IDs', () => {
        const ids = new Set(Array.from({length: 100}, randomTeamId));

        expect(ids.size).toBe(100);
        for (const id of ids) expect(id).toMatch(/^[a-z2-9]{20}$/);
    });
});
