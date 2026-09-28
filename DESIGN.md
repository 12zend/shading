---
name: Shading
description: A block-based animation and video editor dressed as an on-set camera monitor.
colors:
  selected-amber: "#ffb020"
  amber-deep: "#d68f0a"
  amber-lit: "#ffcf6b"
  amber-ink: "#1a1200"
  amber-link: "#ffc453"
  rec-red: "#ff3b30"
  fault-orange: "#ff6a3d"
  zone-0-glass: "#08090a"
  zone-1-page: "#0e0f11"
  zone-2-panel: "#141619"
  zone-3-raised: "#1b1d21"
  zone-4-control: "#24272c"
  zone-5-strong: "#30343a"
  zone-6-disabled: "#464b53"
  zone-7-quiet: "#6b7079"
  zone-8-secondary: "#9a9ea5"
  zone-9-primary: "#c9cbcf"
  zone-10-emphasis: "#eceae5"
  rule: "#eceae514"
  rule-strong: "#eceae526"
  osd-rule: "#eceae51f"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Yu Gothic UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Yu Gothic UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Yu Gothic UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Yu Gothic UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  label-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Yu Gothic UI, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
  timecode:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 600
    letterSpacing: "0.04em"
    fontFeature: "tnum"
  numeric:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.625rem"
    fontWeight: 500
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  osd-status:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.625rem"
    fontWeight: 700
    letterSpacing: "0.08em"
    fontFeature: "tnum"
rounded:
  s: "2px"
  tally: "3px"
  m: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  field-gap: "14px"
  lg: "16px"
  xl: "32px"
components:
  osd-strip:
    backgroundColor: "{colors.zone-0-glass}"
    textColor: "{colors.zone-9-primary}"
    typography: "{typography.label}"
    height: "40px"
    padding: "0 6px"
  osd-readout:
    backgroundColor: "{colors.zone-1-page}"
    textColor: "{colors.zone-8-secondary}"
    typography: "{typography.numeric}"
    rounded: "{rounded.m}"
    height: "28px"
    padding: "0 12px 0 4px"
  osd-tally-standby:
    textColor: "{colors.zone-7-quiet}"
    typography: "{typography.osd-status}"
    rounded: "{rounded.tally}"
    height: "20px"
    padding: "0 8px"
  osd-tally-run:
    textColor: "{colors.selected-amber}"
  osd-tally-rec:
    backgroundColor: "{colors.rec-red}"
    textColor: "#ffffff"
  menu-bar-item:
    textColor: "{colors.zone-9-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.m}"
    height: "28px"
    padding: "0 8px"
  menu-bar-item-hover:
    backgroundColor: "{colors.zone-4-control}"
    textColor: "{colors.zone-10-emphasis}"
  menu:
    backgroundColor: "{colors.zone-1-page}"
    textColor: "{colors.zone-10-emphasis}"
    rounded: "{rounded.m}"
    padding: "4px 0"
    width: "200px"
  menu-item:
    typography: "{typography.label}"
    rounded: "{rounded.tally}"
    height: "28px"
    padding: "0 12px"
  menu-item-hover:
    backgroundColor: "{colors.zone-4-control}"
  rail-tab:
    backgroundColor: "{colors.zone-0-glass}"
    textColor: "{colors.zone-8-secondary}"
    typography: "{typography.label-small}"
    width: "76px"
  rail-tab-selected:
    backgroundColor: "{colors.zone-3-raised}"
    textColor: "{colors.zone-10-emphasis}"
  button-primary:
    backgroundColor: "{colors.selected-amber}"
    textColor: "{colors.amber-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.m}"
    height: "30px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.amber-lit}"
  button-secondary:
    backgroundColor: "{colors.zone-4-control}"
    textColor: "{colors.zone-10-emphasis}"
    rounded: "{rounded.m}"
    height: "30px"
    padding: "0 14px"
  button-secondary-hover:
    backgroundColor: "{colors.zone-5-strong}"
  transport-key:
    backgroundColor: "{colors.zone-3-raised}"
    textColor: "{colors.zone-9-primary}"
    rounded: "{rounded.m}"
    size: "28px"
  transport-key-hover:
    backgroundColor: "{colors.zone-5-strong}"
    textColor: "{colors.zone-10-emphasis}"
  transport-play:
    backgroundColor: "{colors.selected-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.m}"
    width: "36px"
    height: "28px"
  input:
    backgroundColor: "{colors.zone-0-glass}"
    textColor: "{colors.zone-10-emphasis}"
    typography: "{typography.label}"
    rounded: "{rounded.m}"
    height: "30px"
    padding: "0 10px"
  asset-tile:
    backgroundColor: "{colors.zone-2-panel}"
    textColor: "{colors.zone-9-primary}"
    rounded: "{rounded.m}"
  asset-tile-selected:
    backgroundColor: "{colors.zone-3-raised}"
    textColor: "{colors.zone-10-emphasis}"
  timeline-panel:
    backgroundColor: "{colors.zone-2-panel}"
    textColor: "{colors.zone-9-primary}"
    rounded: "{rounded.m}"
    padding: "8px"
  modal-header:
    backgroundColor: "{colors.zone-1-page}"
    textColor: "{colors.zone-10-emphasis}"
    typography: "{typography.title}"
    height: "50px"
  action-button:
    backgroundColor: "{colors.selected-amber}"
    rounded: "{rounded.m}"
    size: "44px"
