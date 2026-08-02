const MOVIE_PROJECT_EXTENSION = 'mb3';
const SCRATCH_PROJECT_EXTENSION = 'sb3';
const MOVIE_PROJECT_FORMAT_KEY = 'mb3';
const MOVIE_PROJECT_FORMAT_VERSION = 1;

const MOVIE_ASSET_BLOCKS = [
    'looks_changevideoframeby',
    'looks_settextfont',
    'looks_setvideoframeto',
    'looks_switchvideoto'
];

const ADVANCED_GRAPHIC_BLOCKS = [
    'looks_bloom',
    'looks_circularripple',
    'looks_displacementmap',
    'looks_edgedetection',
    'looks_effectweight',
    'looks_pixelstretch',
    'looks_posterize',
    'looks_rgbshift',
    'looks_setheightto',
    'looks_setwidthto',
    'looks_turbulentdisplace'
];

const MOVIE_MENU_BLOCKS = [
    'looks_font',
    'looks_video'
];

const ADVANCED_GRAPHIC_EFFECTS = [
    'gaussianblur',
    'lensblur',
    'radialblur',
    'directionalblur'
];

const MOVIE_BLOCK_SET = new Set(MOVIE_ASSET_BLOCKS.concat(MOVIE_MENU_BLOCKS));
const ADVANCED_GRAPHIC_BLOCK_SET = new Set(ADVANCED_GRAPHIC_BLOCKS);
const ADVANCED_GRAPHIC_EFFECT_SET = new Set(ADVANCED_GRAPHIC_EFFECTS);

const getFieldValue = field => {
    if (Array.isArray(field)) return field[0];
    if (field && typeof field === 'object') return field.value;
    return field;
};

const addBlockFeatures = (features, block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    if (MOVIE_BLOCK_SET.has(block.opcode)) features.add('movie-blocks');
    if (ADVANCED_GRAPHIC_BLOCK_SET.has(block.opcode)) features.add('graphic-effects');

    if (block.opcode === 'looks_changeeffectby' || block.opcode === 'looks_seteffectto') {
        const effect = getFieldValue(block.fields && block.fields.EFFECT);
        if (ADVANCED_GRAPHIC_EFFECT_SET.has(String(effect).toLowerCase())) {
            features.add('graphic-effects');
        }
    }
};

const getMovieProjectFeatures = projectJSON => {
    const features = new Set();
    if (!projectJSON || typeof projectJSON !== 'object') return [];

    if (Array.isArray(projectJSON.movieVideos) && projectJSON.movieVideos.length > 0) {
        features.add('video-assets');
    }

    const targets = Array.isArray(projectJSON.targets) ? projectJSON.targets : [projectJSON];
    for (const target of targets) {
        const blocks = target && target.blocks;
        if (!blocks || typeof blocks !== 'object') continue;
        for (const block of Object.values(blocks)) addBlockFeatures(features, block);
    }
    return Array.from(features).sort();
};

const getRuntimeMovieProjectFeatures = runtime => {
    const features = new Set();
    if (!runtime) return [];

    const movieAssetManager = runtime.movieAssetManager;
    if (movieAssetManager && movieAssetManager.videos instanceof Map) {
        for (const videos of movieAssetManager.videos.values()) {
            if (videos.length > 0) {
                features.add('video-assets');
                break;
            }
        }
    }

    for (const target of runtime.targets || []) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) continue;
        for (const block of Object.values(blocks)) addBlockFeatures(features, block);
    }
    return Array.from(features).sort();
};

const markMovieProject = projectJSON => {
    const features = getMovieProjectFeatures(projectJSON);
    if (features.length > 0) {
        projectJSON[MOVIE_PROJECT_FORMAT_KEY] = {
            version: MOVIE_PROJECT_FORMAT_VERSION,
            features
        };
    } else {
        delete projectJSON[MOVIE_PROJECT_FORMAT_KEY];
    }
    return projectJSON;
};

const isMovieProject = projectJSON => Boolean(
    projectJSON &&
    typeof projectJSON === 'object' &&
    (
        projectJSON[MOVIE_PROJECT_FORMAT_KEY] ||
        getMovieProjectFeatures(projectJSON).length > 0
    )
);

const getProjectExtension = runtime => (
    getRuntimeMovieProjectFeatures(runtime).length > 0 ?
        MOVIE_PROJECT_EXTENSION :
        SCRATCH_PROJECT_EXTENSION
);

export {
    ADVANCED_GRAPHIC_BLOCKS,
    ADVANCED_GRAPHIC_EFFECTS,
    MOVIE_ASSET_BLOCKS,
    MOVIE_PROJECT_EXTENSION,
    MOVIE_PROJECT_FORMAT_KEY,
    MOVIE_PROJECT_FORMAT_VERSION,
    SCRATCH_PROJECT_EXTENSION,
    getMovieProjectFeatures,
    getProjectExtension,
    getRuntimeMovieProjectFeatures,
    isMovieProject,
    markMovieProject
};
