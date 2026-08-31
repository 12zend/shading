import {
    SCENE_CATEGORY_CALLBACK,
    SCENE_CREATE_CALLBACK,
    SCENE_GET_OPCODES,
    SCENE_MARKER,
    SCENE_RETURN_OPCODE
} from './my-blocks-scene';
import {
    PRIMARY,
    SECONDARY,
    TERTIARY,
    installMyBlocksShaderBlocks,
    lockShaderColour
} from './my-blocks-shader-blocks';

const parseJSON = (value, fallback = []) => {
    try {
        const result = JSON.parse(value);
        return Array.isArray(result) ? result : fallback;
    } catch (error) {
        return fallback;
    }
};

const numberShadow = '<shadow type="math_number"><field name="NUM"></field></shadow>';

const uid = ScratchBlocks => {
    if (ScratchBlocks.utils && typeof ScratchBlocks.utils.genUid === 'function') {
        return ScratchBlocks.utils.genUid();
    }
    const random = Math.random().toString(36);
    return `scene_${Date.now()}_${random.slice(2)}`;
};

const prepareSceneMutation = (ScratchBlocks, editorMutation) => {
    const mutation = editorMutation.cloneNode(true);
    const userProcCode = mutation.getAttribute('proccode') ||
        mutation.getAttribute('sceneuserproccode') || ScratchBlocks.Msg.PROCEDURE_DEFAULT_NAME || 'scene';
    const userIds = parseJSON(mutation.getAttribute('argumentids') ||
        mutation.getAttribute('sceneuserargumentids'));
    const userNames = parseJSON(mutation.getAttribute('argumentnames') ||
        mutation.getAttribute('sceneuserargumentnames'));
    const userDefaults = parseJSON(mutation.getAttribute('argumentdefaults') ||
        mutation.getAttribute('sceneuserargumentdefaults'));
    const storedCoordinates = parseJSON(mutation.getAttribute('scenecoordinateids'));
    const coordinateIds = storedCoordinates.length === 3 ? storedCoordinates : [
        uid(ScratchBlocks),
        uid(ScratchBlocks),
        uid(ScratchBlocks)
    ];

    mutation.setAttribute(SCENE_MARKER, 'true');
    mutation.setAttribute('sceneid', mutation.getAttribute('sceneid') || uid(ScratchBlocks));
    mutation.setAttribute('sceneuserproccode', userProcCode);
    mutation.setAttribute('sceneuserargumentids', JSON.stringify(userIds));
    mutation.setAttribute('sceneuserargumentnames', JSON.stringify(userNames));
    mutation.setAttribute('sceneuserargumentdefaults', JSON.stringify(userDefaults));
    mutation.setAttribute('scenecoordinateids', JSON.stringify(coordinateIds));
    mutation.setAttribute('proccode', `${userProcCode.trim()} %s %s %s`);
    mutation.setAttribute('argumentids', JSON.stringify(userIds.concat(coordinateIds)));
    mutation.setAttribute('argumentnames', JSON.stringify(userNames.concat(['px', 'py', 'pz'])));
    mutation.setAttribute('argumentdefaults', JSON.stringify(userDefaults.concat(['0', '0', '0'])));
    mutation.setAttribute('warp', 'true');
    return mutation;
};

const stripSceneCoordinates = mutation => {
    const editorMutation = mutation.cloneNode(true);
    const userProcCode = mutation.getAttribute('sceneuserproccode');
    const userIds = mutation.getAttribute('sceneuserargumentids');
    const userNames = mutation.getAttribute('sceneuserargumentnames');
    const userDefaults = mutation.getAttribute('sceneuserargumentdefaults');
    if (userProcCode !== null) editorMutation.setAttribute('proccode', userProcCode);
    if (userIds !== null) editorMutation.setAttribute('argumentids', userIds);
    if (userNames !== null) editorMutation.setAttribute('argumentnames', userNames);
    if (userDefaults !== null) editorMutation.setAttribute('argumentdefaults', userDefaults);
    return editorMutation;
};

const callMutationFromDefinition = definitionMutation => {
    const mutation = document.createElement('mutation');
    mutation.setAttribute('generateshadows', 'true');
    mutation.setAttribute('warp', 'true');
    mutation.setAttribute('proccode', definitionMutation.getAttribute('sceneuserproccode') || 'scene');
    mutation.setAttribute('argumentids', definitionMutation.getAttribute('sceneuserargumentids') || '[]');
    mutation.setAttribute('argumentnames', definitionMutation.getAttribute('sceneuserargumentnames') || '[]');
    mutation.setAttribute('argumentdefaults', definitionMutation.getAttribute('sceneuserargumentdefaults') || '[]');
    mutation.setAttribute(SCENE_MARKER, 'true');
    mutation.setAttribute('sceneid', definitionMutation.getAttribute('sceneid'));
    mutation.setAttribute('sceneproccode', definitionMutation.getAttribute('proccode'));
    return mutation;
};

