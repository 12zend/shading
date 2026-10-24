const MOVIE_PROJECT_EXTENSION = 'shade';
const MOVIE_PROJECT_FORMAT_KEY = 'mb3';
const MOVIE_PROJECT_FORMAT_VERSION = 1;
// Every saved .shade file records the file format version here. Files saved before the version was written carry
// only the mb3 feature marker and are version 1.0.0. Plain Scratch projects (.sb3, .sb2, .sb) have neither.
const SHADING_PROJECT_KEY = 'shading';
// Always the "current" version of engine-versions.json (checked by the GUI's unit tests): a file records the engine
// version that saved it, and opens in that engine when it is still listed.
const SHADING_PROJECT_VERSION = '1.9.0';
const LEGACY_SHADING_PROJECT_VERSION = '1.0.0';

const MOVIE_ASSET_BLOCKS = [
    'event_initialize',
    'event_renderframe',
    'looks_addrenderingframe',
    'looks_changevideoframeby',
    'looks_clearmaterial',
    'looks_clearscene',
    'looks_clearrenderingframe',
    'looks_exportrenderingmp4',
    'looks_addmaterial',
    'looks_renderbox',
    'looks_renderfloor',
    'looks_rendermodel',
    'looks_renderwall',
    'looks_rendervideo',
    'looks_setalbedofromcolor',
    'looks_setalbedofromtexture',
    'looks_setdisplacementmap',
    'looks_setemissionfromcolor',
    'looks_setemissionfromtexture',
    'looks_setnormalmap',
    'looks_setroughmap',
    'looks_setmodelframeto',
    'looks_settextfont',
    'looks_setvideoframeto',
    'looks_switchmodelto',
    'looks_switchvideoto',
    'objects_animate',
    'objects_bake',
    'objects_composite',
    'objects_renderPass',
    'objects_drawPass',
    'objects_clearPass',
    'objects_draw',
    'objects_group',
    'objects_shape',
    'objects_arc',
    'objects_circularSegment',
    'objects_interpolateAngle',
    'objects_interpolateColor',
    'objects_interpolateVector',
    'objects_keyframeTime',
    'objects_leftKeyframeTime',
    'objects_pass',
    'objects_numberCurve',
    'objects_colorCurve',
    'objects_angleCurve',
    'objects_stepCurve',
    'objects_instanceId',
    'objects_instanceSeed',
    'objects_line',
    'objects_loopValue',
    'objects_matte',
    'objects_grouping',
    'objects_pingPongValue',
    'objects_posterizeTime',
    'objects_repeat',
    'objects_scene',
    'objects_simulation',
    'objects_timeOffset',
    'objects_timeRange',
    'objects_timeScale',
    'objects_timeLoop',
    'objects_timeFreeze',
    'objects_timeReverse',
    'objects_timeRemap',
    'objects_timeWithin',
    'objects_timelineTime',
    'objects_transform',
    'objects_wiggle',
    'sound_playatframe',
    'sound_playattime'
];

const MOVIE_OPERATOR_BLOCKS = [
    'operator_easing',
    'operator_ge',
    'operator_le',
    'operator_letters_of',
    'operator_power'
];

const MOVIE_TIMER_BLOCKS = [
    'sensing_settimeroffsetto'
];

const MOVIE_3D_BLOCKS = [
    'looks_addlight',
    'looks_addpointlight',
    'looks_clearlight',
    'looks_renderbox',
    'looks_renderfloor',
    'looks_renderwall',
    'motion_changecamerarotationby',
    'motion_changecameraxby',
    'motion_changecamerayby',
    'motion_changecamerazby',
    'motion_changerotationby',
    'motion_changezby',
    'motion_gotoxyz',
    'motion_gotoxyz_nocamera',
    'motion_lookat',
    'motion_setcamerarotation',
    'motion_setcamerarotationorder',
    'motion_setcamerato',
    'motion_setcamerax',
    'motion_setcameray',
    'motion_setcameraz',
    'motion_setfov',
    'motion_setrotation',
    'motion_setrotationorder',
    'motion_setscale',
    'motion_setz',
    'objects_draw',
    'objects_repeat',
    'objects_transform',
    'objects_scene'
];

