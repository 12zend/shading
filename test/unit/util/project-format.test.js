import {
    getMovieProjectFeatures,
    getProjectExtension,
    isMovieProject,
    markMovieProject
} from '../../../src/lib/project-format';
import sb3 from 'scratch-vm/src/serialization/sb3';

const block = (opcode, fields = {}) => ({
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields,
    shadow: false,
    topLevel: true
});

const project = blocks => ({
    targets: [{blocks}],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0'}
});

describe('Movie project format', () => {
    test('marks custom movie blocks in project.json without changing them', () => {
        const customBlock = block('looks_switchvideoto');
        const json = project({customBlock});

        markMovieProject(json);

        expect(json.targets[0].blocks.customBlock).toBe(customBlock);
        expect(json.mb3).toEqual({version: 1, features: ['movie-blocks']});
        expect(isMovieProject(json)).toBe(true);
    });

    test('round-trips custom opcodes and inputs through project.json block serialization', () => {
        const blocks = {
            command: {
                ...block('looks_settextfont'),
                inputs: {
                    FONT: {block: 'font', shadow: 'font'},
                    TEXT: {block: 'text', shadow: 'text'}
                }
            },
            font: {
                ...block('text', {TEXT: {value: 'Movie Sans'}}),
                id: 'font',
                parent: 'command',
                shadow: true,
                topLevel: false
            },
            text: {
                ...block('text', {TEXT: {value: 'hello'}}),
                id: 'text',
                parent: 'command',
                shadow: true,
                topLevel: false
            }
        };

        const [serialized] = sb3.serializeBlocks(blocks);
        const hydrated = sb3.deserializeBlocks(JSON.parse(JSON.stringify(serialized)));

        expect(hydrated.command.opcode).toBe('looks_settextfont');
        expect(hydrated.command.inputs.FONT.block).toBe(hydrated.command.inputs.FONT.shadow);
        expect(hydrated[hydrated.command.inputs.FONT.block].fields.TEXT.value).toBe('Movie Sans');
        expect(hydrated[hydrated.command.inputs.TEXT.block].fields.TEXT.value).toBe('hello');
    });

    test('recognizes custom values added to Scratch looks effect blocks', () => {
        const json = project({
            effect: block('looks_seteffectto', {EFFECT: ['GAUSSIANBLUR']})
        });

        expect(getMovieProjectFeatures(json)).toEqual(['graphic-effects']);
        markMovieProject(json);
        expect(json.mb3.features).toEqual(['graphic-effects']);
    });

    test('marks video descriptors as Movie-only project data', () => {
        const json = project({});
        json.movieVideos = [{name: 'clip', md5ext: 'asset.mp4'}];

        expect(getMovieProjectFeatures(json)).toEqual(['video-assets']);
    });

    test('keeps plain Scratch projects as sb3', () => {
        const runtime = {
            targets: [{blocks: {_blocks: {move: block('motion_movesteps')}}}]
        };

        expect(getProjectExtension(runtime)).toBe('sb3');
        expect(markMovieProject(project({move: block('motion_movesteps')})).mb3).toBeUndefined();
    });

    test('uses mb3 for hydrated custom blocks in the runtime', () => {
        const runtime = {
            targets: [{blocks: {_blocks: {
                text: block('looks_settextfont')
            }}}]
        };

        expect(getProjectExtension(runtime)).toBe('mb3');
    });
});
