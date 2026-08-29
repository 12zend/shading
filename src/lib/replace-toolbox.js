const replaceToolbox = (workspace, toolboxXML, discardRecycledBlocks = false) => {
    const flyout = discardRecycledBlocks && workspace && typeof workspace.getFlyout === 'function' ?
        workspace.getFlyout() : null;
    const canControlRecycling = flyout && typeof flyout.setRecyclingEnabled === 'function';
    if (canControlRecycling) flyout.setRecyclingEnabled(false);
    try {
        workspace.updateToolbox(toolboxXML);
    } finally {
        if (canControlRecycling) flyout.setRecyclingEnabled(true);
    }
};

export default replaceToolbox;
