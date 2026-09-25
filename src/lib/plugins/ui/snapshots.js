// Snapshots are {width, height, pixels: Uint8Array RGBA, top row first} images used by preview pickers.

const SAMPLE_WIDTH = 320;
const SAMPLE_HEIGHT = 180;

// A neutral stand-in when the block has not produced a frame yet: sky, skin, foliage and a grey ramp give
// every preset something visible to change.
const createSampleSnapshot = () => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const sky = context.createLinearGradient(0, 0, 0, SAMPLE_HEIGHT);
    sky.addColorStop(0, '#4f86c6');
    sky.addColorStop(0.55, '#f2c38b');
    sky.addColorStop(1, '#3b5a2c');
    context.fillStyle = sky;
    context.fillRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    context.fillStyle = '#fff4d6';
    context.beginPath();
    context.arc(250, 62, 22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#d99a78';
    context.beginPath();
    context.arc(92, 96, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#b8323a';
    context.fillRect(58, 128, 68, 52);
    const ramp = context.createLinearGradient(0, 0, SAMPLE_WIDTH, 0);
    ramp.addColorStop(0, '#000000');
    ramp.addColorStop(1, '#ffffff');
    context.fillStyle = ramp;
    context.fillRect(0, SAMPLE_HEIGHT - 14, SAMPLE_WIDTH, 14);
    // Canvas rows are top-down like the pen layer's, so both sources share one upload path.
    const pixels = new Uint8Array(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data.buffer);
    return {width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, pixels, sample: true};
};

// A fully transparent or single-color input (an empty group, a blank frame) cannot show a look's character.
const isBlankSnapshot = snapshot => {
    if (!snapshot || !snapshot.pixels || !snapshot.pixels.length) return true;
    const pixels = snapshot.pixels;
    const min = [255, 255, 255, 255];
    const max = [0, 0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
        for (let channel = 0; channel < 4; channel++) {
            const value = pixels[index + channel];
            if (value < min[channel]) min[channel] = value;
            if (value > max[channel]) max[channel] = value;
        }
    }
    return max[3] === 0 || [0, 1, 2, 3].every(channel => max[channel] - min[channel] < 8);
};

export {createSampleSnapshot, isBlankSnapshot};
