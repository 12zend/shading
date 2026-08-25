import bmpConverter from '../../../src/lib/bmp-converter';

describe('bmpConverter', () => {
    let createObjectURL;
    let revokeObjectURL;
    let createdImages;

    const makeCanvas = () => ({
        getContext: () => ({drawImage: jest.fn()}),
        toDataURL: () => 'data:image/png;base64,converted'
    });

    beforeEach(() => {
        createdImages = [];
        createObjectURL = jest.fn(() => 'blob:mock-url');
        revokeObjectURL = jest.fn();
        global.document = {
            createElement: tagName => {
                if (tagName === 'canvas') return makeCanvas();
                const listeners = {};
                const image = {
                    addEventListener: (name, handler) => {
                        listeners[name] = handler;
                    },
                    removeEventListener: name => {
                        delete listeners[name];
                    },
                    setAttribute: (name, value) => {
                        image.src = value;
                    }
                };
                image.listeners = listeners;
                createdImages.push(image);
                return image;
            }
        };
        global.window = {
            URL: {
                createObjectURL,
                revokeObjectURL
            }
        };
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
    });

    test('uses URI strings directly without creating a blob URL', async () => {
        const promise = bmpConverter('data:image/bmp;base64,AAAA');

        expect(createObjectURL).not.toHaveBeenCalled();
        expect(createdImages[0].src).toBe('data:image/bmp;base64,AAAA');

        createdImages[0].naturalWidth = 2;
        createdImages[0].naturalHeight = 3;
        createdImages[0].listeners.load();

        await expect(promise).resolves.toBe('data:image/png;base64,converted');
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    test('rejects and revokes the blob URL when decoding fails', async () => {
        const promise = bmpConverter(new ArrayBuffer(8));

        expect(createdImages[0].src).toBe('blob:mock-url');

        createdImages[0].listeners.error();

        await expect(promise).rejects.toThrow('Could not decode');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
        expect(createdImages[0].listeners.load).toBeUndefined();
        expect(createdImages[0].listeners.error).toBeUndefined();
    });

    test('revokes the blob URL after a successful decode', async () => {
        const promise = bmpConverter(new ArrayBuffer(8), 'image/webp');
        const image = createdImages[0];

        image.naturalWidth = 1;
        image.naturalHeight = 1;
        image.listeners.load();

        await expect(promise).resolves.toBe('data:image/png;base64,converted');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
});