---

# Design System: Shading

## Overview

**Creative North Star: "The On-Set Camera Monitor"**

The stage is the picture; everything around it is on-screen display laid over black glass. Chrome reads like a field monitor's OSD: a thin status strip across the top, measurements set in tabular mono on a fixed-width graticule, hairline rules instead of panels-on-panels, and one warm marker colour that says "this is the selected thing". The creator spends long sessions in dim rooms beside other video tools, so the surround is dark, low-chroma and quiet, and the picture is always the brightest, most saturated object in view (along with the block categories, which keep their Scratch colours).

Density is instrument-grade: 28px controls, 10–13px type, 4px corners. Nothing is rounded, pastel or tabbed-folder; nothing is a generic grey NLE panel either. Every grey comes from one 11-step zone ramp, and state is spoken in exactly two chromatic voices: amber for selected/active/playing, REC red for rendering. The OSD strip and drop-down menus stay black glass in both themes; the light theme re-maps the zone ramp to paper and is selectable, but dark is the default and the reference.

**Key Characteristics:**
- One 11-step neutral zone ramp (glass to paper) is the only source of grey.
- Amber marks selection, the active page, focus, and play/run; REC red marks rendering only.
- Hairline 1px rules at low alpha; 2–4px corners; tonal layering over shadow.
- Platform tabular mono for every number (timecode, fps, resolution, counts, zoom); the platform UI face for labels.
- Corner brackets mark selection and frame the stage, the way a monitor marks a focus area.
- A 40px OSD strip on top, a 76px vertical page rail on the left, and a transport with one lit key.

## Colors

A near-black, faintly cool zone ramp carrying a single warm amber marker and a reserved broadcast red.

### Primary
- **Selected Amber** (`selected-amber`): the monitor's "selected" marker. Active rail page brackets, selected asset outline and brackets, focus outlines (1px), text caret, `::selection` tint (at ~35% alpha), the primary key on any surface (Share, empty-state action, the transport Play key, the add-asset action button) and the RUN/PLAY tally. It is the default accent (`src/lib/themes/accent/amber.js`) and fills the legacy `looks-secondary`, `motion-primary` and `extensions-primary` slots so inherited components pick it up.
- **Amber Deep** (`amber-deep`): pressed/tertiary amber and the grab-handles of a kept range in the video trimmer.
- **Amber Lit** (`amber-lit`): hover state of every amber key, and the block drop highlight.
- **Amber Ink** (`amber-ink`): text and glyphs set on amber. Ink on amber is always dark, never white.
- **Amber Link** (`amber-link`): inline links on dark surfaces.

### Secondary
- **REC Red** (`rec-red`): rendering only. The REC tally (filled, white ink, blinking lamp) and the timeline's recording status line. Light theme uses a deeper `#e0281e`.

### Tertiary
- **Fault Orange** (`fault-orange`): errors and alerts (`error-primary`), kept distinct from REC so a failure never reads as "recording".

