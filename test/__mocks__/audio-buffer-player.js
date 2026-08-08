export default class MockAudioBufferPlayer {
    constructor (channelData, sampleRate) {
        const channels = channelData instanceof Float32Array ? [channelData] : channelData;
        this.samples = channels[0];
        this.channelData = channels;
        this.sampleRate = sampleRate;
        this.buffer = {
            numberOfChannels: channels.length,
            length: channels[0].length,
            getChannelData: jest.fn(channel => channels[channel]),
            sampleRate: sampleRate
        };
        this.play = jest.fn((trimStart, trimEnd, onUpdate) => {
            this.onUpdate = onUpdate;
        });
        this.stop = jest.fn();
        MockAudioBufferPlayer.instance = this;
    }
}
