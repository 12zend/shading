const SHADE_PROJECT_EXTENSION = 'shade';
const SHADE_PROJECT_FORMAT_KEY = 'shade';
const SHADE_PROJECT_FORMAT_VERSION = 1;

const isObject = value => value !== null && typeof value === 'object';

const getShadeTimelineSettings = projectJSON => {
    if (!isObject(projectJSON)) return null;

    const shade = projectJSON[SHADE_PROJECT_FORMAT_KEY];
    if (isObject(shade)) {
        if (isObject(shade.timeline)) return shade.timeline;
        // Accept the original draft shape where the timeline settings were
        // stored directly under the format key.
        return shade;
    }

    // These fallbacks make the loader tolerant of early Shading experiments
    // and do not affect the format emitted by the current editor.
    if (isObject(projectJSON.shadingTimeline)) return projectJSON.shadingTimeline;
    if (isObject(projectJSON.timeline) && Object.prototype.hasOwnProperty.call(projectJSON.timeline, 'duration')) {
        return projectJSON.timeline;
    }
    return null;
};

const markShadeProject = (projectJSON, timeline) => {
    if (!isObject(projectJSON)) return projectJSON;
    projectJSON[SHADE_PROJECT_FORMAT_KEY] = {
        ...projectJSON[SHADE_PROJECT_FORMAT_KEY],
        version: SHADE_PROJECT_FORMAT_VERSION,
        timeline
    };
    return projectJSON;
};

export {
    SHADE_PROJECT_EXTENSION,
    SHADE_PROJECT_FORMAT_KEY,
    SHADE_PROJECT_FORMAT_VERSION,
    getShadeTimelineSettings,
    markShadeProject
};
