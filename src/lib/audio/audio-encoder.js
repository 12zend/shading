import {Mp3Encoder} from '@breezystack/lamejs';
import WavEncoder from 'wav-encoder';

const MP3_BIT_RATE = 128;
const MP3_BLOCK_SIZE = 1152;

const floatToInt16 = samples => {
    const result = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return result;
};

const encodeMp3 = (channelData, sampleRate) => {
    // MPEG audio supports one or two channels. Uploaded MP3 files decoded by
    // browsers will therefore always fit this limit.
    const channels = channelData.slice(0, 2).map(floatToInt16);
    const encoder = new Mp3Encoder(channels.length, sampleRate, MP3_BIT_RATE);
    const chunks = [];
    let byteLength = 0;

    for (let offset = 0; offset < channels[0].length; offset += MP3_BLOCK_SIZE) {
        const left = channels[0].subarray(offset, offset + MP3_BLOCK_SIZE);
        const right = channels[1] && channels[1].subarray(offset, offset + MP3_BLOCK_SIZE);
        const chunk = encoder.encodeBuffer(left, right);
        if (chunk.length > 0) {
            chunks.push(chunk);
            byteLength += chunk.length;
        }
    }

    const finalChunk = encoder.flush();
    if (finalChunk.length > 0) {
        chunks.push(finalChunk);
        byteLength += finalChunk.length;
    }

    const encoded = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach(chunk => {
        encoded.set(chunk, offset);
        offset += chunk.length;
    });
    return encoded;
};

const encodeAudio = (channelData, sampleRate, dataFormat = 'wav') => {
    if (dataFormat.toLowerCase() === 'mp3') {
        return Promise.resolve().then(() => encodeMp3(channelData, sampleRate));
    }
    return WavEncoder.encode({sampleRate, channelData}).then(buffer => new Uint8Array(buffer));
};

export {
    encodeAudio,
    encodeMp3,
    floatToInt16
};
