import copy from './copy';
import vertex from './vertex';
import {composite, groupOver, matteOver} from './common';

// Only the compositing programs used by groups, mattes and blend modes belong to the core engine.
// Effect programs are registered by plugins with registerEngineProgram.
const programSources = {
    copy,
    composite,
    groupOver,
    matteOver
};

export {programSources, vertex};
