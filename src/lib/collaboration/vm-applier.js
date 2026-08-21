import {OpApplier, entityKeysForOp} from './op-applier';
import {OP} from './op-protocol';
import {
    createStorageAsset,
    decodeAssetDataUrl
} from './vm-assets';
import {
    resolveCollaborationTarget
} from '../collaboration-targets';

/**
 * Applies sequenced collaboration ops to the real VM and (when the target
 * is currently being edited) the Blockly workspace. All mutations run
 * inside the base class's remote-apply scope so the capture layer ignores
 * the change events they fire.
 */
class VmApplier extends OpApplier {
    /**
     * @param {object} options Options.
     * @param {VirtualMachine} options.vm The scratch-vm instance.
     * @param {Function} options.getWorkspace () => Blockly workspace or null.
     * @param {Function} options.getScratchBlocks () => ScratchBlocks or null.
     */
    constructor ({vm, getWorkspace, getScratchBlocks}) {
        super();
        this.vm = vm;
        this.getWorkspace = getWorkspace;
        this.getScratchBlocks = getScratchBlocks;

        // Some VM applies (addSprite) are async; chain them so ops always
        // mutate the VM in sequence order.
        this._chain = Promise.resolve();
        this.destroyed = false;
    }

    /**
     * Serialize applies behind an internal promise chain. The suppression
     * depth stays raised for the whole (possibly async) apply, which is
     * safe because applies never overlap. Failures propagate to the caller
     * so the engine can turn them into a resync.
     * @param {string} type Op type.
     * @param {object} payload Op payload.
     * @param {object} [meta] {clientId, seq}.
     * @returns {Promise} Resolves when this op has been applied.
     */
    apply (type, payload, meta = {}) {
        this._chain = this._chain.then(async () => {
            if (this.destroyed) return;
            this._remoteApplyDepth++;
            try {
                await this._apply(type, payload, meta);
            } finally {
                this._remoteApplyDepth--;
            }
        });
        return this._chain;
    }

    destroy () {
        this.destroyed = true;
    }

    /**
     * Synchronous semantic validation, used by the host before assigning a
     * sequence number to a proposal.
     * @param {string} type Op type.
     * @param {object} payload Op payload.
     * @throws When the op cannot apply against current VM state.
     */
    validate (type, payload) {
        const needsTarget = [OP.TARGET_UPDATE, OP.SPRITE_DELETE, OP.SPRITE_RENAME];
        if (needsTarget.indexOf(type) !== -1) {
            const target = this.resolveTarget(payload);
            if (!target) throw new Error(`no such target: ${payload.targetId}`);
        }
    }

    resolveTarget (payload) {
        return resolveCollaborationTarget(
            this.vm.runtime,
            payload.target || null,
            payload.targetId
        );
    }

    _apply (type, payload) {
        switch (type) {
        case OP.BLOCK_EVENT:
            return this._applyBlockEvent(payload);
        case OP.TARGET_UPDATE:
            return this._applyTargetUpdate(payload);
        case OP.SPRITE_ADD:
        case OP.SPRITE_DELETE:
        case OP.SPRITE_RENAME:
        case OP.SPRITE_REORDER:
        case OP.COSTUME_SELECT:
            // Async; the apply chain awaits the returned promise so ops
            // keep mutating the VM strictly in sequence order.
            return this._applyStructuredOp(type, payload);
        default:
            return undefined; // eslint-disable-line no-undefined
        }
    }

    _applyBlockEvent (payload) {
        const target = this.resolveTarget(payload);
        if (!target) return; // target since deleted: identical no-op everywhere

        const ScratchBlocks = this.getScratchBlocks();
        const workspace = this.getWorkspace();
        if (!ScratchBlocks || !workspace || !payload.event) return;

        let restoredEvent;
        try {
            restoredEvent = ScratchBlocks.Events.fromJson(payload.event, workspace);
        } catch (error) {
            return;
        }

        try {
            if (this.vm.editingTarget && this.vm.editingTarget.id === target.id) {
                ScratchBlocks.Events.disable();
                try {
                    restoredEvent.run(true);
                } finally {
                    ScratchBlocks.Events.enable();
                }
            }
            target.blocks.blocklyListen(restoredEvent);
        } catch (error) {
            // A UI apply failure must not break the op stream; resyncs
            // repair any divergence through the snapshot path.
        }
    }

