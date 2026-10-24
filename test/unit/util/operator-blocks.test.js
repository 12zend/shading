import VM from 'scratch-vm';
import Operators from 'scratch-vm/src/blocks/scratch3_operators';
import {isMovieBlockOpcode} from '../../../scratch-vm/src/lib/project-format';
import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

const operators = new Operators(null);

const variable = name => [3, [12, name, name], [10, '']];
const literal = value => [1, [10, String(value)]];

const project = (opcode, inputs) => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {out: ['out', 0], a: ['a', 0], b: ['b', 0], c: ['c', 0]},
        lists: {},
        broadcasts: {},
        blocks: {
            set: {
                opcode: 'data_setvariableto',
                next: null,
                parent: null,
                inputs: {VALUE: [3, 'op', [10, '']]},
                fields: {VARIABLE: ['out', 'out']},
                shadow: false,
                topLevel: true,
                x: 0,
                y: 0
            },
            op: {
                opcode,
                next: null,
                parent: 'set',
                inputs,
                fields: {},
                shadow: false,
                topLevel: false
            }
        },
        comments: {},
        costumes: [],
        sounds: [],
        currentCostume: 0,
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
});

const load = async (opcode, inputs) => {
    const vm = new VM();
    await vm.loadProject(JSON.stringify(project(opcode, inputs)));
    return vm;
};

const run = (vm, compilerEnabled, values = {}) => {
    vm.setCompilerOptions({enabled: compilerEnabled});
    const runtime = vm.runtime;
    const target = runtime.targets[0];
    for (const [name, value] of Object.entries(values)) {
        target.variables[name].value = value;
    }
    const thread = runtime._pushThread('set', target);
    runtime.sequencer.stepThreads();
    expect(thread.isCompiled).toBe(compilerEnabled);
    return target.variables.out.value;
};

const comparisonCases = [
    [1, 2],
    [2, 1],
    [1, 1],
    ['10', '2'],
    ['a', 'z'],
    ['z', 'a'],
    ['A', 'a'],
    ['', 0],
    [' ', 0],
    ['Infinity', 'Infinity'],
    [-Infinity, 'Infinity'],
    ['1e3', 1000],
    [true, 1],
    [NaN, 'nan']
];

describe('le and ge operators', () => {
    test.each(comparisonCases)('%p ≤ / ≥ %p matches < and > in the interpreter', (left, right) => {
        const args = {OPERAND1: left, OPERAND2: right};
        expect(operators.le(args)).toBe(operators.lt(args) || operators.equals(args));
        expect(operators.ge(args)).toBe(operators.gt(args) || operators.equals(args));
    });

    test.each([
        ['operator_le', 'le'],
        ['operator_ge', 'ge']
    ])('%s gives the same result compiled and interpreted', async (opcode, method) => {
        const dynamic = await load(opcode, {OPERAND1: variable('a'), OPERAND2: variable('b')});
        for (const [a, b] of comparisonCases) {
            const expected = operators[method]({OPERAND1: a, OPERAND2: b});
            expect(run(dynamic, false, {a, b})).toBe(expected);
            expect(run(dynamic, true, {a, b})).toBe(expected);
        }
        for (const [a, b] of [[1, 2], [2, 1], [3, 3], ['-1.5', '2']]) {
            const constant = await load(opcode, {OPERAND1: literal(a), OPERAND2: literal(b)});
            const expected = operators[method]({OPERAND1: String(a), OPERAND2: String(b)});
            expect(run(constant, false)).toBe(expected);
            expect(run(constant, true)).toBe(expected);
        }
    });
});

describe('letters of operator', () => {
    test.each([
        ['apple', 1, 3, 'app'],
        ['apple', 2, 2, 'p'],
        ['apple', 4, 10, 'le'],
        ['apple', -3, 2, 'ap'],
        ['apple', 3, 1, ''],
        ['apple', 6, 8, ''],
        ['apple', 1.9, 3.9, 'app'],
        ['apple', 'foo', 2, 'ap'],
        [12345, 2, 4, '234'],
        ['', 1, 1, '']
    ])('letters of %p from %p to %p is %p', async (string, from, to, expected) => {
        expect(operators.lettersOf({STRING: string, FROM: from, TO: to})).toBe(expected);

        const vm = await load('operator_letters_of', {
            STRING: variable('a'),
            FROM: variable('b'),
            TO: variable('c')
        });
        const values = {a: string, b: from, c: to};
        expect(run(vm, false, values)).toBe(expected);
        expect(run(vm, true, values)).toBe(expected);
    });

    test('works with literal inputs in both execution paths', async () => {
        const vm = await load('operator_letters_of', {
            STRING: literal('banana'),
            FROM: [1, [6, '2']],
            TO: [1, [6, '4']]
        });
        expect(run(vm, false)).toBe('ana');
        expect(run(vm, true)).toBe('ana');
    });
});

describe('power operator', () => {
    test.each([
        [2, 10, 1024],
        ['3', '2', 9],
        [-2, 2, 4],
        [-2, 3, -8],
        [4, 0.5, 2],
        [2, -1, 0.5],
        [0, 0, 1],
        ['foo', 2, 0]
    ])('%p ^ %p is %p', async (base, exponent, expected) => {
        expect(operators.power({NUM1: base, NUM2: exponent})).toBe(expected);

        const dynamic = await load('operator_power', {NUM1: variable('a'), NUM2: variable('b')});
        expect(run(dynamic, false, {a: base, b: exponent})).toBe(expected);
        expect(run(dynamic, true, {a: base, b: exponent})).toBe(expected);

        const constant = await load('operator_power', {NUM1: [1, [4, String(base)]], NUM2: [1, [4, String(exponent)]]});
        expect(run(constant, false)).toBe(expected);
        expect(run(constant, true)).toBe(expected);
    });

    test('returns NaN for a negative base with a fractional exponent', () => {
        expect(Number.isNaN(operators.power({NUM1: -8, NUM2: 1 / 3}))).toBe(true);
    });
});

describe('new operator blocks in the editor', () => {
    test('are registered as primitives, shown in the toolbox and mark Shading projects', () => {
        const opcodes = ['operator_le', 'operator_ge', 'operator_letters_of', 'operator_power'];
        const primitives = operators.getPrimitives();
        const toolbox = makeToolboxXML(false);
        for (const opcode of opcodes) {
            expect(typeof primitives[opcode]).toBe('function');
            expect(toolbox).toContain(`<block type="${opcode}">`);
            expect(isMovieBlockOpcode(opcode)).toBe(true);
        }
    });
});
