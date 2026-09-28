---
version: 1
slug: "src-components-gui-gui-jsx"
primary_target: "src/components/gui/gui.jsx"
related_targets: ["src/components/menu-bar/menu-bar.jsx"]
---

# Editor shell — surface brief

Scope: the whole Shading editor shell (menu bar, editor tabs, stage, timeline, asset panes, modals, menus) plus the global token layer every component reads. Mode: Operate.

Audience/task: creators building animation and video with blocks; they alternate between assembling blocks, scrubbing the timeline, and judging the stage image for long sessions, usually in dim rooms next to other video tools.

Constraints: keep all editor logic (Blockly, paint, sound, video, 3D, shader, plugins) and every action; keep block category colours; keyboard and focus behaviour intact; light theme remains selectable but dark is default.

## Direction contract

THESIS: The editor is an on-set camera monitor. The stage is the picture; everything around it behaves as OSD — measurements and guides laid over black glass. Refuses the rounded, pastel, tabbed-folder Scratch layout and the generic grey-panel NLE.

OWN-WORLD: An 11-step neutral zone ramp (#08090a → #eceae5) is the only grey. Amber #ffb020 marks the active/selected thing (including play/run state); REC red #ff3b30 is reserved for rendering (REC). Hairline 1px rules, 2–4px radii, corner brackets only on focus/selection and the stage frame guides, the platform tabular mono (SF Mono / Menlo / Consolas) for every number, the platform UI face for labels; tracked uppercase only for OSD status words (tally, units). The OSD strip, page rail and menus stay black glass in both themes.

STORY: The creator reads project state (name, timecode, fps, resolution, run state) at a glance from one OSD strip, switches asset work from a vertical rail, and always sees the picture framed like a monitor.

FIRST VIEWPORT: 40px OSD status bar across the top: menus and project title left; block search, save state, then the OSD readout (tally, SMPTE timecode, fps, resolution) anchored right beside Share so it never shifts. Left: 76px vertical page rail (icon + small label, amber corner brackets on the active page). Centre: block workspace. Right: stage with corner frame guides, then the transport (play is the one lit key) and the timeline filling the rest of the column. Run/stop live on the timeline transport, not the top bar.

FORM: Camera Monitor OSD, position 5 on the grounded list, seed key 97eee675. Raises: every number sits on a fixed-width graticule (from Oscilloscope Bench); greys come only from the 11-step zone ramp (from Exposure Record).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
