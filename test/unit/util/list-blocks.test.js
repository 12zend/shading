import compilerCompatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import installListBlocks, {
    OPCODE,
    changeItemOfListBy,
    installBlockDefinition
} from '../../../src/lib/list-blocks';

const makeListTarget = value => {
    const list = {
        _monitorUpToDate: true,
        value
    };
    return {
        list,
        target: {
            lookupOrCreateList: jest.fn(() => list)
        }
    };
};

describe('Change item of list by block', () => {
    test('adds a numeric change to the selected list item', () => {
        const {list, target} = makeListTarget(['10', 'not a number']);

        const result = changeItemOfListBy({
            INDEX: 1,
            LIST: {id: 'list-id', name: 'scores'},
            VALUE: 2.5
        }, {target});

        expect(result).toBeUndefined();
        expect(list.value).toEqual([12.5, 'not a number']);
        expect(list._monitorUpToDate).toBe(false);
        expect(target.lookupOrCreateList).toHaveBeenCalledWith('list-id', 'scores');
    });

    test('leaves the list unchanged for an invalid index', () => {
        const {list, target} = makeListTarget([10]);

        expect(changeItemOfListBy({
            INDEX: 2,
            LIST: {id: 'list-id', name: 'scores'},
            VALUE: 1
        }, {target})).toBeUndefined();

        expect(list.value).toEqual([10]);
        expect(list._monitorUpToDate).toBe(true);
    });

    test('registers a synchronous primitive and compiler compatibility entry', () => {
        const vm = {runtime: {_primitives: {}}};

        expect(installListBlocks(vm)).toBe(vm);
        expect(vm.runtime._primitives[OPCODE]).toBe(changeItemOfListBy);
        expect(compilerCompatBlocks.stacked).toContain(OPCODE);
        expect(compilerCompatBlocks.stacked.filter(opcode => opcode === OPCODE)).toHaveLength(1);

        const {list, target} = makeListTarget([4]);
        expect(vm.runtime._primitives[OPCODE]({
            INDEX: 1,
            LIST: {id: 'list-id', name: 'scores'},
            VALUE: 1
        }, {target})).toBeUndefined();
        expect(list.value).toEqual([5]);
    });

    test('adds the block directly after replace item in the list flyout', () => {
        const addBlock = jest.fn();
        const addReplaceItemOfList = jest.fn((xmlList, variable) => {
            xmlList.push('replace');
            expect(variable).toBe('scores');
        });
        const DataCategory = function () {};
        DataCategory.addBlock = addBlock;
        DataCategory.addReplaceItemOfList = addReplaceItemOfList;
        const ScratchBlocks = {
            Blocks: {},
            Categories: {dataLists: 'dataLists'},
            DataCategory,
            LIST_VARIABLE_TYPE: 'list'
        };

        installBlockDefinition(ScratchBlocks);
        ScratchBlocks.DataCategory.addReplaceItemOfList([], 'scores');

        expect(addReplaceItemOfList).toHaveBeenCalledTimes(1);
        expect(addBlock).toHaveBeenCalledWith(
            expect.any(Array),
            'scores',
            OPCODE,
            'LIST',
            ['INDEX', 'math_integer', 1],
            ['VALUE', 'math_number', 1]
        );
        expect(ScratchBlocks.Blocks[OPCODE]).toEqual(expect.objectContaining({init: expect.any(Function)}));

        const block = {jsonInit: jest.fn()};
        ScratchBlocks.Blocks[OPCODE].init.call(block);
        expect(block.jsonInit).toHaveBeenCalledWith(expect.objectContaining({
            message0: 'change item %1 of %2 by %3',
            category: 'dataLists',
            extensions: ['colours_data_lists', 'shape_statement']
        }));
    });

    test('does not duplicate the flyout block when installed more than once', () => {
        const addBlock = jest.fn();
        const DataCategory = function () {};
        DataCategory.addBlock = addBlock;
        DataCategory.addReplaceItemOfList = jest.fn();
        const ScratchBlocks = {
            Blocks: {},
            Categories: {dataLists: 'dataLists'},
            DataCategory,
            LIST_VARIABLE_TYPE: 'list'
        };

        installBlockDefinition(ScratchBlocks);
        installBlockDefinition(ScratchBlocks);
        ScratchBlocks.DataCategory.addReplaceItemOfList([], 'scores');

        expect(addBlock).toHaveBeenCalledTimes(1);
    });
});
