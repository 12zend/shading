const STANDARD_UNIFORM_TYPES = Object.freeze({
    u_image: 'sampler2D',
    u_resolution: 'vec2',
    u_time: 'float',
    u_frame: 'int'
});

const VECTOR_COMPONENTS = ['x', 'y', 'z', 'w'];
const SUPPORTED_TYPES = Object.freeze({
    float: {inputType: 'number', size: 1},
    int: {inputType: 'integer', size: 1},
    bool: {inputType: 'boolean', size: 1},
    vec2: {inputType: 'number', size: 2},
    vec3: {inputType: 'number', size: 3},
    vec4: {inputType: 'number', size: 4},
    ivec2: {inputType: 'integer', size: 2},
    ivec3: {inputType: 'integer', size: 3},
    ivec4: {inputType: 'integer', size: 4},
    bvec2: {inputType: 'boolean', size: 2},
    bvec3: {inputType: 'boolean', size: 3},
    bvec4: {inputType: 'boolean', size: 4}
});

const stripComments = source => {
    const text = String(source || '');
    let result = '';
    let state = 'code';
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') {
                result += '\n';
                state = 'code';
            } else {
                result += ' ';
            }
        } else if (state === 'block-comment') {
            if (character === '*' && next === '/') {
                result += '  ';
                index++;
                state = 'code';
            } else {
                result += character === '\n' ? '\n' : ' ';
            }
        } else if (character === '/' && next === '/') {
            result += '  ';
            index++;
            state = 'line-comment';
        } else if (character === '/' && next === '*') {
            result += '  ';
            index++;
            state = 'block-comment';
        } else {
            result += character;
        }
    }
    return result;
};

