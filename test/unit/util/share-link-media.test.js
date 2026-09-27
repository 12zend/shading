import {
    getRecompressibleMedia,
    recompressProjectMedia,
    updateProjectMedia
} from '../../../src/lib/share-link/share-link-media';

const text = value => new TextEncoder().encode(value);
const json = bytes => JSON.parse(new TextDecoder().decode(bytes));

const SOUND = '0123456789abcdef0123456789abcdef.wav';
const COSTUME = '11111111111111111111111111111111.png';
const VECTOR = '22222222222222222222222222222222.svg';
const VIDEO = '33333333333333333333333333333333.mov';

const project = {
    targets: [{
        costumes: [
            {name: 'bitmap', assetId: COSTUME.split('.')[0], dataFormat: 'png', md5ext: COSTUME, bitmapResolution: 2},
            {name: 'vector', assetId: VECTOR.split('.')[0], dataFormat: 'svg', md5ext: VECTOR}
        ],
        sounds: [
            {name: 'beat', assetId: SOUND.split('.')[0], dataFormat: 'wav', format: 'adpcm', rate: 22050,
                sampleCount: 100, md5ext: SOUND},
            {name: 'again', assetId: SOUND.split('.')[0], dataFormat: 'wav', format: 'adpcm', rate: 22050,
                sampleCount: 100, md5ext: SOUND}
        ]
    }],
    movieVideos: [{name: 'clip', md5ext: VIDEO, mimeType: 'video/quicktime', width: 1920, height: 1080}],
    movieTimeline: {sound: SOUND.split('.')[0]}
};

const files = () => [
    {name: 'project.json', data: text(JSON.stringify(project))},
    {name: COSTUME, data: new Uint8Array(10)},
    {name: VECTOR, data: text('<svg/>')},
    {name: SOUND, data: new Uint8Array(20)},
    {name: VIDEO, data: new Uint8Array(30)}
];

describe('share link media recompression', () => {
    test('lists each costume, sound and video file once', () => {
        expect(getRecompressibleMedia(files())).toEqual([
            {name: COSTUME, kind: 'bitmap'},
            {name: VECTOR, kind: 'vector'},
            {name: SOUND, kind: 'sound'},
            {name: VIDEO, kind: 'video'}
        ]);
        expect(getRecompressibleMedia([{name: 'project.json', data: text('{')}])).toEqual([]);
        expect(getRecompressibleMedia(files().filter(file => file.name !== SOUND))
            .map(item => item.name)).not.toContain(SOUND);
    });

    test('points every reference at replaced files and fixes their formats', () => {
        const updated = json(updateProjectMedia(files()[0].data, new Map([
            [SOUND, {name: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp3', mimeType: null}],
            [COSTUME, {name: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', mimeType: null}],
            [VIDEO, {name: 'cccccccccccccccccccccccccccccccc.mp4', mimeType: 'video/mp4'}]
        ])));
        const [bitmap, vector] = updated.targets[0].costumes;
        expect(bitmap).toEqual({name: 'bitmap', assetId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', dataFormat: 'jpg',
            md5ext: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', bitmapResolution: 2});
        expect(vector).toEqual(project.targets[0].costumes[1]);
        for (const sound of updated.targets[0].sounds) {
            expect(sound).toEqual(Object.assign({}, project.targets[0].sounds[0], {
                name: sound.name,
                assetId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                dataFormat: 'mp3',
                format: '',
                md5ext: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp3'
            }));
        }
        expect(updated.movieVideos[0]).toEqual(Object.assign({}, project.movieVideos[0], {
            md5ext: 'cccccccccccccccccccccccccccccccc.mp4',
            mimeType: 'video/mp4'
        }));
        // Other references to an asset id follow it too.
        expect(updated.movieTimeline.sound).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    test('keeps the original quality untouched', async () => {
        const original = files();
        expect(await recompressProjectMedia(original, 'original')).toEqual({files: original, media: []});
    });

    test('shares media the browser cannot re-encode unchanged', async () => {
        // The test environment has no audio, image or video codecs, so every file is kept.
        const original = files();
        const progress = [];
        const result = await recompressProjectMedia(original, 'standard', event => progress.push(event));
        expect(result).toEqual({files: original, media: []});
        const last = progress[progress.length - 1];
        expect(last).toEqual({stage: 'media', done: 66, total: 66});
    });
});
