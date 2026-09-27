/**
 * @jest-environment jsdom
 */
import {detectLocale} from '../../../src/lib/detect-locale.js';

const supportedLocales = ['en', 'es', 'pt-br', 'de', 'it'];

// jsdom's location cannot be redefined; change the URL instead.
const setSearch = search => window.history.replaceState(null, '', `/${search}`);

setSearch('?name=val');
Object.defineProperty(window.navigator,
    'language',
    {value: 'en-US', configurable: true}
);

describe('detectLocale', () => {
    test('uses locale from the URL when present', () => {
        setSearch('?locale=pt-br');
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('is case insensitive', () => {
        setSearch('?locale=pt-BR');
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('also accepts lang from the URL when present', () => {
        setSearch('?lang=it');
        expect(detectLocale(supportedLocales)).toEqual('it');
    });

    test('ignores unsupported locales', () => {
        setSearch('?lang=sv');
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('ignores other parameters', () => {
        setSearch('?enable=language');
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('uses navigator language property for default if supported', () => {
        Object.defineProperty(window.navigator,
            'language',
            {value: 'pt-BR'}
        );
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('ignores navigator language property if unsupported', () => {
        Object.defineProperty(window.navigator,
            'language',
            {value: 'da'}
        );
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('works with an empty locale', () => {
        setSearch('?locale=');
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('if multiple, uses the first locale', () => {
        setSearch('?locale=de&locale=en');
        expect(detectLocale(supportedLocales)).toEqual('de');
    });
});