const defineSceneBlocks = ScratchBlocks => {
    if (!ScratchBlocks.Blocks[SCENE_RETURN_OPCODE]) {
        ScratchBlocks.Blocks[SCENE_RETURN_OPCODE] = {
            init: function () {
                this.jsonInit({
                    message0: 'return RGB if %1 r: %2 g: %3 b: %4',
                    args0: [
                        {type: 'input_value', name: 'CONDITION', check: 'Boolean'},
                        {type: 'input_value', name: 'R', check: ['Number', 'String']},
                        {type: 'input_value', name: 'G', check: ['Number', 'String']},
                        {type: 'input_value', name: 'B', check: ['Number', 'String']}
                    ],
                    inputsInline: true,
                    colour: PRIMARY,
                    colourSecondary: SECONDARY,
                    colourTertiary: TERTIARY,
                    extensions: ['shape_end']
                });
                lockShaderColour(this);
            }
        };
    }

    for (const opcode of Object.keys(SCENE_GET_OPCODES)) {
        const axis = SCENE_GET_OPCODES[opcode];
        if (ScratchBlocks.Blocks[opcode]) continue;
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: `p ${axis}`,
                    output: 'Number',
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: PRIMARY,
                    colourSecondary: SECONDARY,
                    colourTertiary: TERTIARY
                });
                lockShaderColour(this);
            }
        };
    }
};

const patchSceneDefinitions = workspace => {
    if (!workspace) return;
    for (const block of workspace.getAllBlocks()) {
        if (block.type !== 'procedures_definition') continue;
        const input = block.getInput('custom_block');
        const prototype = input && input.connection && input.connection.targetBlock();
        if (prototype && prototype.myBlocksSceneAttributes_) {
            lockShaderColour(block);
            lockShaderColour(prototype);
        }
    }
    for (const block of workspace.getAllBlocks()) {
        if (block.type === 'procedures_call' && block.myBlocksSceneAttributes_) {
            lockShaderColour(block);
        }
    }
};

const starterDefinitionXML = (ScratchBlocks, mutation) => {
    const mutationText = ScratchBlocks.Xml.domToText(mutation);
    return `<xml><block type="procedures_definition">` +
        `<statement name="custom_block"><shadow type="procedures_prototype">${mutationText}` +
        `</shadow></statement><next><block type="${SCENE_RETURN_OPCODE}">` +
        '<value name="CONDITION"></value>' +
        `<value name="R">${numberShadow}</value>` +
        `<value name="G">${numberShadow}</value>` +
        `<value name="B">${numberShadow}</value>` +
        '</block>' +
        `</next></block></xml>`;
};

