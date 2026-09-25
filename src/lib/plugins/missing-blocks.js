// Blocks whose plugin is not installed (or is disabled) have no scratch-blocks definition, and loading them would
// abort the workspace. Before the workspace XML loads, define a grey placeholder for each unknown block type that
// keeps the block's inputs and fields, so scripts stay visible, editable and are saved unchanged.

const PLACEHOLDER_COLOURS = ['#a0a0a0', '#8a8a8a', '#707070'];

const childElements = (element, tagName) => Array.from(element.childNodes || [])
    .filter(node => node.nodeType === 1 && node.tagName.toLowerCase() === tagName);

const collectUnknownBlocks = (ScratchBlocks, dom) => {
    const unknown = new Map();
    const elements = Array.from(dom.getElementsByTagName('block'))
        .concat(Array.from(dom.getElementsByTagName('shadow')));
    for (const element of elements) {
        const type = element.getAttribute('type');
        if (!type || Object.prototype.hasOwnProperty.call(ScratchBlocks.Blocks, type)) continue;
        if (!unknown.has(type)) {
            unknown.set(type, {values: new Set(), statements: new Set(), fields: new Set(), output: false});
        }
        const shape = unknown.get(type);
        const parent = element.parentNode;
        if (element.tagName.toLowerCase() === 'shadow' ||
            (parent && parent.tagName && parent.tagName.toLowerCase() === 'value')) {
            shape.output = true;
        }
        childElements(element, 'value').forEach(node => shape.values.add(node.getAttribute('name')));
        childElements(element, 'statement').forEach(node => shape.statements.add(node.getAttribute('name')));
        childElements(element, 'field').forEach(node => shape.fields.add(node.getAttribute('name')));
    }
    return unknown;
};

const labelFor = type => {
    const match = /^([a-z0-9]+)_(.+)$/i.exec(type);
    return match ? `${match[2]}` : type;
};

/**
 * Define placeholders for block types in `dom` that scratch-blocks does not know.
 * @param {object} ScratchBlocks scratch-blocks.
 * @param {Element} dom Workspace XML.
 * @param {Function} [describe] (type) => extra label text, e.g. the missing plugin's name.
 * @returns {string[]} Block types that received a placeholder.
 */
const defineMissingBlockPlaceholders = (ScratchBlocks, dom, describe) => {
    if (!ScratchBlocks || !ScratchBlocks.Blocks || !dom || typeof dom.getElementsByTagName !== 'function') return [];
    const unknown = collectUnknownBlocks(ScratchBlocks, dom);
    for (const [type, shape] of unknown) {
        const note = describe ? describe(type) : '';
        ScratchBlocks.Blocks[type] = {
            init: function () {
                const header = this.appendDummyInput();
                header.appendField(`⚠ ${labelFor(type)}${note ? ` (${note})` : ''}`);
                for (const name of shape.fields) {
                    if (name) header.appendField(new ScratchBlocks.FieldTextInput(''), name);
                }
                for (const name of shape.values) {
                    if (name) this.appendValueInput(name).appendField(`${name.toLowerCase()}:`);
                }
                for (const name of shape.statements) {
                    if (name) this.appendStatementInput(name);
                }
                this.setInputsInline(true);
                this.setColour(PLACEHOLDER_COLOURS[0], PLACEHOLDER_COLOURS[1], PLACEHOLDER_COLOURS[2]);
                if (shape.output) {
                    this.setOutput(true, null);
                    if (ScratchBlocks.OUTPUT_SHAPE_ROUND) this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_ROUND);
                } else {
                    this.setPreviousStatement(true);
                    this.setNextStatement(true);
                    if (ScratchBlocks.OUTPUT_SHAPE_SQUARE) this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
                }
                this.setTooltip && this.setTooltip( // eslint-disable-line no-unused-expressions
                    'This block comes from a plugin that is not installed. It is kept unchanged.');
            },
            shadingPlaceholder: true
        };
    }
    return Array.from(unknown.keys());
};

export {defineMissingBlockPlaceholders};
