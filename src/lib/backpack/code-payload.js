import blockToImage from './block-to-image';
import createThumbnail from './thumbnail';
import {BLOCKS_DEFAULT_SCALE} from '../layout-constants';
import {MOVIE_PROJECT_FORMAT_VERSION, isMovieBlockOpcode} from '../project-format';
import {Base64} from 'js-base64';

const getSerializedBlocks = blockObjects => (
    blockObjects && blockObjects.extensionURLs ? blockObjects.blocks : blockObjects
);

const addMovieMetadata = blockObjects => {
    const blocks = getSerializedBlocks(blockObjects);
    if (!Array.isArray(blocks) || !blocks.some(block => isMovieBlockOpcode(block && block.opcode))) {
        return blockObjects;
    }
    if (blockObjects && blockObjects.extensionURLs) {
        return Object.assign({}, blockObjects, {
            mb3: {version: MOVIE_PROJECT_FORMAT_VERSION}
        });
    }
    return {
        blocks: blockObjects,
        extensionURLs: {},
        mb3: {version: MOVIE_PROJECT_FORMAT_VERSION}
    };
};

const codePayload = ({blockObjects, topBlockId}) => {
    const payload = {
        type: 'script', // Needs to match backpack-server type name
        name: 'code', // All code currently gets the same name
        mime: 'application/json',
        // Backpack expects a base64 encoded string to store. Cannot use btoa because
        // the code can contain characters outside the 0-255 code-point range supported by btoa
        body: Base64.encode(JSON.stringify(addMovieMetadata(blockObjects))) // Base64 encode the json
    };

    return blockToImage(topBlockId)
        .then(createThumbnail)
        .then(thumbnail => {
            payload.thumbnail = thumbnail;
            return payload;
        });
};

const findTopBlock = payload => {
    const blocks = getSerializedBlocks(payload);
    return blocks.find(i => i.topLevel);
};

const placeInViewport = (payload, workspaceMetrics, isRtl) => {
    const topBlock = findTopBlock(payload);
    if (topBlock) {
        const {scrollX, scrollY, scale} = workspaceMetrics || {
            scrollX: 0,
            scrollY: 0,
            scale: BLOCKS_DEFAULT_SCALE
        };

        const posY = -scrollY + 30;
        let posX;
        if (isRtl) {
            posX = scrollX + 30;
        } else {
            posX = -scrollX + 30;
        }

        topBlock.x = posX / scale;
        topBlock.y = posY / scale;
    }

    return payload;
};

export {
    codePayload as default,
    findTopBlock,
    placeInViewport
};