### Neutral
The zone ramp, dark theme values (light theme remaps each step; see sidecar):
- **Glass** (`zone-0-glass`): OSD strip, page rail, input wells, full-screen surround. The deepest black; OSD material.
- **Page** (`zone-1-page`): editor page, asset pane, block toolbox and flyout, menu and OSD readout fields, modal headers.
- **Panel** (`zone-2-panel`): block workspace, timeline panel, modals, asset tiles, paint artboard surround.
- **Raised** (`zone-3-raised`): hovered/selected rail tab, hovered asset tile, transport keys, popovers, block context menus.
- **Control** (`zone-4-control`): secondary buttons, OSD hover, grid dots, action-menu drawer.
- **Strong** (`zone-5-strong`): control hover, block context-menu active row, tooltips, scrollbar thumb.
- **Disabled** (`zone-6-disabled`): disabled ink, hovered tile border, scrollbar thumb hover.
- **Quiet** (`zone-7-quiet`): non-text marks and large-only quiet ink (units, timecode separators, idle STBY tally).
- **Secondary Ink** (`zone-8-secondary`): secondary text, rail labels, metadata, toolbox labels.
- **Primary Ink** (`zone-9-primary`): body and control text.
- **Emphasis Ink** (`zone-10-emphasis`): headings, timecode, values, selected labels. Warm paper white, never pure #fff.
- **Rule** (`rule`) and **Rule Strong** (`rule-strong`): paper white at 8% and 15% alpha. Every divider, pane edge, control border and the stage border. **OSD Rule** (`osd-rule`, 12%) is the hairline inside the black-glass OSD strip and menus.

Block category colours (Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables, My Blocks, Pen, extensions) remain the Scratch palette. They are a product constraint, not part of this palette, and are never re-tinted into the zone ramp or into amber.

### Named Rules
**The One Ramp Rule.** Every grey is a zone step (or a paper-white rule alpha). If a neutral is not on the ramp, it is drift.

**The Two Voices Rule.** Amber means selected, focused, active or playing. REC red means rendering. Neither is decoration, and neither borrows the other's meaning.

**The Dark Ink On Amber Rule.** Anything placed on amber is set in Amber Ink; white-on-amber fails.

## Typography

**Label Font:** the platform UI face (`--font-ui`: -apple-system, BlinkMacSystemFont, Segoe UI, then Hiragino Sans / Hiragino Kaku Gothic ProN / Noto Sans JP / Yu Gothic UI for Japanese, then sans-serif)
**Numeric Font:** the platform tabular mono (`--font-mono`: SF Mono, ui-monospace, Menlo, Consolas, Liberation Mono, monospace). No webfont ships for either role.

**Character:** A native, unbranded label face so the chrome recedes like instrument lettering, paired with the system's own monospaced numerals so every changing figure sits still on its grid.

### Hierarchy
- **Headline** (600, 15px): empty-state titles in asset tabs.
- **Title** (600, 14px, +0.01em): modal headers, timeline title.
- **Body** (400, 13px, 1.5): explanatory copy; empty-state paragraphs cap at 30rem.
- **Label** (600, 12px; 500 in menu rows and inputs): menu bar, menu items, buttons, fields.
- **Label Small** (600, 10px, 1.2): page-rail captions, asset tile info; never breaks mid-word (`keep-all`).
- **Timecode** (mono 600, 13px, +0.04em, tabular): the SMPTE clock `HH:MM:SS:FF` in the OSD strip and the timeline transport. One format everywhere (`src/lib/timecode.js`).
- **Numeric** (mono 500, 10px, +0.02em, tabular): fps, resolution, frame counts, zoom level, sprite coordinates and indices (9px on tiles).
- **OSD Status** (mono 700, 10px, +0.08em, uppercase words): tally words STBY / RUN / PLAY / REC, the TURBO flag, and unit labels (FPS).

### Named Rules
**The Graticule Rule.** Every number that can change is set in `--font-mono` with `tabular-nums`, so readouts never jitter.

**The Status-Word Rule.** Tracked uppercase belongs only to OSD status words and units. Labels, headings and section names stay in sentence case in the UI face.

## Layout