const MOVIE_3D_REPORTER_BLOCKS = [
    'motion_camerarotationorder',
    'motion_camerarotationx',
    'motion_camerarotationy',
    'motion_camerarotationz',
    'motion_camerax',
    'motion_cameray',
    'motion_cameraz',
    'motion_fov',
    'motion_focallength',
    'motion_rotationorder',
    'motion_rotationx',
    'motion_rotationy',
    'motion_rotationz',
    'motion_zposition'
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
    'looks_model',
    'looks_video',
    'objects_menu_media'
];

const ADVANCED_GRAPHIC_EFFECTS = [
    'gaussianblur',
    'lensblur',
    'radialblur',
    'directionalblur'
];

const MOVIE_BLOCK_SET = new Set(MOVIE_ASSET_BLOCKS.concat(
    MOVIE_3D_BLOCKS,
    MOVIE_3D_REPORTER_BLOCKS,
    MOVIE_MENU_BLOCKS,
    MOVIE_OPERATOR_BLOCKS,
    MOVIE_TIMER_BLOCKS
));
const ADVANCED_GRAPHIC_BLOCK_SET = new Set(ADVANCED_GRAPHIC_BLOCKS);
const ADVANCED_GRAPHIC_EFFECT_SET = new Set(ADVANCED_GRAPHIC_EFFECTS);

const isMovieBlockOpcode = opcode => (
    MOVIE_BLOCK_SET.has(opcode) ||
    ADVANCED_GRAPHIC_BLOCK_SET.has(opcode) ||
    (typeof opcode === 'string' && opcode.startsWith('penfx_'))
);

const getFieldValue = field => {
    if (Array.isArray(field)) return field[0];
    if (field && typeof field === 'object') return field.value;
    return field;
};

const addBlockFeatures = (features, block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    if (MOVIE_BLOCK_SET.has(block.opcode)) features.add('movie-blocks');
    if (typeof block.opcode === 'string' && block.opcode.startsWith('penfx_')) features.add('pen-fx');
    if (MOVIE_3D_BLOCKS.includes(block.opcode) || MOVIE_3D_REPORTER_BLOCKS.includes(block.opcode)) {
        features.add('3d-engine');
    }
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
    if (Array.isArray(projectJSON.movieCostumeGroups) && projectJSON.movieCostumeGroups.length > 0) {
        features.add('costume-groups');
    }
    if (Array.isArray(projectJSON.movieModels) && projectJSON.movieModels.length > 0) {
        features.add('model-assets');
        features.add('3d-engine');
    }
    if (projectJSON.movieCamera && typeof projectJSON.movieCamera === 'object') features.add('3d-engine');
    if (projectJSON.movieTimeline && typeof projectJSON.movieTimeline === 'object') features.add('timeline');
    if (Array.isArray(projectJSON.penFXLUTs) && projectJSON.penFXLUTs.length) features.add('pen-fx-luts');
    if (Array.isArray(projectJSON.penFXShaders) && projectJSON.penFXShaders.length > 0) {
        features.add('pen-fx-shaders');
    }
    if (Array.isArray(projectJSON.shadingPlugins) && projectJSON.shadingPlugins.length > 0) features.add('plugins');

    const targets = Array.isArray(projectJSON.targets) ? projectJSON.targets : [projectJSON];
    for (const target of targets) {
        if (target && target.movie3D) features.add('3d-engine');
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
    if (movieAssetManager && movieAssetManager.timeline) features.add('timeline');
    if (movieAssetManager && movieAssetManager.videos instanceof Map) {
        for (const videos of movieAssetManager.videos.values()) {
            if (videos.length > 0) {
                features.add('video-assets');
                break;
            }
        }
    }
    if (movieAssetManager && movieAssetManager.costumeGroups instanceof Map) {
        for (const groups of movieAssetManager.costumeGroups.values()) {
            if (groups.length > 0) {
                features.add('costume-groups');
                break;
            }
        }
    }
    if (movieAssetManager && movieAssetManager.models instanceof Map) {
        for (const models of movieAssetManager.models.values()) {
            if (models.length > 0) {
                features.add('model-assets');
                features.add('3d-engine');
                break;
            }
        }
    }
    if (movieAssetManager && typeof movieAssetManager.isDefaultCamera === 'function' &&
        !movieAssetManager.isDefaultCamera()) {
        features.add('3d-engine');
    }
    if (movieAssetManager && movieAssetManager.targetStates instanceof Map) {
        for (const state of movieAssetManager.targetStates.values()) {
            if (state.worldZ !== 480 || state.rotation.x !== 0 || state.rotation.y !== 0 ||
                state.rotationOrder !== 'XYZ' ||
                (state.scale && (state.scale.x !== 1 || state.scale.y !== 1 || state.scale.z !== 1))) {
                features.add('3d-engine');
                break;
            }
        }
    }
    const penFX = runtime.penFX;
    // Plugin packages and the core blend block are always bound; only project-owned packages count.
    if (penFX && penFX.customShaders && typeof penFX.customShaders.serializePackages === 'function' &&
        penFX.customShaders.serializePackages().length > 0) {
        features.add('pen-fx-shaders');
    }

    for (const target of runtime.targets || []) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) continue;
        for (const block of Object.values(blocks)) addBlockFeatures(features, block);
    }
    return Array.from(features).sort();
};