    _applyTargetUpdate (payload) {
        const target = this.resolveTarget(payload);
        if (!target) return;
        const props = payload.props;
        if (typeof props.x === 'number' || typeof props.y === 'number') {
            target.setXY(
                typeof props.x === 'number' ? props.x : target.x,
                typeof props.y === 'number' ? props.y : target.y
            );
        }
        if (typeof props.direction === 'number') target.setDirection(props.direction);
        if (typeof props.size === 'number') target.setSize(props.size);
        if (typeof props.visible === 'boolean') target.setVisible(props.visible);
        if (typeof props.rotationStyle === 'string' && typeof target.setRotationStyle === 'function') {
            target.setRotationStyle(props.rotationStyle);
        }
        if (typeof props.draggable === 'boolean' && typeof target.setDraggable === 'function') {
            target.setDraggable(props.draggable);
        }
        this.vm.runtime.requestTargetsUpdate(target);
    }

    async _applyStructuredOp (type, payload) {
        const vm = this.vm;
        const runtime = vm.runtime;

        switch (type) {
        case OP.SPRITE_ADD: {
            if (runtime.getTargetById(payload.targetId)) return; // replay
            let json;
            try {
                json = JSON.parse(payload.spriteJson);
            } catch (error) {
                throw new Error('sprite-add has invalid JSON');
            }
            for (const md5ext of Object.keys(payload.assets || {})) {
                decodeAssetDataUrl(vm, md5ext, payload.assets[md5ext]);
            }
            this._attachAssets(json.costumes || []);
            this._attachAssets(json.sounds || []);

            // addSprite selects the sprite it created, which would yank
            // every peer's editor onto someone else's new sprite.
            const previousEditingTarget = vm.editingTarget ? vm.editingTarget.id : null;
            const before = new Set(runtime.targets.map(t => t.id));
            await vm.addSprite(json);
            const newTarget = runtime.targets.find(t => !before.has(t.id));
            // Adopt the originator's target id so every peer addresses
            // this sprite identically from now on.
            if (newTarget) newTarget.id = payload.targetId;
            if (previousEditingTarget && runtime.getTargetById(previousEditingTarget)) {
                vm.setEditingTarget(previousEditingTarget);
            }
            vm.emitTargetsUpdate(false);
            return;
        }
        case OP.SPRITE_DELETE: {
            const target = this.resolveTarget(payload);
            if (!target) return;
            vm.deleteSprite(target.id);
            return;
        }
        case OP.SPRITE_RENAME: {
            const target = this.resolveTarget(payload);
            if (!target) return;
            vm.renameSprite(target.id, payload.name);
            return;
        }
        case OP.SPRITE_REORDER: {
            const target = this.resolveTarget(payload);
            if (!target) return;
            const currentIndex = runtime.targets.indexOf(target);
            if (currentIndex === -1) return;
            vm.reorderTarget(currentIndex, payload.newIndex);
            return;
        }
        case OP.COSTUME_SELECT: {
            const target = this.resolveTarget(payload);
            if (!target) return;
            if (target.getCostumes()[payload.index]) {
                target.setCostume(payload.index);
                runtime.requestTargetsUpdate(target);
            }
            return;
        }
        default:
            return undefined; // eslint-disable-line no-undefined
        }
    }

    // Costumes/sounds in a serialized sprite key their asset as `md5ext`,
    // not the runtime's `md5`.
    _attachAssets (items) {
        items.forEach(item => {
            if (!item.md5ext && !item.md5) return;
            const asset = createStorageAsset(this.vm, item.md5ext || item.md5);
            if (asset) {
                item.asset = asset;
                item.assetId = asset.assetId;
            }
        });
    }
}

export default VmApplier;
export {entityKeysForOp};