const humanizeUniform = name => String(name || '')
    .replace(/^u_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() || 'value';

const baseInputId = name => String(name || '')
    .replace(/^u_/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'VALUE';

const uniqueInputId = (candidate, usedIds) => {
    let id = candidate.slice(0, 32);
    let suffix = 2;
    while (usedIds.has(id)) {
        const suffixText = `_${suffix++}`;
        id = `${candidate.slice(0, 32 - suffixText.length)}${suffixText}`;
    }
    usedIds.add(id);
    return id;
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const ANNOTATION_NAMES = new Set(['color', 'menu', 'default']);
const ANNOTATION_PATTERN = /@([A-Za-z]+)\b([^@]*)/g;
const COLOR_UNIFORM_TYPES = new Set(['vec3', 'vec4']);
const MENU_UNIFORM_TYPES = new Set(['int', 'float']);
const MAX_MENU_ITEMS = 32;
const MAX_MENU_ITEM_LENGTH = 64;

const commentText = text => text
    .replace(/^\s*(?:\/\/|\/\*)/, '')
    .replace(/\*\/\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

// Reads `@color`, `@menu` and `@default` from the comment that ends a uniform declaration's line.
const parseUniformAnnotations = text => {
    const annotations = {};
    const comment = commentText(text);
    ANNOTATION_PATTERN.lastIndex = 0;
    let match = ANNOTATION_PATTERN.exec(comment);
    while (match) {
        const name = match[1].toLowerCase();
        if (ANNOTATION_NAMES.has(name)) annotations[name] = match[2].trim();
        match = ANNOTATION_PATTERN.exec(comment);
    }
    return Object.keys(annotations).length ? annotations : null;
};

// The text after a declaration's semicolon up to the end of its line, when that text holds only comments.
const trailingComment = (text, uncommented, end) => {
    const lineEnd = text.indexOf('\n', end);
    const stop = lineEnd === -1 ? text.length : lineEnd;
    if (uncommented.slice(end, stop).trim()) return null;
    return {start: end, end: stop, text: text.slice(end, stop)};
};

const findUniformStatements = source => {
    const text = String(source || '');
    const uncommented = stripComments(text);
    const uniformPattern = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+([^;]+);/g;
    const statements = [];
    let match = uniformPattern.exec(uncommented);
    while (match) {
        const end = match.index + match[0].length;
        statements.push({
            type: match[1],
            declarators: match[2].split(',').map(declaration => declaration.trim()),
            start: match.index,
            end,
            comment: trailingComment(text, uncommented, end)
        });
        match = uniformPattern.exec(uncommented);
    }
    return statements;
};

const parseShaderUniforms = source => {
    const uniforms = [];
    const seen = new Map();
    for (const statement of findUniformStatements(source)) {
        const type = statement.type;
        const annotations = statement.comment && parseUniformAnnotations(statement.comment.text);
        for (const declarator of statement.declarators) {
            const declaratorMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\s*([^\]]+)\s*\])?$/.exec(declarator);
            if (!declaratorMatch) {
                throw new Error(`Could not read uniform declaration: ${declarator}.`);
            }
            const name = declaratorMatch[1];
            if (typeof declaratorMatch[2] !== 'undefined') {
                throw new Error(`Uniform arrays are not supported as block inputs: ${name}.`);
            }
            if (seen.has(name)) {
                if (seen.get(name) !== type) throw new Error(`Uniform ${name} is declared with multiple types.`);
                continue;
            }
            seen.set(name, type);
            const uniform = {name, type};
            if (annotations) uniform.annotations = annotations;
            uniforms.push(uniform);
        }
    }
    return uniforms;
};

const normalizeHexColor = (value, uniformName) => {
    const text = String(value || '').trim()
        .toLowerCase();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
    if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
    if (/^#[0-9a-f]{6}$/.test(text)) return text;
    throw new Error(`@color of ${uniformName} must be a hex color such as #ff8800.`);
};

const splitMenuItems = text => String(text || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length);

const colorInput = (uniform, annotations, base) => {
    if (!COLOR_UNIFORM_TYPES.has(uniform.type)) {
        throw new Error(`@color needs a vec3 or vec4 uniform: ${uniform.name} is ${uniform.type}.`);
    }
    const value = annotations.default || annotations.color;
    return Object.assign(base, {
        type: 'color',
        defaultValue: value ? normalizeHexColor(value, uniform.name) : '#ffffff'
    });
};

const menuInput = (uniform, annotations, base) => {
    if (!MENU_UNIFORM_TYPES.has(uniform.type)) {
        throw new Error(`@menu needs an int or float uniform: ${uniform.name} is ${uniform.type}.`);
    }
    const items = splitMenuItems(annotations.menu);
    if (!items.length) throw new Error(`@menu of ${uniform.name} needs at least one item, such as @menu soft, hard.`);
    if (items.length > MAX_MENU_ITEMS) {
        throw new Error(`@menu of ${uniform.name} has ${items.length} items; the maximum is ${MAX_MENU_ITEMS}.`);
    }
    if (items.some(item => item.length > MAX_MENU_ITEM_LENGTH)) {
        throw new Error(`@menu items of ${uniform.name} must be at most ${MAX_MENU_ITEM_LENGTH} characters.`);
    }
    if (new Set(items).size !== items.length) throw new Error(`@menu items of ${uniform.name} must be unique.`);
    const defaultValue = annotations.default ? annotations.default : items[0];
    if (items.indexOf(defaultValue) === -1) {
        throw new Error(`@default of ${uniform.name} must be one of its @menu items.`);
    }
    return Object.assign(base, {type: 'menu', items, defaultValue});
};

const componentDefaults = (uniform, typeInfo, annotations) => {
    const fallback = typeInfo.inputType === 'boolean' ? false : 0;
    if (!annotations || !annotations.default) return new Array(typeInfo.size).fill(fallback);
    const values = splitMenuItems(annotations.default);
    if (values.length !== 1 && values.length !== typeInfo.size) {
        throw new Error(`@default of ${uniform.name} needs 1 or ${typeInfo.size} comma-separated values.`);
    }
    const defaults = [];
    for (let component = 0; component < typeInfo.size; component++) {
        const text = values[values.length === 1 ? 0 : component];
        if (typeInfo.inputType === 'boolean') {
            if (text !== 'true' && text !== 'false') {
                throw new Error(`@default of ${uniform.name} must be true or false.`);
            }
            defaults.push(text === 'true');
            continue;
        }
        const value = Number(text);
        if (!Number.isFinite(value)) throw new Error(`@default of ${uniform.name} must be a number.`);
        defaults.push(typeInfo.inputType === 'integer' ? Math.round(value) : value);
    }
    return defaults;
};

const inferShaderInputs = (source, maximumInputs = 24) => {
    const inputs = [];
    const usedIds = new Set();
    for (const uniform of parseShaderUniforms(source)) {
        if (Object.prototype.hasOwnProperty.call(STANDARD_UNIFORM_TYPES, uniform.name)) {
            if (STANDARD_UNIFORM_TYPES[uniform.name] !== uniform.type) {
                throw new Error(
                    `Standard uniform ${uniform.name} must use type ${STANDARD_UNIFORM_TYPES[uniform.name]}.`
                );
            }
            continue;
        }
        if (uniform.type.indexOf('sampler') === 0) {
            throw new Error(`Only the standard sampler2D uniform u_image is supported: ${uniform.name}.`);
        }
        const typeInfo = SUPPORTED_TYPES[uniform.type];
        if (!typeInfo) throw new Error(`Uniform ${uniform.name} uses unsupported type ${uniform.type}.`);
        const inputId = baseInputId(uniform.name);
        const label = humanizeUniform(uniform.name);
        const annotations = uniform.annotations || {};
        const isColor = hasOwn(annotations, 'color');
        const isMenu = hasOwn(annotations, 'menu');
        if (isColor && isMenu) throw new Error(`Uniform ${uniform.name} cannot use both @color and @menu.`);
        if (isColor || isMenu) {
            const base = {
                id: uniqueInputId(inputId, usedIds),
                label,
                uniform: uniform.name,
                uniformType: uniform.type
            };
            inputs.push(isColor ? colorInput(uniform, annotations, base) : menuInput(uniform, annotations, base));
            continue;
        }
        const defaults = componentDefaults(uniform, typeInfo, annotations);
        for (let component = 0; component < typeInfo.size; component++) {
            const isVector = typeInfo.size > 1;
            const componentName = VECTOR_COMPONENTS[component];
            const id = uniqueInputId(isVector ? `${inputId}_${componentName.toUpperCase()}` : inputId, usedIds);
            const input = {
                id,
                label: isVector ? `${label} ${componentName}` : label,
                type: typeInfo.inputType,
                uniform: uniform.name,
                uniformType: uniform.type,
                defaultValue: defaults[component]
            };
            if (isVector) {
                input.component = component;
                input.vectorSize = typeInfo.size;
            }
            inputs.push(input);
        }
    }
    if (inputs.length > maximumInputs) {
        throw new Error(`Shader uniforms create ${inputs.length} block inputs; the maximum is ${maximumInputs}.`);
    }
    return inputs;
};

const annotationText = (uniformName, spec) => {
    if (spec.type === 'color') return `@color ${normalizeHexColor(spec.defaultValue || '#ffffff', uniformName)}`;
    if (spec.type !== 'menu') return '';
    const items = Array.isArray(spec.items) ? spec.items.map(item => String(item).trim()) : [];
    if (!items.length || items.some(item => !item || /[,@\n]/.test(item))) {
        throw new Error(`Menu items of ${uniformName} must be non-empty and cannot contain commas or @.`);
    }
    const defaultValue = hasOwn(spec, 'defaultValue') ? String(spec.defaultValue) : items[0];
    return `@menu ${items.join(', ')}${defaultValue === items[0] ? '' : ` @default ${defaultValue}`}`;
};

// Rewrites the annotations in the comment that ends `uniformName`'s declaration so the block shows it as
// `spec.type` (`number`, `color` or `menu`). Other text in that comment is kept.
const setUniformInputType = (source, uniformName, spec) => {
    const text = String(source || '');
    const statement = findUniformStatements(text).find(candidate => candidate.declarators.some(declarator => (
        /^([A-Za-z_][A-Za-z0-9_]*)/.exec(declarator) || [])[1] === uniformName));
    if (!statement) throw new Error(`Uniform ${uniformName} was not found.`);
    if (statement.declarators.length > 1) {
        throw new Error(`Declare ${uniformName} in its own uniform statement to change its block input.`);
    }
    if (!statement.comment) {
        throw new Error(`Move the code after the ${uniformName} declaration to its own line ` +
            'to change its block input.');
    }
    const annotation = annotationText(uniformName, spec);
    const kept = commentText(statement.comment.text)
        .replace(ANNOTATION_PATTERN, (match, name) => (ANNOTATION_NAMES.has(name.toLowerCase()) ? '' : match))
        .replace(/\s+/g, ' ')
        .trim();
    const comment = [kept, annotation].filter(part => part).join(' ');
    // Validate before writing so the editor never stores an annotation the block cannot use.
    const rewritten = text.slice(0, statement.end) + (comment ? ` // ${comment}` : '') +
        text.slice(statement.comment.end);
    inferShaderInputs(rewritten, Infinity);
    return rewritten;
};

export {
    COLOR_UNIFORM_TYPES,
    MENU_UNIFORM_TYPES,
    STANDARD_UNIFORM_TYPES,
    SUPPORTED_TYPES,
    inferShaderInputs,
    parseShaderUniforms,
    parseUniformAnnotations,
    setUniformInputType,
    stripComments
};