const markMovieProject = projectJSON => {
    // Sprites (sprite3) are a single target and are not project files.
    if (projectJSON && Array.isArray(projectJSON.targets)) {
        const previous = projectJSON[SHADING_PROJECT_KEY];
        projectJSON[SHADING_PROJECT_KEY] = Object.assign(
            {},
            previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {},
            {version: SHADING_PROJECT_VERSION}
        );
    }
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

const parseVersion = version => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
    return match ? match.slice(1).map(Number) : null;
};

/**
 * @param {object} projectJSON Parsed project.json.
 * @returns {?string} The .shade format version, or null for projects that are not .shade files.
 */
const getShadingProjectVersion = projectJSON => {
    if (!projectJSON || typeof projectJSON !== 'object') return null;
    const format = projectJSON[SHADING_PROJECT_KEY];
    if (format && typeof format === 'object' && typeof format.version === 'string') return format.version;
    const legacy = projectJSON[MOVIE_PROJECT_FORMAT_KEY];
    if (legacy && typeof legacy === 'object') return LEGACY_SHADING_PROJECT_VERSION;
    return null;
};

class UnsupportedProjectFormatError extends Error {
    /**
     * @param {string} reason 'legacy-format' (sb3, sb2, sb, mb3), 'newer-version' or 'invalid-version'.
     * @param {string} message Error message.
     * @param {?string} version The project's format version, if it has one.
     */
    constructor (reason, message, version = null) {
        super(message);
        this.name = 'UnsupportedProjectFormatError';
        this.reason = reason;
        this.version = version;
    }
}

/**
 * Only .shade projects open. Scratch formats (.sb3, .sb2, .sb) and files written by a newer major format version
 * are rejected before anything is deserialized.
 * @param {object} projectJSON Parsed project.json.
 * @returns {string} The project's format version.
 */
const assertSupportedProjectFormat = projectJSON => {
    const version = getShadingProjectVersion(projectJSON);
    if (version === null) {
        throw new UnsupportedProjectFormatError(
            'legacy-format',
            `Only .shade project files can be opened. Scratch projects (.sb3, .sb2, .sb) and .mb3 files are no ` +
            `longer supported.`
        );
    }
    const parsed = parseVersion(version);
    if (!parsed) {
        throw new UnsupportedProjectFormatError('invalid-version', `Invalid .shade format version: ${version}`,
            version);
    }
    if (parsed[0] > parseVersion(SHADING_PROJECT_VERSION)[0]) {
        throw new UnsupportedProjectFormatError(
            'newer-version',
            `This project was saved in .shade format ${version}, which is newer than this editor supports ` +
            `(${SHADING_PROJECT_VERSION}).`,
            version
        );
    }
    return version;
};

export {
    ADVANCED_GRAPHIC_BLOCKS,
    ADVANCED_GRAPHIC_EFFECTS,
    MOVIE_3D_BLOCKS,
    MOVIE_3D_REPORTER_BLOCKS,
    MOVIE_ASSET_BLOCKS,
    MOVIE_OPERATOR_BLOCKS,
    MOVIE_PROJECT_EXTENSION,
    MOVIE_PROJECT_FORMAT_KEY,
    MOVIE_PROJECT_FORMAT_VERSION,
    SHADING_PROJECT_KEY,
    SHADING_PROJECT_VERSION,
    UnsupportedProjectFormatError,
    assertSupportedProjectFormat,
    getMovieProjectFeatures,
    getRuntimeMovieProjectFeatures,
    getShadingProjectVersion,
    isMovieProject,
    isMovieBlockOpcode,
    markMovieProject
};
