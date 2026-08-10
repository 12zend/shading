# Movie

## Product

Movie is an independent, block-based engine for producing animation and video. It is forked from TurboWarp so creators can use a familiar Scratch-style editor while working with filmmaking features that Scratch projects do not support, including deterministic timelines, video assets, 3D scenes, cameras, model animation, rendering frames, and offline export.

Movie is not a Scratch mod whose primary goal is to run every project on scratch.mit.edu. Its project format may contain Movie-only assets and blocks. The editor must make that distinction clear and save such work as a Movie project.

## Audience

- Animators and video creators who prefer visual programming.
- Scratch and TurboWarp users who want a gradual path into 3D and timeline-based production.
- Educators and small creative teams building repeatable, inspectable animation workflows.

## Product Principles

1. **Frames are deterministic.** A project rendered at a given timeline time and animation frame should produce the same image.
2. **Complex media stays approachable.** Creators work with models, motions, poses, cameras, and frames; low-level bone manipulation is not required for ordinary animation.
3. **Assets belong to an explicit owner.** Videos and 3D models are assigned per sprite. Every model retains its source type (GLB, PMX, FBX, or OBJ/MTL) even when Movie normalizes storage to GLB.
4. **Movie capabilities are explicit.** Movie-only blocks and assets are recorded as project features and use the `.shade` format when necessary.
5. **Compatibility is additive.** Existing opcodes, block inputs, field meanings, and saved project data must not be changed incompatibly. New behavior that would alter an existing block is introduced as a new block. Legacy opcodes remain loadable even when they are no longer shown in the toolbox.
6. **Future formats share concepts.** Frame selection is model-level rather than VMD-specific, so the same block can drive VMD and future animation formats.

## Core Experience

Creators import media in asset tabs, assemble behavior with blocks, preview against a deterministic timeline, and export captured rendering frames. The Models tab supports model-type-aware imports. PMX provides rigged model data; VMD motions and VPD poses are attached to the selected model below its preview. The active motion or pose is evaluated with `set model frame to (frame)` and then drawn with the existing model rendering blocks.

## Project and Compatibility Contract

- Standard Scratch-compatible data remains readable wherever Movie has not introduced a Movie-only feature.
- Movie-only blocks are additive and must be tracked by the project feature detector.
- Serialized model descriptors are forward-compatible: optional fields use safe defaults, and older descriptors containing only GLB metadata continue to load.
- Imported model formats may be normalized internally, but their source format and assigned motion metadata remain available to the editor.
- Changes to familiar blocks such as `go to` must never append new fields or menus that reinterpret old projects. Add a separate, clearly named block for new semantics.

## Platform

Web. The editor targets modern desktop browsers and uses TurboWarp's GUI, VM, renderer, and extension ecosystem as its foundation.

## Interface Register

Product UI. Preserve the established TurboWarp/Scratch component language, density, keyboard behavior, focus treatment, and category colors. New media controls should feel native to the existing asset editors rather than like a separate application.

## Current Scope

- Timeline playback and deterministic rendering-frame capture.
- Video, text, 2.5D sprites, 3D models, cameras, and shared scene rendering.
- GLB, PMX, FBX, and OBJ/MTL model import with normalized GLB project storage.
- VMD motion and VPD pose assignment per rigged model.
- Frame-based model animation through a format-neutral block.

## Near-Term Direction

- Improve external texture collection for PMX and OBJ imports.
- Add further model and animation formats, including richer FBX and possible future formats, without changing the frame block contract.
- Expand rendering quality and export controls while keeping preview and final output deterministic.
