// Stands in for MovieRenderingFrameStore (which needs IndexedDB): the "frame" is whatever
// MovieAssetManager.captureRenderingFrame returned, kept in memory.
class MockRenderingFrameStore {
    capture (signature) {
        return {ready: Promise.resolve(), signature};
    }
    retain () {}
    release () {}
}

module.exports = {__esModule: true, MovieRenderingFrameStore: MockRenderingFrameStore, default: MockRenderingFrameStore};
