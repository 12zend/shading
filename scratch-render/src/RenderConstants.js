/** @module RenderConstants */

/**
 * Various constants meant for use throughout the renderer.
 * @enum
 */
module.exports = {
    /**
     * The ID value to use for "no item" or when an object has been disposed.
     * @const {int}
     */
    ID_NONE: -1,

    /**
     * @enum {string}
     */
    Events: {
        /**
         * Event emitted when the high quality render option changes.
         */
        UseHighQualityRenderChanged: 'UseHighQualityRenderChanged',

        /**
         * Event emitted when the private skin access option changes.
         */
        AllowPrivateSkinAccessChanged: 'AllowPrivateSkinAccessChanged',

        /**
         * NativeSizeChanged event
         *
         * @event RenderWebGL#event:NativeSizeChanged
         * @type {object}
         * @property {Array<int>} newSize - the new size of the renderer
         */
        NativeSizeChanged: 'NativeSizeChanged'
    }
};