const createDefinitionCallback = (ScratchBlocks, workspace) => mutation => {
    if (!mutation) return;
    const xml = ScratchBlocks.Xml.textToDom(starterDefinitionXML(ScratchBlocks, mutation)).firstChild;
    ScratchBlocks.Events.setGroup(true);
    try {
        const block = ScratchBlocks.Xml.domToBlock(xml, workspace);
        lockShaderColour(block);
        try {
            const scale = workspace.scale;
            let x = -workspace.scrollX;
            x += workspace.RTL ? workspace.getMetrics().contentWidth - 30 : 30;
            const visibleTop = (-workspace.scrollY + 30) / scale;
            const occupiedBottom = workspace.getTopBlocks(false).reduce((bottom, candidate) => {
                if (candidate === block || candidate.type !== 'procedures_definition') return bottom;
                const position = candidate.getRelativeToSurfaceXY();
                return Math.max(bottom, position.y + 180);
            }, visibleTop);
            block.moveBy(x / scale, Math.max(visibleTop, occupiedBottom));
            block.scheduleSnapAndBump();
        } catch (error) {
            // Placement is best effort and must not prevent the modal from closing.
            // eslint-disable-next-line no-console
            console.warn('[My Blocks Scene] Could not position the new definition.', error);
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[My Blocks Scene] Could not create the scene definition.', error);
    } finally {
        ScratchBlocks.Events.setGroup(false);
    }
};

const xmlNodes = (ScratchBlocks, xml) => {
    const root = ScratchBlocks.Xml.textToDom(`<xml>${xml}</xml>`);
    return Array.from(root.childNodes).filter(node => node.nodeType === 1);
};

const sceneFlyout = (ScratchBlocks, workspace) => {
    patchSceneDefinitions(workspace);
    workspace.registerButtonCallback(SCENE_CREATE_CALLBACK, () => {
        const mutation = ScratchBlocks.Procedures.newProcedureMutation();
        mutation.setAttribute(SCENE_MARKER, 'true');
        mutation.setAttribute('sceneid', uid(ScratchBlocks));
        ScratchBlocks.Procedures.externalProcedureDefCallback(
            mutation,
            createDefinitionCallback(ScratchBlocks, workspace)
        );
    });

    const definitions = workspace.getAllBlocks()
        .filter(block => block.type === 'procedures_prototype' && block.myBlocksSceneAttributes_)
        .map(block => block.mutationToDom(true))
        .sort((a, b) => String(a.getAttribute('sceneuserproccode')).localeCompare(
            String(b.getAttribute('sceneuserproccode'))));
    const callXML = definitions.map(mutation => (
        `<block type="procedures_call" gap="12">${ScratchBlocks.Xml.domToText(
            callMutationFromDefinition(mutation)
        )}</block>`
    )).join('');
    const result = xmlNodes(ScratchBlocks,
        `<button text="Make a Block" callbackKey="${SCENE_CREATE_CALLBACK}"></button>` +
        `${callXML}${callXML ? '<sep gap="36"></sep>' : ''}`);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const flyout = workspace.getFlyout && workspace.getFlyout();
            const flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
            if (!flyoutWorkspace) return;
            for (const block of flyoutWorkspace.getAllBlocks()) {
                if (block.type === 'procedures_call' ||
                    block.type === SCENE_RETURN_OPCODE ||
                    Object.prototype.hasOwnProperty.call(SCENE_GET_OPCODES, block.type)) {
                    lockShaderColour(block);
                }
            }
        }));
    }
    return result;
};

const registerMyBlocksSceneCategory = (ScratchBlocks, workspace) => {
    defineSceneBlocks(ScratchBlocks);
    workspace.registerToolboxCategoryCallback(
        SCENE_CATEGORY_CALLBACK,
        sceneFlyout.bind(null, ScratchBlocks)
    );
    patchSceneDefinitions(workspace);
};

const installMyBlocksSceneBlocks = ScratchBlocks => {
    // This installs the shared procedures mutation hooks, including filtering
    // Scene definitions from the ordinary My Blocks flyout.
    installMyBlocksShaderBlocks(ScratchBlocks);
    defineSceneBlocks(ScratchBlocks);
    const workspacePrototype = ScratchBlocks.WorkspaceSvg && ScratchBlocks.WorkspaceSvg.prototype;
    if (!workspacePrototype || workspacePrototype.myBlocksSceneCategoryPatched_) return;
    workspacePrototype.myBlocksSceneCategoryPatched_ = true;
    const originalRegister = workspacePrototype.registerToolboxCategoryCallback;
    workspacePrototype.registerToolboxCategoryCallback = function (name, callback) {
        const result = originalRegister.call(this, name, callback);
        if (!this.getToolboxCategoryCallback(SCENE_CATEGORY_CALLBACK)) {
            originalRegister.call(this, SCENE_CATEGORY_CALLBACK, sceneFlyout.bind(null, ScratchBlocks));
        }
        return result;
    };
};

const syncSceneCalls = (ScratchBlocks, workspace, definitionMutation) => {
    const sceneId = definitionMutation.getAttribute('sceneid');
    const callMutation = callMutationFromDefinition(definitionMutation);
    for (const block of workspace.getAllBlocks()) {
        if (block.type === 'procedures_call' &&
            block.myBlocksSceneAttributes_ &&
            block.myBlocksSceneAttributes_.sceneid === sceneId) {
            block.domToMutation(callMutation);
        }
    }
    workspace.refreshToolboxSelection_();
};

export {
    SCENE_CATEGORY_CALLBACK,
    SCENE_CREATE_CALLBACK,
    SCENE_GET_OPCODES,
    SCENE_MARKER,
    SCENE_RETURN_OPCODE,
    installMyBlocksSceneBlocks,
    prepareSceneMutation,
    registerMyBlocksSceneCategory,
    stripSceneCoordinates,
    syncSceneCalls
};