A fixed monitor layout, not a card grid. A 40px OSD strip spans the top: menus and project title left; block search, save state, then the OSD readout anchored immediately beside Share so it never shifts as tab-specific tools come and go (the fps and resolution fields drop below 1180px wide; tally and timecode stay). A 76px vertical page rail sits at the left edge (icon over 10px caption; horizontal hairline on its inner edge, mirrored in RTL). The block workspace takes the centre. The right column holds the stage with frame guides, then the transport and the timeline filling the remaining height; run/stop live on the timeline transport, not the top bar.

Spacing rides a 4px step with 8px (`$space`, 0.5rem) as the base unit: 4px inside tight groups, 8px panel padding, 12px menu-row and readout padding, 14px between OSD readout fields, 16px modal header padding, 32px empty-state padding. Control heights are uniform: 28px for keys, menu rows and bar items, 30px for fields and text buttons, 44px for the floating add action.

## Elevation & Depth

Depth is tonal first: surfaces step up the zone ramp (glass → page → panel → raised) and are separated by hairline rules, not shadows. Shadows appear only on things that float above the layout (menus, modals, popovers, the add-asset action) and are soft, dark and downward; nothing at rest in the layout casts one. Selection is expressed with an amber 1px ring and brackets, never with lift.

### Shadow Vocabulary
- **Menu drop** (`box-shadow: 0 12px 28px -6px var(--shadow), 0 2px 6px var(--shadow)`): drop-down menus.
- **Modal drop** (`box-shadow: 0 24px 64px -12px #000000cc, 0 2px 8px var(--shadow)`): modal dialogs over the 72% black overlay.
- **Action drop** (`box-shadow: 0 6px 16px -6px var(--shadow)`): the square add-asset key.
- **Popover** (`box-shadow: 0 0 8px 1px var(--shadow)`): paint and GUI popovers.
- **Focus ring** (`box-shadow: 0 0 0 1px var(--zone-0), 0 0 0 2px var(--looks-secondary)`): focus on composited keys; elsewhere focus is `outline: 1px solid` amber at 1px offset.
- **Selected ring** (`box-shadow: 0 0 0 1px var(--looks-secondary)`): selected asset tile and focused input, doubling the 1px amber border.

`--shadow` is `#00000099` in dark and 15% black in light.

### Named Rules
**The Flat Glass Rule.** Surfaces at rest are flat and separated by tone and hairlines. Only floating layers cast shadow.

## Shapes

Near-square. `--radius-s` (2px) for the smallest marks, 3px for tally chips and menu rows inset in a menu, `--radius-m` (4px) for every control, field, tile, panel, menu and modal. The stage itself has square corners (0) with a 1px Rule Strong border. Borders are 1px hairlines. Circles appear only as status lamps (6px tally lamp, 7px recording dot). The scrollbar thumb is the one pill (10px radius, thin, inset 3px), a browser-surface concession.

The signature form is the **corner bracket**: an L-shaped mark on two diagonal corners (top-left and bottom-right), 2px amber stroke, 7–8px arms, drawn on the selected rail page and the selected asset tile. On the stage, all four corners carry white 1px frame guides with 10px arms, inset 6px, at 40% opacity with `mix-blend-mode: difference` so they stay visible over any picture.

## Components

### Buttons
Square lit keys, not bubbles.
- **Shape:** 4px corners (`{rounded.m}`), no border on primary.
- **Primary:** Selected Amber fill, Amber Ink label, 12px/600 (700 on the empty-state action), 30px tall, 14px side padding. Used once per region (Share, the empty-state action, Play).
- **Hover / Focus:** hover lifts to Amber Lit; focus is a 1px amber outline at 1px offset. Transitions are 120ms ease-out on colour only.
- **Secondary:** Control fill (zone-4), Emphasis Ink, 1px Rule Strong border; hover to zone-5.
- **Transport keys:** 28px square, zone-3 with Rule Strong border; hover zone-5. Active toggles keep zone-5 and switch their glyph to amber.

### OSD Readout (signature)
A 28px black-glass field inside the OSD strip: tally chip, SMPTE timecode, then fps and resolution fields separated by 1px OSD rules, and a TURBO flag when on. The tally is a 20px, 3px-radius chip with a 6px lamp: STBY in Quiet ink, RUN and PLAY in amber ink, REC as a filled red chip with white ink and a 1s stepped lamp blink (disabled under `prefers-reduced-motion`). Timecode is written directly each frame, not re-rendered.

