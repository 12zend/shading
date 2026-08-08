import {encodeAudio} from './audio-encoder.js';

export const SOUND_BYTE_LIMIT = 10 * 1000 * 1000; // 10mb

const _computeRMS = function (samples, start, end, scaling = 0.55) {
    const length = end - start;
    if (length === 0) return 0;
    // Calculate RMS, adapted from https://github.com/Tonejs/Tone.js/blob/master/Tone/component/Meter.js#L88
    let sum = 0;
    for (let i = start; i < end; i++) {
        const sample = samples[i];
        sum += sample ** 2;
    }
    const rms = Math.sqrt(sum / length);
    const val = rms / scaling;
    return Math.sqrt(val);
};

const computeRMS = (samples, scaling) => _computeRMS(samples, 0, samples.length, scaling);

const computeChunkedRMS = function (samples, chunkSize = 1024) {
    const sampleCount = samples.length;
    const chunkLevels = [];
    for (let i = 0; i < sampleCount; i += chunkSize) {
        const maxIndex = Math.min(sampleCount, i + chunkSize);
        chunkLevels.push(_computeRMS(samples, i, maxIndex));
    }
    return chunkLevels;
};

const encodeAndAddSoundToVM = function (vm, samples, sampleRate, name, callback, dataFormat = 'wav') {
    const channelData = samples instanceof Float32Array ? [samples] : samples;
    const normalizedDataFormat = dataFormat.toLowerCase();
    encodeAudio(channelData, sampleRate, normalizedDataFormat).then(encodedData => {
        const vmSound = {
            format: '',
            dataFormat: normalizedDataFormat,
            rate: sampleRate,
            sampleCount: channelData[0].length
        };

        // Create an asset from the encoded audio and get the resulting md5.
        const storage = vm.runtime.storage;
        vmSound.asset = storage.createAsset(
            storage.AssetType.Sound,
            normalizedDataFormat === 'mp3' ? storage.DataFormat.MP3 : storage.DataFormat.WAV,
            encodedData,
            null,
            true // generate md5
        );
        vmSound.assetId = vmSound.asset.assetId;

        // update vmSound object with md5 property
        vmSound.md5 = `${vmSound.assetId}.${vmSound.dataFormat}`;
        // The VM will update the sound name to a fresh name
        vmSound.name = name;

        vm.addSound(vmSound).then(() => {
            if (callback) callback();
        });
    });
};

const updateSoundBuffer = (vm, soundIndex, audioBuffer, soundEncoding, dataFormat) => {
    const normalizedDataFormat = dataFormat.toLowerCase();
    if (normalizedDataFormat !== 'mp3') {
        vm.updateSoundBuffer(soundIndex, audioBuffer, soundEncoding);
        return;
    }

    // scratch-vm's public editor method currently assumes every encoded edit is
    // WAV. Let it update the live playback buffer, then store the MP3 asset here.
    vm.updateSoundBuffer(soundIndex, audioBuffer, null);
    const sound = vm.editingTarget.sprite.sounds[soundIndex];
    const storage = vm.runtime.storage;
    sound.format = '';
    sound.asset = storage.createAsset(
        storage.AssetType.Sound,
        storage.DataFormat.MP3,
        soundEncoding,
        null,
        true
    );
    sound.assetId = sound.asset.assetId;
    sound.dataFormat = storage.DataFormat.MP3;
    sound.md5 = `${sound.assetId}.${sound.dataFormat}`;
    sound.sampleCount = audioBuffer.length;
    sound.rate = audioBuffer.sampleRate;
    vm.emitTargetsUpdate();
};

/**
 @typedef SoundBuffer
 @type {Object}
 @property {Float32Array} [samples] Samples for a mono sound
 @property {Array<Float32Array>} [channelData] Samples grouped by channel
 @property {number} sampleRate Audio sample rate
 */

/**
 * Downsample the given buffer to try to reduce file size below SOUND_BYTE_LIMIT
 * @param {SoundBuffer} buffer - Buffer to resample
 * @param {function(SoundBuffer):Promise<SoundBuffer>} resampler - resampler function
 * @returns {SoundBuffer} Downsampled buffer with half the sample rate
 */
const downsampleIfNeeded = (buffer, resampler) => {
    const {samples, channelData, sampleRate} = buffer;
    const channels = channelData || [samples];
    const encodedByteLength = channels.reduce((length, channel) => length + channel.length, 0) * 2;
    // Resolve immediately if already within byte limit
    if (encodedByteLength < SOUND_BYTE_LIMIT) {
        return Promise.resolve(buffer);
    }
    // TW: Don't check if the sound will still fit at this reduced sample rate.
    // Instead the GUI will show a warning if it's too large.
    return resampler(buffer, 22050);
};

/**
 * Drop every other sample of an audio buffer as a last-resort way of downsampling.
 * @param {SoundBuffer} buffer - Buffer to resample
 * @returns {SoundBuffer} Downsampled buffer with half the sample rate
 */
const dropEveryOtherSample = buffer => {
    const downsampleChannel = samples => {
        const newLength = Math.floor(samples.length / 2);
        const newSamples = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            newSamples[i] = samples[i * 2];
        }
        return newSamples;
    };
    if (buffer.channelData) {
        return {
            channelData: buffer.channelData.map(downsampleChannel),
            sampleRate: buffer.sampleRate / 2
        };
    }
    return {
        samples: downsampleChannel(buffer.samples),
        sampleRate: buffer.sampleRate / 2
    };
};

export {
    computeRMS,
    computeChunkedRMS,
    encodeAndAddSoundToVM,
    updateSoundBuffer,
    downsampleIfNeeded,
    dropEveryOtherSample
};
