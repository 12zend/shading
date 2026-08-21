/**
 * Records and restores monkey-patched methods so that a collaboration
 * session can wrap VM entry points on connect and - crucially - restore
 * every original on disconnect. Without restoring, a second session would
 * double-send every captured edit.
 */
class VmPatcher {
    constructor () {
        this._patches = [];
    }

    /**
     * Replace obj[method] with wrapper(original). Refuses to double-patch
     * the same method through this patcher.
     * @param {object} obj Owner of the method.
     * @param {string} method Method name.
     * @param {Function} makeWrapper (original) => replacement. `original`
     * is already bound to obj.
     */
    patch (obj, method, makeWrapper) {
        if (!obj || typeof obj[method] !== 'function') {
            throw new Error(`cannot patch missing method: ${method}`);
        }
        if (this._patches.some(entry => entry.obj === obj && entry.method === method)) {
            throw new Error(`method already patched: ${method}`);
        }
        const original = obj[method];
        const wrapper = makeWrapper(original.bind(obj));
        obj[method] = wrapper;
        this._patches.push({obj, method, original, wrapper});
    }

    /**
     * Restore every patched method. Safe to call more than once. If some
     * other code re-patched on top of us, leave its wrapper in place but
     * warn - restoring would destroy the other patch.
     */
    unpatchAll () {
        while (this._patches.length > 0) {
            const {obj, method, original, wrapper} = this._patches.pop();
            if (obj[method] === wrapper) {
                obj[method] = original;
            } else {
                // eslint-disable-next-line no-console
                console.warn(`[collaboration] ${method} was re-patched by someone else; not restoring`);
            }
        }
    }

    get patchCount () {
        return this._patches.length;
    }
}

export default VmPatcher;
