import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import {connect} from 'react-redux';

import {
    computeChunkedRMS,
    encodeAndAddSoundToVM,
    downsampleIfNeeded,
    dropEveryOtherSample,
    updateSoundBuffer
} from '../lib/audio/audio-util.js';
import {encodeAudio} from '../lib/audio/audio-encoder.js';
import AudioEffects from '../lib/audio/audio-effects.js';
import SoundEditorComponent from '../components/sound-editor/sound-editor.jsx';
import AudioBufferPlayer from '../lib/audio/audio-buffer-player.js';
import log from '../lib/log.js';

const UNDO_STACK_SIZE = 99;

const MAX_RMS = 1.2;

const getChannelData = audioBuffer => {
    const channelData = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        channelData.push(audioBuffer.getChannelData(channel));
    }
    return channelData;
};

const getChannel = (channelData, channel) => channelData[channel] || channelData[0];

class SoundEditor extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'copy',
            'copyCurrentBuffer',
            'handleCopyToNew',
            'handleStoppedPlaying',
            'handleChangeName',
            'handlePlay',
            'handleStopPlaying',
            'handleUpdatePlayhead',
            'handleDelete',
            'handleUpdateTrim',
            'handleEffect',
            'handleUndo',
            'handleRedo',
            'submitNewSamples',
            'handleCopy',
            'handlePaste',
            'paste',
            'handleKeyPress',
            'handleContainerClick',
            'setRef',
            'resampleBufferToRate'
        ]);
        this.state = {
            copyBuffer: null,
            chunkLevels: computeChunkedRMS(this.props.channelData[0]),
            playhead: null, // null is not playing, [0 -> 1] is playing percent
            trimStart: null,
            trimEnd: null
        };

        this.redoStack = [];
        this.undoStack = [];

        this.ref = null;
    }
    componentDidMount () {
        this.audioBufferPlayer = new AudioBufferPlayer(this.props.channelData, this.props.sampleRate);

        document.addEventListener('keydown', this.handleKeyPress);
    }
    componentWillReceiveProps (newProps) {
        if (newProps.soundId !== this.props.soundId) { // A different sound has been selected
            this.redoStack = [];
            this.undoStack = [];
            this.resetState(newProps.channelData, newProps.sampleRate);
            this.setState({
                trimStart: null,
                trimEnd: null
            });
        }
    }
    componentWillUnmount () {
        this.audioBufferPlayer.stop();

        document.removeEventListener('keydown', this.handleKeyPress);
    }
    handleKeyPress (event) {
        if (event.target instanceof HTMLInputElement) {
            // Ignore keyboard shortcuts if a text input field is focused
            return;
        }
        if (this.props.isFullScreen) {
            // Ignore keyboard shortcuts if the stage is fullscreen mode
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (this.state.playhead) {
                this.handleStopPlaying();
            } else {
                this.handlePlay();
            }
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            if (event.shiftKey) {
                this.handleDeleteInverse();
            } else {
                this.handleDelete();
            }
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.handleUpdateTrim(null, null);
        }
        if (event.metaKey || event.ctrlKey) {
            if (event.shiftKey && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                if (this.redoStack.length > 0) {
                    this.handleRedo();
                }
            } else if (event.key === 'z') {
                if (this.undoStack.length > 0) {
                    event.preventDefault();
                    this.handleUndo();
                }
            } else if (event.key === 'c') {
                event.preventDefault();
                this.handleCopy();
            } else if (event.key === 'v') {
                event.preventDefault();
                this.handlePaste();
            } else if (event.key === 'a') {
                event.preventDefault();
                this.handleUpdateTrim(0, 1);
            }
        }
    }
    resetState (channelData, sampleRate) {
        this.audioBufferPlayer.stop();
        this.audioBufferPlayer = new AudioBufferPlayer(channelData, sampleRate);
        this.setState({
            chunkLevels: computeChunkedRMS(channelData[0]),
            playhead: null
        });
    }
    submitNewSamples (channelData, sampleRate, skipUndo) {
        return downsampleIfNeeded({channelData, sampleRate}, this.resampleBufferToRate)
            .then(({channelData: newChannelData, sampleRate: newSampleRate}) =>
                encodeAudio(newChannelData, newSampleRate, this.props.dataFormat).then(encodedData => {
                    if (!skipUndo) {
                        this.redoStack = [];
                        if (this.undoStack.length >= UNDO_STACK_SIZE) {
                            this.undoStack.shift(); // Drop the first element off the array
                        }
                        this.undoStack.push(this.getUndoItem());
                    }
                    this.resetState(newChannelData, newSampleRate);
                    updateSoundBuffer(
                        this.props.vm,
                        this.props.soundIndex,
                        this.audioBufferPlayer.buffer,
                        encodedData,
                        this.props.dataFormat);
                    return true; // Edit was successful
                })
            )
            .catch(e => {
                // Encoding failed, or the sound was too large to save so edit is rejected
                log.error(`Encountered error while trying to encode sound update: ${e.message}`);
                return false; // Edit was not applied
            });
    }
    handlePlay () {
        this.audioBufferPlayer.stop();
        this.audioBufferPlayer.play(
            this.state.trimStart || 0,
            this.state.trimEnd || 1,
            this.handleUpdatePlayhead,
            this.handleStoppedPlaying);
    }
    handleStopPlaying () {
        this.audioBufferPlayer.stop();
        this.handleStoppedPlaying();
    }
    handleStoppedPlaying () {
        this.setState({playhead: null});
    }
    handleUpdatePlayhead (playhead) {
        this.setState({playhead});
    }
    handleChangeName (name) {
        this.props.vm.renameSound(this.props.soundIndex, name);
    }
    handleDelete () {
        const {channelData, sampleRate} = this.copyCurrentBuffer();
        const sampleCount = channelData[0].length;
        const startIndex = Math.floor(this.state.trimStart * sampleCount);
        const endIndex = Math.floor(this.state.trimEnd * sampleCount);
        const newChannelData = channelData.map(samples => {
            const firstPart = samples.slice(0, startIndex);
            const secondPart = samples.slice(endIndex, sampleCount);
            const newLength = firstPart.length + secondPart.length;
            if (newLength === 0) return new Float32Array(1);
            const newSamples = new Float32Array(newLength);
            newSamples.set(firstPart, 0);
            newSamples.set(secondPart, firstPart.length);
            return newSamples;
        });
        this.submitNewSamples(newChannelData, sampleRate).then(() => {
            this.setState({
                trimStart: null,
                trimEnd: null
            });
        });
    }
    handleDeleteInverse () {
        // Delete everything outside of the trimmers
        const {channelData, sampleRate} = this.copyCurrentBuffer();
        const sampleCount = channelData[0].length;
        const startIndex = Math.floor(this.state.trimStart * sampleCount);
        const endIndex = Math.floor(this.state.trimEnd * sampleCount);
        const clippedChannelData = channelData.map(samples => {
            const clippedSamples = samples.slice(startIndex, endIndex);
            return clippedSamples.length === 0 ? new Float32Array(1) : clippedSamples;
        });
        this.submitNewSamples(clippedChannelData, sampleRate).then(success => {
            if (success) {
                this.setState({
                    trimStart: null,
                    trimEnd: null
                });
            }
        });
    }
    handleUpdateTrim (trimStart, trimEnd) {
        this.setState({trimStart, trimEnd});
        this.handleStopPlaying();
    }
    effectFactory (name) {
        return () => this.handleEffect(name);
    }
    copyCurrentBuffer () {
        // Cannot reliably use props.samples because it gets detached by Firefox
        return {
            channelData: getChannelData(this.audioBufferPlayer.buffer),
            sampleRate: this.audioBufferPlayer.buffer.sampleRate
        };
    }
    handleEffect (name) {
        const trimStart = this.state.trimStart === null ? 0.0 : this.state.trimStart;
        const trimEnd = this.state.trimEnd === null ? 1.0 : this.state.trimEnd;

        // Offline audio context needs at least 2 samples
        if (this.audioBufferPlayer.buffer.length < 2) {
            return;
        }

        const effects = new AudioEffects(this.audioBufferPlayer.buffer, name, trimStart, trimEnd);
        effects.process((renderedBuffer, adjustedTrimStart, adjustedTrimEnd) => {
            const channelData = getChannelData(renderedBuffer);
            const sampleRate = renderedBuffer.sampleRate;
            this.submitNewSamples(channelData, sampleRate).then(success => {
                if (success) {
                    if (this.state.trimStart === null) {
                        this.handlePlay();
                    } else {
                        this.setState({trimStart: adjustedTrimStart, trimEnd: adjustedTrimEnd}, this.handlePlay);
                    }
                }
            });
        });
    }
    tooLoud () {
        const numChunks = this.state.chunkLevels.length;
        const startIndex = this.state.trimStart === null ?
            0 : Math.floor(this.state.trimStart * numChunks);
        const endIndex = this.state.trimEnd === null ?
            numChunks - 1 : Math.ceil(this.state.trimEnd * numChunks);
        const trimChunks = this.state.chunkLevels.slice(startIndex, endIndex);
        let max = 0;
        for (const i of trimChunks) {
            if (i > max) {
                max = i;
            }
        }
        return max > MAX_RMS;
    }
    getUndoItem () {
        return {
            ...this.copyCurrentBuffer(),
            trimStart: this.state.trimStart,
            trimEnd: this.state.trimEnd
        };
    }
    handleUndo () {
        this.redoStack.push(this.getUndoItem());
        const {channelData, sampleRate, trimStart, trimEnd} = this.undoStack.pop();
        if (channelData) {
            return this.submitNewSamples(channelData, sampleRate, true).then(success => {
                if (success) {
                    this.setState({trimStart: trimStart, trimEnd: trimEnd}, this.handlePlay);
                }
            });
        }
    }
    handleRedo () {
        const {channelData, sampleRate, trimStart, trimEnd} = this.redoStack.pop();
        if (channelData) {
            this.undoStack.push(this.getUndoItem());
            return this.submitNewSamples(channelData, sampleRate, true).then(success => {
                if (success) {
                    this.setState({trimStart: trimStart, trimEnd: trimEnd}, this.handlePlay);
                }
            });
        }
    }
    handleCopy () {
        this.copy();
    }
    copy (callback) {
        const trimStart = this.state.trimStart === null ? 0.0 : this.state.trimStart;
        const trimEnd = this.state.trimEnd === null ? 1.0 : this.state.trimEnd;

        const newCopyBuffer = this.copyCurrentBuffer();
        const trimStartSamples = trimStart * newCopyBuffer.channelData[0].length;
        const trimEndSamples = trimEnd * newCopyBuffer.channelData[0].length;
        newCopyBuffer.channelData = newCopyBuffer.channelData.map(samples =>
            samples.slice(trimStartSamples, trimEndSamples));

        this.setState({
            copyBuffer: newCopyBuffer
        }, callback);
    }
    handleCopyToNew () {
        this.copy(() => {
            encodeAndAddSoundToVM(this.props.vm, this.state.copyBuffer.channelData,
                this.state.copyBuffer.sampleRate, this.props.name, null, this.props.dataFormat);
        });
    }
    resampleBufferToRate (buffer, newRate) {
        return new Promise((resolve, reject) => {
            const sampleRateRatio = newRate / buffer.sampleRate;
            const newLength = sampleRateRatio * buffer.channelData[0].length;
            const numberOfChannels = buffer.channelData.length;
            let offlineContext;
            // Try to use either OfflineAudioContext or webkitOfflineAudioContext to resample
            // The constructors will throw if trying to resample at an unsupported rate
            // (e.g. Safari/webkitOAC does not support lower than 44khz).
            try {
                if (window.OfflineAudioContext) {
                    offlineContext = new window.OfflineAudioContext(numberOfChannels, newLength, newRate);
                } else if (window.webkitOfflineAudioContext) {
                    offlineContext = new window.webkitOfflineAudioContext(numberOfChannels, newLength, newRate);
                }
            } catch {
                // If no OAC available and downsampling by 2, downsample by dropping every other sample.
                if (newRate === buffer.sampleRate / 2) {
                    return resolve(dropEveryOtherSample(buffer));
                }
                return reject(new Error('Could not resample'));
            }
            const source = offlineContext.createBufferSource();
            const audioBuffer = offlineContext.createBuffer(
                numberOfChannels, buffer.channelData[0].length, buffer.sampleRate);
            buffer.channelData.forEach((samples, channel) => {
                audioBuffer.getChannelData(channel).set(samples);
            });
            source.buffer = audioBuffer;
            source.connect(offlineContext.destination);
            source.start();
            offlineContext.startRendering();
            offlineContext.oncomplete = ({renderedBuffer}) => {
                resolve({
                    channelData: getChannelData(renderedBuffer),
                    sampleRate: newRate
                });
            };
        });
    }
    paste () {
        // If there's no selection, paste at the end of the sound
        const {channelData, sampleRate} = this.copyCurrentBuffer();
        const currentLength = channelData[0].length;
        const copiedLength = this.state.copyBuffer.channelData[0].length;
        const numberOfChannels = Math.max(channelData.length, this.state.copyBuffer.channelData.length);
        if (this.state.trimStart === null) {
            const newChannelData = [];
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const newSamples = new Float32Array(currentLength + copiedLength);
                newSamples.set(getChannel(channelData, channel), 0);
                newSamples.set(getChannel(this.state.copyBuffer.channelData, channel), currentLength);
                newChannelData.push(newSamples);
            }
            this.submitNewSamples(newChannelData, sampleRate, false).then(success => {
                if (success) {
                    this.handlePlay();
                }
            });
        } else {
            // else replace the selection with the pasted sound
            const trimStartSamples = this.state.trimStart * currentLength;
            const trimEndSamples = this.state.trimEnd * currentLength;
            const firstPartLength = Math.floor(trimStartSamples);
            const lastPartLength = currentLength - Math.floor(trimEndSamples);
            const newLength = firstPartLength + copiedLength + lastPartLength;
            const newChannelData = [];
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const currentSamples = getChannel(channelData, channel);
                const firstPart = currentSamples.slice(0, trimStartSamples);
                const lastPart = currentSamples.slice(trimEndSamples);
                const newSamples = new Float32Array(newLength);
                newSamples.set(firstPart, 0);
                newSamples.set(getChannel(this.state.copyBuffer.channelData, channel), firstPart.length);
                newSamples.set(lastPart, firstPart.length + copiedLength);
                newChannelData.push(newSamples);
            }

            const trimStartSeconds = trimStartSamples / sampleRate;
            const trimEndSeconds = trimStartSeconds +
                (copiedLength / this.state.copyBuffer.sampleRate);
            const newDurationSeconds = newChannelData[0].length / sampleRate;
            const adjustedTrimStart = trimStartSeconds / newDurationSeconds;
            const adjustedTrimEnd = trimEndSeconds / newDurationSeconds;
            this.submitNewSamples(newChannelData, sampleRate, false).then(success => {
                if (success) {
                    this.setState({
                        trimStart: adjustedTrimStart,
                        trimEnd: adjustedTrimEnd
                    }, this.handlePlay);
                }
            });
        }
    }
    handlePaste () {
        if (!this.state.copyBuffer) return;
        if (this.state.copyBuffer.sampleRate === this.props.sampleRate) {
            this.paste();
        } else {
            this.resampleBufferToRate(this.state.copyBuffer, this.props.sampleRate).then(buffer => {
                this.setState({
                    copyBuffer: buffer
                }, this.paste);
            });
        }
    }
    setRef (element) {
        this.ref = element;
    }
    handleContainerClick (e) {
        // If the click is on the sound editor's div (and not any other element), delesect
        if (e.target === this.ref && this.state.trimStart !== null) {
            this.handleUpdateTrim(null, null);
        }
    }
    render () {
        const {effectTypes} = AudioEffects;
        return (
            <SoundEditorComponent
                isStereo={this.props.isStereo}
                duration={this.props.duration}
                size={this.props.size}
                canPaste={this.state.copyBuffer !== null}
                canRedo={this.redoStack.length > 0}
                canUndo={this.undoStack.length > 0}
                chunkLevels={this.state.chunkLevels}
                name={this.props.name}
                playhead={this.state.playhead}
                setRef={this.setRef}
                tooLoud={this.tooLoud()}
                trimEnd={this.state.trimEnd}
                trimStart={this.state.trimStart}
                onChangeName={this.handleChangeName}
                onContainerClick={this.handleContainerClick}
                onCopy={this.handleCopy}
                onCopyToNew={this.handleCopyToNew}
                onDelete={this.handleDelete}
                onEcho={this.effectFactory(effectTypes.ECHO)}
                onFadeIn={this.effectFactory(effectTypes.FADEIN)}
                onFadeOut={this.effectFactory(effectTypes.FADEOUT)}
                onFaster={this.effectFactory(effectTypes.FASTER)}
                onLouder={this.effectFactory(effectTypes.LOUDER)}
                onMute={this.effectFactory(effectTypes.MUTE)}
                onPaste={this.handlePaste}
                onPlay={this.handlePlay}
                onRedo={this.handleRedo}
                onReverse={this.effectFactory(effectTypes.REVERSE)}
                onRobot={this.effectFactory(effectTypes.ROBOT)}
                onSetTrim={this.handleUpdateTrim}
                onSlower={this.effectFactory(effectTypes.SLOWER)}
                onSofter={this.effectFactory(effectTypes.SOFTER)}
                onStop={this.handleStopPlaying}
                onUndo={this.handleUndo}
            />
        );
    }
}

