import VmPatcher from './vm-patcher';
import {OP, LIMITS, TARGET_UPDATE_PROPS} from './op-protocol';
import {
    isShareableBlocklyEvent,
    serializeBlocklyEvent
} from '../collaboration-events';
import {describeCollaborationTarget} from '../collaboration-targets';
import {encodeAssetDataUrl} from './vm-assets';

const TARGET_UPDATE_THROTTLE_MS = 100;
const COSTUME_SELECT_DEBOUNCE_MS = 200;

/**
 * Captures local edits as protocol operations.
 *
 * Three capture streams feed `onLocalOp`:
 *  1. Blockly workspace events (block create/delete/change/move)
 *  2. Wrapped VM entry points (sprite add/delete/rename/reorder)
 *  3. A debounced diff of `targetsUpdate` for sprite transforms and the
 *     selected costume - this VM has no SPRITE_INFO_CHANGED event.
 *
 * Every stream no-ops while a remote op is being applied or capture is
 * otherwise suppressed (disconnected, viewer role, snapshot loading).
 */
class OpCapture {
    /**
     * @param {object} options Options.
     * @param {VirtualMachine} options.vm The VM.
     * @param {Function} options.isSuppressed () => boolean.
     * @param {Function} options.onLocalOp (type, payload) => void.
     * @param {Function} options.onCaptureFallback () => void. Called when a
     * local edit could not be expressed as an op and the legacy whole-
     * project sync must carry it instead.
     */
    constructor ({vm, isSuppressed, onLocalOp, onCaptureFallback}) {
        this.vm = vm;
        this.isSuppressed = isSuppressed;
        this.onLocalOp = onLocalOp;
        this.onCaptureFallback = onCaptureFallback;

        this.patcher = new VmPatcher();
        this.workspace = null;
        this.ScratchBlocks = null;

        this._lastPropsByTarget = new Map();
        this._lastCostumeByTarget = new Map();
        this._pendingTargetUpdates = new Map();
        this._targetUpdateTimer = null;
        this._costumeSelectTimer = null;

        this.handleWorkspaceEvent = this.handleWorkspaceEvent.bind(this);
        this.handleTargetsUpdate = this.handleTargetsUpdate.bind(this);

        this._wrapVmMethods();
        this.vm.on('targetsUpdate', this.handleTargetsUpdate);
    }

    /**
     * Start listening to a Blockly workspace. Safe to call again with the
     * same workspace.
     * @param {object} workspace Blockly workspace.
     * @param {object} ScratchBlocks The ScratchBlocks namespace.
     */
    attachWorkspace (workspace, ScratchBlocks) {
        if (this.workspace === workspace && this.ScratchBlocks === ScratchBlocks) return;
        this.detachWorkspace();
        this.workspace = workspace;
        this.ScratchBlocks = ScratchBlocks;
        workspace.addChangeListener(this.handleWorkspaceEvent);
    }

    detachWorkspace () {
        if (this.workspace) this.workspace.removeChangeListener(this.handleWorkspaceEvent);
        this.workspace = null;
        this.ScratchBlocks = null;
    }

    destroy () {
        this.detachWorkspace();
        this.patcher.unpatchAll();
        this.vm.removeListener('targetsUpdate', this.handleTargetsUpdate);
        if (this._targetUpdateTimer) clearTimeout(this._targetUpdateTimer);
        if (this._costumeSelectTimer) clearTimeout(this._costumeSelectTimer);
        this._lastPropsByTarget.clear();
        this._lastCostumeByTarget.clear();
    }

    handleWorkspaceEvent (event) {
        if (this.isSuppressed()) return;
        if (!event || event.type === 'ui' || event.type === 'endDrag') return;
        if (!isShareableBlocklyEvent(event)) return;
        const ScratchBlocks = this.ScratchBlocks;
        const serialized = serializeBlocklyEvent(event, ScratchBlocks);
        if (!serialized) return;
        const editingTarget = this.vm.editingTarget;
        if (!editingTarget) return;
        this.onLocalOp(OP.BLOCK_EVENT, {
            targetId: editingTarget.id,
            target: describeCollaborationTarget(this.vm.runtime, editingTarget),
            event: serialized
        });
    }

