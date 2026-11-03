// A stable hash of everything a simulation's result depends on: the block trees under its two hats, the custom
// block definitions they call, the hat inputs, the assets they use and the ordinary variables read at initialize.
// Block IDs do not take part (only opcodes, inputs and fields), so moving or re-creating blocks keeps the hash and
// the computed steps; editing a render-frame script does not change it at all.

// 53-bit string hash (cyrb53) as 14 hex digits.
const hashText = text => {
    let first = 0xdeadbeef;
    let second = 0x41c6ce57;
    const source = String(text);
    for (let index = 0; index < source.length; index++) {
        const code = source.charCodeAt(index);
        first = Math.imul(first ^ code, 2654435761);
        second = Math.imul(second ^ code, 1597334677);
    }
    first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
    second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
    const value = (4294967296 * (2097151 & second)) + (first >>> 0);
    return value.toString(16).padStart(14, '0');
};

const fieldValue = field => {
    if (field && typeof field === 'object' && !Array.isArray(field)) return field.value;
    if (Array.isArray(field)) return field[0];
    return field;
};

const sortedKeys = object => Object.keys(object || {}).sort();

/**
 * Canonical text of a script: opcodes, field values and inputs (recursively), without block IDs.
 * @param {Function} getBlock Returns the VM block for an ID ({opcode, inputs, fields, next, mutation}).
 * @param {string} topId First block of the script.
 * @param {Set<string>} calledProcedures Receives the proccodes of the custom blocks the script calls.
 * @returns {string} Canonical text.
 */
const canonicalScript = (getBlock, topId, calledProcedures = new Set()) => {
    const visiting = new Set();
    const block = id => {
        const node = id ? getBlock(id) : null;
        if (!node || visiting.has(id)) return '_';
        visiting.add(id);
        const fields = sortedKeys(node.fields).map(name => `${name}=${JSON.stringify(fieldValue(node.fields[name]))}`);
        const inputs = sortedKeys(node.inputs).map(name => {
            const input = node.inputs[name];
            const inputId = input && typeof input === 'object' ? (input.block || input.shadow) : null;
            return `${name}:${block(inputId)}`;
        });
        const mutation = node.mutation || {};
        if (node.opcode === 'procedures_call' && mutation.proccode) calledProcedures.add(mutation.proccode);
        const procedure = mutation.proccode ? `<${JSON.stringify(mutation.proccode)}` +
            `${JSON.stringify(mutation.argumentnames || '')}${String(mutation.warp)}>` : '';
        const text = `${node.opcode}${procedure}(${fields.join(',')})[${inputs.join(',')}]`;
        visiting.delete(id);
        return node.next ? `${text};${block(node.next)}` : text;
    };
    return block(topId);
};

/**
 * @param {object} definition Simulation definition.
 * @param {Function} definition.getBlock Block lookup for the target that owns the scripts.
 * @param {string[]} definition.scriptIds Top block IDs (initialize hat, step hat).
 * @param {Function} definition.getProcedureDefinition proccode -> top block ID of its definition, or null.
 * @param {object} definition.inputs Hat input values ({start, rate}).
 * @param {string[]} definition.assets IDs of assets the scripts use.
 * @param {object} definition.variables Ordinary variables and lists the scripts read, by name, at initialize.
 * @param {string} definition.solver Solver ID the scripts use, if any.
 * @returns {string} Hash.
 */
const hashSimulationDefinition = definition => {
    const called = new Set();
    const parts = (definition.scriptIds || []).map(id => canonicalScript(definition.getBlock, id, called));
    const included = new Set();
    const pendingProcedures = () => Array.from(called).filter(proccode => !included.has(proccode))
        .sort();
    // Custom blocks can call further custom blocks: include each definition once, in a stable order.
    for (let pending = pendingProcedures(); pending.length; pending = pendingProcedures()) {
        for (const proccode of pending) {
            included.add(proccode);
            const definitionId = definition.getProcedureDefinition ?
                definition.getProcedureDefinition(proccode) : null;
            const script = canonicalScript(definition.getBlock, definitionId, called);
            parts.push(`procedure ${JSON.stringify(proccode)} ${script}`);
        }
    }
    const listed = values => sortedKeys(values).map(name => `${name}=${JSON.stringify(values[name])}`)
        .join(',');
    parts.push(`inputs ${listed(definition.inputs || {})}`);
    parts.push(`assets ${(definition.assets || []).slice().sort()
        .join(',')}`);
    parts.push(`variables ${listed(definition.variables || {})}`);
    parts.push(`solver ${definition.solver || ''}`);
    return hashText(parts.join('\n'));
};

export {
    canonicalScript,
    hashSimulationDefinition,
    hashText
};