SoundEditor.propTypes = {
    dataFormat: PropTypes.string,
    isStereo: PropTypes.bool,
    duration: PropTypes.number,
    size: PropTypes.number,
    isFullScreen: PropTypes.bool,
    name: PropTypes.string.isRequired,
    sampleRate: PropTypes.number,
    channelData: PropTypes.arrayOf(PropTypes.instanceOf(Float32Array)),
    soundId: PropTypes.string,
    soundIndex: PropTypes.number,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = (state, {soundIndex}) => {
    const sprite = state.scratchGui.vm.editingTarget.sprite;
    // Make sure the sound index doesn't go out of range.
    const index = soundIndex < sprite.sounds.length ? soundIndex : sprite.sounds.length - 1;
    const sound = state.scratchGui.vm.editingTarget.sprite.sounds[index];
    const audioBuffer = state.scratchGui.vm.getSoundBuffer(index);
    return {
        isStereo: audioBuffer.numberOfChannels !== 1,
        dataFormat: sound.dataFormat || 'wav',
        duration: sound.sampleCount / sound.rate,
        size: sound.asset ? sound.asset.data.byteLength : 0,
        soundId: sound.soundId,
        sampleRate: audioBuffer.sampleRate,
        channelData: getChannelData(audioBuffer),
        isFullScreen: state.scratchGui.mode.isFullScreen,
        name: sound.name,
        vm: state.scratchGui.vm
    };
};

export default connect(
    mapStateToProps
)(SoundEditor);
