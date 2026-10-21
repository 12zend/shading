import engineVersions from '../../../engine-versions.json';
import {SHADING_PROJECT_VERSION} from '../../../src/lib/project-format';
import {
    CURRENT_ENGINE_VERSION,
    findEngineForVersion,
    getEngineURL,
    resetEngineVersionsCache,
    validateEngineVersions
} from '../../../src/lib/engine-versions';

const deployedList = {
    current: '1.1.0',
    versions: [
        {version: '1.0.0', name: 'Shading 1.0.0', commit: 'd537729b05c8f122c1941b22082f8a31176b7ad5'},
        {version: '1.1.0', name: 'Shading 1.1.0', commit: '0123456789abcdef0123456789abcdef01234567'}
    ]
};

describe('engine-versions.json', () => {
    test('lists the version this build saves files as', () => {
        expect(engineVersions.current).toBe(SHADING_PROJECT_VERSION);
        expect(CURRENT_ENGINE_VERSION).toBe(SHADING_PROJECT_VERSION);
    });

    test('names every version once with a version name and commit id', () => {
        const versions = engineVersions.versions.map(entry => entry.version);
        expect(new Set(versions).size).toBe(versions.length);
        for (const entry of engineVersions.versions) {
            expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(typeof entry.name).toBe('string');
            expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
        }
        expect(validateEngineVersions(engineVersions)).not.toBeNull();
    });
});

describe('engine lookup', () => {
    let originalLocation;
    let originalFetch;

    beforeEach(() => {
        originalLocation = global.location;
        originalFetch = global.fetch;
        resetEngineVersionsCache();
    });

    afterEach(() => {
        global.location = originalLocation;
        global.fetch = originalFetch;
        resetEngineVersionsCache();
    });

    test('rejects malformed lists', () => {
        expect(validateEngineVersions(null)).toBeNull();
        expect(validateEngineVersions({current: '1.0.0', versions: []})).toBeNull();
        expect(validateEngineVersions({current: '1.0.0', versions: [{version: '1.0.0', commit: 'nope'}]}))
            .toBeNull();
    });

    test('serves the current version at the site root and older ones under engines/', () => {
        const list = validateEngineVersions(deployedList);

        expect(getEngineURL(list, '1.1.0')).toBe('/');
        expect(getEngineURL(list, '1.0.0')).toBe('/engines/1.0.0/');
        expect(getEngineURL(list, '0.9.0')).toBeNull();
    });

    test('finds another listed engine from the deployed list', async () => {
        global.location = {protocol: 'https:', href: 'https://shading.app/'};
        global.fetch = jest.fn(() => Promise.resolve({ok: true, json: () => Promise.resolve(deployedList)}));

        await expect(findEngineForVersion('1.1.0')).resolves.toEqual({
            version: '1.1.0',
            name: 'Shading 1.1.0',
            url: '/'
        });
        expect(global.fetch).toHaveBeenCalledWith('/engine-versions.json', {cache: 'no-cache'});
        await expect(findEngineForVersion(CURRENT_ENGINE_VERSION)).resolves.toBeNull();
        await expect(findEngineForVersion('0.9.0')).resolves.toBeNull();
        await expect(findEngineForVersion(null)).resolves.toBeNull();
    });

    test('falls back to the bundled list when the deployed one cannot be read', async () => {
        global.location = {protocol: 'https:', href: 'https://shading.app/'};
        global.fetch = jest.fn(() => Promise.reject(new Error('offline')));

        await expect(findEngineForVersion('1.1.0')).resolves.toBeNull();
    });

    test('never switches outside a hosted site', async () => {
        global.location = {protocol: 'file:', href: 'file:///shading/index.html'};
        global.fetch = jest.fn();

        await expect(findEngineForVersion('1.1.0')).resolves.toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
