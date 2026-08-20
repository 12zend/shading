const getOriginalTargets = runtime => (
    runtime && Array.isArray(runtime.targets) ? runtime.targets.filter(target => target && target.isOriginal) : []
);

const describeCollaborationTarget = (runtime, target) => {
    if (!target) return null;
    const targets = getOriginalTargets(runtime);
    const index = targets.indexOf(target);
    return {
        id: String(target.id || ''),
        index: index < 0 ? null : index,
        isStage: target.isStage === true,
        name: typeof target.getName === 'function' ? String(target.getName()) : ''
    };
};

const resolveCollaborationTarget = (runtime, descriptor, legacyId) => {
    if (!runtime) return null;
    const targets = getOriginalTargets(runtime);
    const requested = descriptor && typeof descriptor === 'object' ? descriptor : null;

    if (requested) {
        if (requested.isStage === true) {
            const stage = typeof runtime.getTargetForStage === 'function' ? runtime.getTargetForStage() : null;
            if (stage) return stage;
        }

        const index = Number(requested.index);
        if (Number.isInteger(index) && index >= 0 && index < targets.length) {
            const indexedTarget = targets[index];
            if (indexedTarget.isStage === (requested.isStage === true)) return indexedTarget;
        }

        const name = String(requested.name || '');
        if (name) {
            const namedTarget = targets.find(target => (
                target.isStage === (requested.isStage === true) &&
                typeof target.getName === 'function' && target.getName() === name
            ));
            if (namedTarget) return namedTarget;
        }

        const descriptorId = String(requested.id || '');
        if (descriptorId && typeof runtime.getTargetById === 'function') {
            const describedTarget = runtime.getTargetById(descriptorId);
            if (describedTarget) return describedTarget;
        }
    }

    return legacyId && typeof runtime.getTargetById === 'function' ? runtime.getTargetById(legacyId) : null;
};

export {
    describeCollaborationTarget,
    getOriginalTargets,
    resolveCollaborationTarget
};