    /**
     * Serialize a target into an op payload the receiving peer can hand to
     * vm.addSprite. Asset bytes travel inline in the same op; when any
     * asset is unavailable locally or exceeds the size cap the capture
     * falls back to the legacy whole-project sync instead.
     * @param {string} targetId The sprite to serialize.
     * @returns {object|null} {spriteJson, assets}, or null when the edit
     * cannot be expressed as a self-contained op.
     */
    serializeSprite (targetId) {
        let spriteJson;
        try {
            spriteJson = this.vm.toJSON(targetId);
        } catch (error) {
            return null;
        }
        if (typeof spriteJson !== 'string' || spriteJson.length > LIMITS.MAX_JSON) return null;
        let parsed;
        try {
            parsed = JSON.parse(spriteJson);
        } catch (error) {
            return null;
        }
        const assets = {};
        const items = [].concat(parsed.costumes || [], parsed.sounds || []);
        if (items.length > LIMITS.MAX_ASSET_COUNT) return null;
        for (const item of items) {
            const md5ext = item.md5ext || item.md5;
            if (!md5ext) continue;
            const dataUrl = encodeAssetDataUrl(this.vm, md5ext);
            if (!dataUrl || dataUrl.length > LIMITS.MAX_DATA_URL) return null;
            assets[md5ext] = dataUrl;
        }
        return {spriteJson, assets};
    }

    _wrapVmMethods () {
        const vm = this.vm;
        const runtime = vm.runtime;

        const captureNewTarget = () => {
            // After addSprite/duplicateSprite the VM selects the new target.
            const target = vm.editingTarget;
            if (!target || !target.sprite || target.isStage) return;
            const serialized = this.serializeSprite(target.id);
            if (!serialized) {
                this.onCaptureFallback();
                return;
            }
            this.onLocalOp(OP.SPRITE_ADD, Object.assign({targetId: target.id}, serialized));
        };

        this.patcher.patch(vm, 'addSprite', original => (...args) => {
            const result = original(...args);
            if (result && result.then) {
                result.then(() => {
                    if (!this.isSuppressed()) captureNewTarget();
                });
            }
            return result;
        });

        this.patcher.patch(vm, 'duplicateSprite', original => (...args) => {
            const result = original(...args);
            if (result && result.then) {
                result.then(() => {
                    if (!this.isSuppressed()) captureNewTarget();
                });
            }
            return result;
        });

        this.patcher.patch(vm, 'deleteSprite', original => targetId => {
            const existed = Boolean(runtime.getTargetById(targetId));
            const target = runtime.getTargetById(targetId);
            const descriptor = target ? describeCollaborationTarget(runtime, target) : null;
            const result = original(targetId);
            if (!this.isSuppressed() && existed) {
                this.onLocalOp(OP.SPRITE_DELETE, {targetId, target: descriptor});
            }
            return result;
        });

        this.patcher.patch(vm, 'renameSprite', original => (targetId, newName) => {
            const result = original(targetId, newName);
            if (!this.isSuppressed()) {
                const target = runtime.getTargetById(targetId);
                this.onLocalOp(OP.SPRITE_RENAME, {
                    targetId,
                    target: target ? describeCollaborationTarget(runtime, target) : null,
                    name: target ? target.getName() : newName
                });
            }
            return result;
        });

        this.patcher.patch(vm, 'reorderTarget', original => (targetIndex, newIndex) => {
            const result = original(targetIndex, newIndex);
            if (!this.isSuppressed() && result) {
                const target = runtime.targets[newIndex];
                if (target) {
                    this.onLocalOp(OP.SPRITE_REORDER, {
                        targetId: target.id,
                        target: describeCollaborationTarget(runtime, target),
                        newIndex
                    });
                }
            }
            return result;
        });
    }

