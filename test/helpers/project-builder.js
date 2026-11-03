// Builds small sb3 project JSON for tests and the frame-hash script: a stage that holds the variables and a sprite
// named "main" that holds the scripts. Shared by test/helpers/movie-determinism.js and scripts/frame-hash/.
const literal = value => (typeof value === 'number' ? [4, String(value)] : [10, String(value)]);

/**
 * Build a project with a stage (holding the variables) and a sprite named "main" holding the scripts.
 * A script is {hat: opcode | {opcode, inputs, fields}, body: [statement]}; a statement or reporter is
 * {opcode, inputs: {NAME: number | string | reporter}, fields: {NAME: value | [value, id]}, substack: [statement]}.
 * @param {object} options {variables: {name: value}, scripts: [script], costume: sb3 costume for "main"}.
 * @returns {object} sb3 project JSON.
 */
const buildProject = ({variables = {}, scripts = [], costume = null} = {}) => {
    const blocks = {};
    let nextId = 0;
    const id = prefix => `${prefix}${nextId++}`;
    const variableIds = {};
    Object.keys(variables).forEach(name => {
        variableIds[name] = `var-${name}`;
    });

    const addFields = fields => {
        const result = {};
        Object.keys(fields || {}).forEach(name => {
            const value = fields[name];
            if (name === 'VARIABLE') result[name] = [value, variableIds[value] || value];
            else result[name] = Array.isArray(value) ? value : [value, null];
        });
        return result;
    };

    const addBlock = (spec, parent) => {
        const blockId = id(spec.opcode.split('_')[0]);
        const block = {
            opcode: spec.opcode,
            next: null,
            parent,
            inputs: {},
            fields: addFields(spec.fields),
            shadow: false,
            topLevel: parent === null
        };
        if (parent === null) {
            block.x = 0;
            block.y = 0;
        }
        blocks[blockId] = block;
        Object.keys(spec.inputs || {}).forEach(name => {
            const value = spec.inputs[name];
            if (value && typeof value === 'object') {
                block.inputs[name] = [3, addBlock(value, blockId), literal(0)];
            } else {
                block.inputs[name] = [1, literal(value)];
            }
        });
        if (spec.substack) {
            const first = addStack(spec.substack, blockId);
            if (first) block.inputs.SUBSTACK = [2, first];
        }
        return blockId;
    };

    const addStack = (statements, parent) => {
        let first = null;
        let previous = null;
        for (const statement of statements) {
            const blockId = addBlock(statement, previous || parent);
            if (previous) blocks[previous].next = blockId;
            else first = blockId;
            previous = blockId;
        }
        return first;
    };

    for (const script of scripts) {
        const hat = typeof script.hat === 'string' ? {opcode: script.hat} : script.hat;
        const hatId = addBlock(hat, null);
        const first = addStack(script.body || [], hatId);
        blocks[hatId].next = first;
    }

    const stageVariables = {};
    Object.keys(variables).forEach(name => {
        stageVariables[variableIds[name]] = [name, variables[name]];
    });
    const target = (isStage, name, targetBlocks, targetVariables) => ({
        isStage,
        name,
        variables: targetVariables,
        lists: {},
        broadcasts: {},
        blocks: targetBlocks,
        comments: {},
        costumes: !isStage && costume ? [costume] : [],
        sounds: [],
        currentCostume: 0,
        volume: 100,
        layerOrder: isStage ? 0 : 1,
        ...(isStage ? {tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null} : {
            visible: false, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
        })
    });
    return {
        targets: [target(true, 'Stage', {}, stageVariables), target(false, 'main', blocks, {})],
        monitors: [],
        extensions: ['objects'],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
};

export {buildProject};
