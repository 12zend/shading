---
version: 1
slug: "src-components-gui-gui-jsx"
primary_target: "src/components/gui/gui.jsx"
related_targets: ["src/components/menu-bar/menu-bar.jsx"]
---

# Editor shell — surface brief

Scope: the whole Shading editor shell (toolbar, page sidebar, block workspace, stage, timeline, asset panes, modals, menus) plus the global token layer every component reads. Mode: Operate.

Audience/task: creators building animation and video with blocks; they alternate between assembling blocks, scrubbing the timeline, and judging the stage image for long sessions.

Constraints: keep all editor logic (Blockly, paint, sound, video, 3D, shader, plugins) and every action reachable; keep block category colours; keyboard and focus behaviour intact; dark is default, light stays selectable. User pinned: simpler UI, Apple (macOS standard app) style, system blue accent.

## Direction contract

THESIS: Shading is a native macOS document app: Keynote/Xcode calm, not an instrument panel. One toolbar, one sidebar, one canvas, one inspector column; nothing is shown twice. Refuses the OSD/monitor costume and TurboWarp's pastel Scratch chrome alike.

OWN-WORLD: Apple system greys (#1c1c1e → #f5f5f7 dark ramp; white/#f5f5f7 light), separators at 10% label alpha, system blue #0A84FF as the only accent with white ink, systemRed only for rendering, systemOrange for errors. SF Pro via -apple-system, 13px regular body, 11px captions, SF Mono only for timecode. 6px control radius, 10px panels/popovers/modals, translucent blurred menus with blue-highlighted rows, a 3px soft blue focus ring.

STORY: The creator sees three menus, the project name and Share in the toolbar; picks a page from the sidebar; builds blocks; plays and scrubs from the timeline, where the only clock lives.

FIRST VIEWPORT: 40px unified toolbar (Settings, File, Edit menus; project title with the block search directly right of it; save state; Share as the one blue push button). 72px sidebar of icon-over-label pages, selection as a rounded fill. Block workspace centre. Right column: stage, then timeline card with blue Play, timecode, gear; keyframe and zoom keys below.

FORM: Pinned by the user (macOS standard app), overriding roll 621c037e; roll topology honoured as: nothing duplicated, one lit key per region.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