### Page Rail (Navigation)
76px column on Glass. Each page is an icon (20px, monochrome via `rail-icon-filter`, 72% opacity) over a 10px caption in Secondary Ink. Hover and selected pages step to Raised with Emphasis Ink and a full-opacity icon; the selected page adds amber corner brackets. Glyphs are monochrome instrumentation: the rail is not a palette. In the light theme the rail follows the theme (paper zone steps, dark glyphs).

### Menus
Drop-downs read as an OSD overlay in both themes: Page-black field, 1px OSD rule edge, 4px corners, 4px vertical padding, 28px rows with 12px padding and 3px inset radius, 12px/500 labels, hover to Control; sections split by a 1px OSD rule. Menu-bar items above them are 28px, 4px corners, hover to Control with Emphasis Ink, icons forced white.

### Inputs / Fields
- **Style:** 30px, Glass well, 1px Rule Strong border, 4px corners, 12px/500 Emphasis Ink, 10px side padding. Numeric-only small fields (56px) switch to mono.
- **Focus:** border and a 1px outer ring both turn amber; hover moves the border to zone-6.
- **In the OSD strip:** the block search field takes the OSD field and rule colours, 28px tall, amber border on focus.

### Asset Tiles
Panel fill, 1px Rule Strong border, 4px corners, 12px labels, a hairline above the info row, mono 9px details and index. Hover steps to Raised with a zone-6 border. Selected: amber 1px border plus 1px amber ring, Raised fill, Emphasis Ink, and amber corner brackets.

### Timeline and Transport
A Panel-toned block with a 1px Rule edge and 4px corners, 8px padding. The timecode is Emphasis Ink mono with Quiet separators; status and frame counts are 10px mono. Play is the one lit key (36×28px amber); stop and the rest are zone-3 keys. While rendering, the status line turns REC red, bold and tracked, led by a 7px red dot.

### Empty State
Shared by the Videos and Sounds tabs: a centred quiet slate on the asset background, 32px padding, a 15px/600 headline in Emphasis Ink, a 13px/1.5 paragraph in Secondary Ink capped at 30rem, then one amber primary key with an optional secondary key 8px beside it.

### Modals
Panel body, 1px Rule Strong edge, 4px corners, Modal drop shadow over a 72% black overlay; a 50px header in Page with a hairline bottom rule and a 14px/600 title. Full-screen modals drop the border and radius.

## Do's and Don'ts

### Do:
- **Do** take every neutral from the zone ramp (`--zone-0` … `--zone-10`) or the paper-white rule alphas (`--rule` 8%, `--rule-strong` 15%, `--osd-rule` 12%).
- **Do** mark the selected, focused, active or playing thing in amber, and set any ink on amber in Amber Ink (#1a1200).
- **Do** set every changing number in `--font-mono` with `tabular-nums`, and every clock as SMPTE `HH:MM:SS:FF` via `src/lib/timecode.js`.
- **Do** use 1px hairlines and 4px corners (`--radius-m`) for controls, fields, tiles, panels, menus and modals.
- **Do** mark selection with the two-corner amber bracket (2px stroke, 7–8px arms) on rail pages and asset tiles.
- **Do** keep the OSD strip and menus black glass in both themes.
- **Do** keep transitions to colour and opacity, 120ms ease-out (160ms for tally changes), and honour `prefers-reduced-motion`.

### Don't:
- **Don't** use REC red for anything but rendering; errors use Fault Orange.
- **Don't** re-tint block category colours; they stay the Scratch palette.
- **Don't** use tracked uppercase for labels, headings or section names; it is reserved for OSD status words and units.
- **Don't** draw corner brackets as decoration; they appear only on selection and as the stage frame guides.
- **Don't** give resting layout surfaces a shadow, or lift a selected item; selection is amber ring and brackets.
- **Don't** round beyond 4px on rectangular UI or use pill buttons; circles are reserved for status lamps.
- **Don't** colour rail or paint-toolbar glyphs; they are monochrome instrumentation.
