class StageLayering {
    static get BACKGROUND_LAYER () {
        return 'background';
    }

    static get VIDEO_LAYER () {
        return 'video';
    }

    static get MOVIE_LAYER () {
        return 'movie';
    }

    static get SPRITE_LAYER () {
        return 'sprite';
    }

    // Order of layer groups relative to each other,
    static get LAYER_GROUPS () {
        return [
            StageLayering.BACKGROUND_LAYER,
            StageLayering.VIDEO_LAYER,
            StageLayering.MOVIE_LAYER,
            StageLayering.SPRITE_LAYER
        ];
    }
}

module.exports = StageLayering;