    handleTargetsUpdate () {
        const suppressed = this.isSuppressed();
        this._diffTargetProps(suppressed);
        this._diffCostumeSelect(suppressed);
    }

    /**
     * Sprite transform edits (stage drags, sprite info pane) are observed
     * by diffing editable props across targetsUpdate events. Drags fire
     * rapidly, so updates are coalesced per flush.
     */
    /**
     * Diff editable transform props across all original targets.
     * @param {boolean} suppressed Whether capture is currently suppressed;
     * suppressed updates only refresh the baseline.
     */
    _diffTargetProps (suppressed) {
        const current = new Map();
        for (const target of this.vm.runtime.targets) {
            if (!target || !target.isOriginal) continue;
            current.set(target.id, {
                x: target.x,
                y: target.y,
                direction: target.direction,
                size: target.size,
                visible: target.visible,
                rotationStyle: target.rotationStyle,
                draggable: target.draggable
            });
        }

        const changedPropsByTarget = new Map();
        if (!suppressed) {
            for (const [targetId, props] of current.entries()) {
                const previous = this._lastPropsByTarget.get(targetId);
                if (!previous) continue; // first observation: baseline only
                const diff = {};
                for (const key of TARGET_UPDATE_PROPS) {
                    if (props[key] !== previous[key]) diff[key] = props[key];
                }
                if (Object.keys(diff).length > 0) changedPropsByTarget.set(targetId, diff);
            }
        }
        this._lastPropsByTarget = current;

        if (suppressed || changedPropsByTarget.size === 0) return;
        // Merge into any pending flush so rapid drags produce one op.
        this._pendingTargetUpdates = this._pendingTargetUpdates || new Map();
        for (const [targetId, diff] of changedPropsByTarget.entries()) {
            const pending = this._pendingTargetUpdates.get(targetId);
            if (pending) Object.assign(pending, diff);
            else this._pendingTargetUpdates.set(targetId, diff);
        }
        if (this._targetUpdateTimer) return;
        this._targetUpdateTimer = setTimeout(() => {
            this._targetUpdateTimer = null;
            const pending = this._pendingTargetUpdates;
            this._pendingTargetUpdates = new Map();
            if (this.isSuppressed() || !pending) return;
            for (const [targetId, props] of pending.entries()) {
                const target = this.vm.runtime.getTargetById(targetId);
                if (!target) continue;
                this.onLocalOp(OP.TARGET_UPDATE, {
                    targetId,
                    target: describeCollaborationTarget(this.vm.runtime, target),
                    props
                });
            }
        }, TARGET_UPDATE_THROTTLE_MS);
    }

    /**
     * Costume selection has no dedicated VM entry point; diff the editing
     * target's currentCostume on targetsUpdate (debounced).
     */
    /**
     * Diff the editing target's currentCostume (debounced).
     * @param {boolean} suppressed Whether capture is currently suppressed.
     */
    _diffCostumeSelect (suppressed) {
        const target = this.vm.editingTarget;
        if (!target) return;
        const previous = this._lastCostumeByTarget.get(target.id);
        const currentCostume = target.currentCostume;
        this._lastCostumeByTarget.set(target.id, currentCostume);
        if (suppressed || previous === currentCostume) return;
        if (typeof previous === 'undefined') return; // first observation

        if (this._costumeSelectTimer) clearTimeout(this._costumeSelectTimer);
        this._costumeSelectTimer = setTimeout(() => {
            this._costumeSelectTimer = null;
            if (this.isSuppressed() || !this.vm.editingTarget) return;
            this.onLocalOp(OP.COSTUME_SELECT, {
                targetId: this.vm.editingTarget.id,
                target: describeCollaborationTarget(this.vm.runtime, this.vm.editingTarget),
                index: this.vm.editingTarget.currentCostume
            });
        }, COSTUME_SELECT_DEBOUNCE_MS);
    }
}

export default OpCapture;
