/*
 * The glyph registry: every icon the kit can draw, as data. There is no icon library, no wildcard import and no lookup by an
 * arbitrary string: `IconName` is a closed union and a new glyph is a reviewed change to this file (its bytes are budgeted in
 * docs/ui-next/status/1a.4a.md).
 *
 * A glyph is an artboard and layers. A layer is one <path>: every shape of one paint is merged into it, so a glyph costs one <svg>
 * and one <path> per paint (two elements for every glyph but the four two-tone status glyphs). A paint is `ink` (currentColor: the
 * glyph follows the text colour of its context), a role the artwork pins to a theme token (the chevron grey and the status colours,
 * resolved in Icon.module.css), or a literal colour that is part of the artwork (the white of a status mark).
 *
 * Provenance and licences. The artwork is the design lab's (mock `icons.js`, tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0):
 *   - Int UI: JetBrains Int UI icons, pinned at intellij-community c91871ae2864649d952825cff72569e3db0e7ac6. Each entry carries
 *     its own copyright line. Apache License 2.0.
 *   - Lucide: ISC License. The glyphs Lucide derives from Feather carry Feather's MIT notice.
 *   The full texts are in packages/kit/NOTICE.
 * Modified from the mock (Apache-2.0 section 4(b)): neutral paints bind to currentColor; shapes are converted to path data and
 * merged into one path per paint; coordinates are rounded to three decimals; the one stroked rectangle of `copy` is drawn as
 * its outline, and the outline of `undo` (the mock holds the cut-out of a stroke, 1,810 bytes of path data) as the stroke it was cut from.
 * Each glyph was rasterized beside its original in WebKit and Chromium and matched pixel for pixel.
 */

/** The name of a glyph in the registry: the only icons the kit draws. A new glyph is a new line here and in `GLYPHS`. */
export type IconName =
  | 'activity'
  | 'arrow-down'
  | 'arrow-down-to-line'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-up-wide-narrow'
  | 'bell'
  | 'bell-off'
  | 'blocks'
  | 'box'
  | 'brick-wall'
  | 'calendar-clock'
  | 'case-sensitive'
  | 'check'
  | 'check-check'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'circle'
  | 'circle-minus'
  | 'clipboard-check'
  | 'clock'
  | 'close'
  | 'columns'
  | 'copy'
  | 'cpu'
  | 'database'
  | 'ellipsis'
  | 'eraser'
  | 'eye'
  | 'eye-off'
  | 'file-cog'
  | 'folder-tree'
  | 'gauge'
  | 'globe'
  | 'hard-drive'
  | 'hard-drive-download'
  | 'hourglass'
  | 'key-round'
  | 'layers'
  | 'layout-template'
  | 'list-filter'
  | 'list-ordered'
  | 'loader'
  | 'loader-circle'
  | 'minus'
  | 'network'
  | 'panel-bottom'
  | 'pause'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'regex'
  | 'repeat'
  | 'rocket'
  | 'ruler'
  | 'scaling'
  | 'scroll-text'
  | 'search'
  | 'search-x'
  | 'server'
  | 'server-cog'
  | 'settings-2'
  | 'shield'
  | 'shield-check'
  | 'split'
  | 'status-error'
  | 'status-info'
  | 'status-success'
  | 'status-warning'
  | 'target'
  | 'trash'
  | 'umbrella'
  | 'undo'
  | 'waypoints';

/** What a layer is painted with: `ink` (the text colour of the context), a role the artwork pins to a theme token, or a literal colour of the artwork. */
export type GlyphPaint = 'ink' | 'chevron' | 'success' | 'error' | 'info' | 'warning' | 'warning-mark' | `#${string}`;

/** One <path>: the merged shapes of one paint. A stroke is 1 wide with butt caps and miter joins unless the layer says otherwise. */
export type GlyphLayer = {
  /** Path data, in the units of the artboard. */
  readonly d: string;
  /** The fill; absent means no fill. */
  readonly fill?: GlyphPaint;
  /** The stroke; absent means no stroke. */
  readonly stroke?: GlyphPaint;
  /** The stroke width in artboard units; absent means 1. */
  readonly width?: number;
  readonly cap?: 'round';
  readonly join?: 'round';
  /** Fill with the even-odd rule. */
  readonly evenodd?: true;
};

/** An artboard (its viewBox is `0 0 box box`) and the layers drawn on it, in order. */
export type Glyph = { readonly box: 16 | 24; readonly layers: readonly [GlyphLayer, ...GlyphLayer[]] };

export const GLYPHS: Readonly<Record<IconName, Glyph>> = {
  /* Lucide activity (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuActivity. */
  activity: { box: 24, layers: [{ d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/down_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowDown. */
  'arrow-down': { box: 16, layers: [{ d: 'M12.354 9.654C12.549 9.458 12.549 9.142 12.354 8.946 12.158 8.751 11.842 8.751 11.646 8.946L8.5 12.093 8.5 2.5C8.5 2.224 8.276 2 8 2 7.724 2 7.5 2.224 7.5 2.5L7.5 12.093 4.354 8.946C4.158 8.751 3.842 8.751 3.646 8.946 3.451 9.142 3.451 9.458 3.646 9.654L7.646 13.654 8 14.007 8.354 13.654 12.354 9.654Z', fill: 'ink', evenodd: true }] },
  /* Lucide arrow-down-to-line (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuArrowDownToLine. */
  'arrow-down-to-line': { box: 24, layers: [{ d: 'M12 17V3M6 11l6 6 6-6M19 21H5', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/left_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowLeft. */
  'arrow-left': { box: 16, layers: [{ d: 'M6.346 3.646C6.542 3.451 6.858 3.451 7.053 3.646 7.249 3.842 7.249 4.158 7.053 4.354L3.904 7.504 13.504 7.504C13.78 7.504 14.004 7.727 14.004 8.004 14.004 8.28 13.78 8.504 13.504 8.504L3.911 8.504 7.054 11.646C7.249 11.842 7.249 12.158 7.054 12.354 6.858 12.549 6.542 12.549 6.346 12.354L2.346 8.354 1.993 8 2.346 7.646 6.346 3.646Z', fill: 'ink', evenodd: true }] },
  /* Int UI general/right_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowRight. */
  'arrow-right': { box: 16, layers: [{ d: 'M9.654 12.354C9.458 12.549 9.142 12.549 8.946 12.354 8.751 12.158 8.751 11.842 8.946 11.646L12.089 8.504 2.496 8.504C2.22 8.504 1.996 8.28 1.996 8.004 1.996 7.727 2.22 7.504 2.496 7.504L12.096 7.504 8.946 4.354C8.751 4.158 8.751 3.842 8.946 3.646 9.142 3.451 9.458 3.451 9.654 3.646L13.654 7.646 14.007 8 13.654 8.354 9.654 12.354Z', fill: 'ink', evenodd: true }] },
  /* Int UI general/up_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowUp. */
  'arrow-up': { box: 16, layers: [{ d: 'M12.354 6.346C12.549 6.542 12.549 6.858 12.354 7.054 12.158 7.249 11.842 7.249 11.646 7.054L8.5 3.907 8.5 13.507C8.5 13.783 8.276 14.007 8 14.007 7.724 14.007 7.5 13.783 7.5 13.507L7.5 3.907 4.354 7.054C4.158 7.249 3.842 7.249 3.646 7.054 3.451 6.858 3.451 6.542 3.646 6.346L7.646 2.346 8 1.993 8.354 2.346 12.354 6.346Z', fill: 'ink', evenodd: true }] },
  /* Lucide arrow-up-wide-narrow (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuArrowUpWideNarrow. */
  'arrow-up-wide-narrow': { box: 24, layers: [{ d: 'M3 8l4-4 4 4M7 4v16M11 12h10M11 16h7M11 20h4', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI toolwindows/notifications.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuBell. */
  bell: { box: 16, layers: [{ d: 'M6.957 14.458H9.049C8.993 14.587 8.912 14.706 8.811 14.808C8.596 15.022 8.306 15.142 8.003 15.142C7.7 15.142 7.41 15.022 7.195 14.808C7.094 14.706 7.013 14.587 6.957 14.458Z', stroke: 'ink', width: 0.916 }, { d: 'M3.947 8.224C3.982 8.154 4 8.078 4 8V6C4 4.293 4.571 3.185 5.324 2.5C6.088 1.805 7.087 1.502 8.001 1.5H8.009C8.923 1.502 9.919 1.805 10.68 2.5C11.431 3.184 12 4.292 12 6V8C12 8.078 12.018 8.154 12.053 8.224L13.849 11.816C14.006 12.131 13.778 12.5 13.427 12.5H2.573C2.222 12.5 1.994 12.131 2.151 11.816L3.947 8.224Z', stroke: 'ink', join: 'round' }] },
  /* Lucide bell-off (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuBellOff. */
  'bell-off': { box: 24, layers: [{ d: 'M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide blocks (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuBlocks. */
  blocks: { box: 24, layers: [{ d: 'M15 3H20A1 1 0 0 1 21 4V9A1 1 0 0 1 20 10H15A1 1 0 0 1 14 9V4A1 1 0 0 1 15 3ZM10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide box (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuBox. */
  box: { box: 24, layers: [{ d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide brick-wall (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuBrickWall. */
  'brick-wall': { box: 24, layers: [{ d: 'M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3ZM12 9v6M16 15v6M16 3v6M3 15h18M3 9h18M8 15v6M8 3v6', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide calendar-clock (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCalendarClock. */
  'calendar-clock': { box: 24, layers: [{ d: 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.3V14M10 16A6 6 0 1 0 22 16A6 6 0 1 0 10 16Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide case-sensitive (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCaseSensitive. */
  'case-sensitive': { box: 24, layers: [{ d: 'M3 15l4-8 4 8M4 13h6M15 12A3 3 0 1 0 21 12A3 3 0 1 0 15 12ZM21 9v6', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI actions/checked_dark.svg. Copyright 2000-2024 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuCheck. */
  check: { box: 16, layers: [{ d: 'M2.5 8.25L6 11.75 13.5 4.25', stroke: 'ink', width: 1.5, cap: 'round', join: 'round' }] },
  /* Lucide check-check (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCheckCheck. */
  'check-check': { box: 24, layers: [{ d: 'M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/chevronDown_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuChevronDown. */
  'chevron-down': { box: 16, layers: [{ d: 'M11.5 6.25L8 9.75 4.5 6.25', stroke: 'chevron', cap: 'round' }] },
  /* Int UI general/chevronRight_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuChevronRight. */
  'chevron-right': { box: 16, layers: [{ d: 'M6 11.5L9.5 8 6 4.5', stroke: 'chevron', cap: 'round' }] },
  /* Int UI general/chevronUp_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuChevronUp. */
  'chevron-up': { box: 16, layers: [{ d: 'M4.5 9.75L8 6.25 11.5 9.75', stroke: 'chevron', cap: 'round' }] },
  /* Lucide circle (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCircle. */
  circle: { box: 24, layers: [{ d: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide circle-minus (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCircleMinus. */
  'circle-minus': { box: 24, layers: [{ d: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12ZM8 12h8', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide clipboard-check (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuClipboardCheck. */
  'clipboard-check': { box: 24, layers: [{ d: 'M9 2H15A1 1 0 0 1 16 3V5A1 1 0 0 1 15 6H9A1 1 0 0 1 8 5V3A1 1 0 0 1 9 2ZM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/history_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuClock, LuHistory. */
  clock: { box: 16, layers: [{ d: 'M1.5 8A6.5 6.5 0 1 0 14.5 8A6.5 6.5 0 1 0 1.5 8ZM8 5V8L10.5 9.5', stroke: 'ink', cap: 'round', join: 'round' }] },
  /* Int UI general/close_dark.svg. Copyright 2000-2025 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuX. */
  close: { box: 16, layers: [{ d: 'M3.5 12.5L12.5 3.5M12.5 12.5L3.5 3.5', stroke: 'ink', cap: 'round' }] },
  /* Lucide columns-3 (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuColumns3. */
  columns: { box: 24, layers: [{ d: 'M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3ZM9 3v18M15 3v18', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/copy_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuCopy. */
  copy: { box: 16, layers: [{ d: 'M4 3H10A2 2 0 0 1 12 5V12A2 2 0 0 1 10 14H4A2 2 0 0 1 2 12V5A2 2 0 0 1 4 3ZM4 4H10A1 1 0 0 1 11 5V12A1 1 0 0 1 10 13H4A1 1 0 0 1 3 12V5A1 1 0 0 1 4 4ZM5.5 6H8.5A.5 .5 0 0 1 9 6.5V6.5A.5 .5 0 0 1 8.5 7H5.5A.5 .5 0 0 1 5 6.5V6.5A.5 .5 0 0 1 5.5 6ZM5.5 8H8.5A.5 .5 0 0 1 9 8.5V8.5A.5 .5 0 0 1 8.5 9H5.5A.5 .5 0 0 1 5 8.5V8.5A.5 .5 0 0 1 5.5 8ZM5.5 10H8.5A.5 .5 0 0 1 9 10.5V10.5A.5 .5 0 0 1 8.5 11H5.5A.5 .5 0 0 1 5 10.5V10.5A.5 .5 0 0 1 5.5 10ZM11.002 2H11.6C12.373 2 13 2.627 13 3.4V3.911C13.001 3.94 13.002 3.97 13.002 4V11.548C13.606 11.112 14 10.402 14 9.6V3.4C14 2.075 12.925 1 11.6 1H6.4C5.597 1 4.886 1.394 4.45 2H6.4 11.002Z', fill: 'ink', evenodd: true }] },
  /* Lucide cpu (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCpu. */
  cpu: { box: 24, layers: [{ d: 'M6 4H18A2 2 0 0 1 20 6V18A2 2 0 0 1 18 20H6A2 2 0 0 1 4 18V6A2 2 0 0 1 6 4ZM10 9H14A1 1 0 0 1 15 10V14A1 1 0 0 1 14 15H10A1 1 0 0 1 9 14V10A1 1 0 0 1 10 9ZM15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide database (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuDatabase. */
  database: { box: 24, layers: [{ d: 'M3 5A9 3 0 1 0 21 5A9 3 0 1 0 3 5ZM3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/moreHorizontal_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuEllipsis. */
  ellipsis: { box: 16, layers: [{ d: 'M2 8A1 1 0 1 0 4 8A1 1 0 1 0 2 8ZM7 8A1 1 0 1 0 9 8A1 1 0 1 0 7 8ZM12 8A1 1 0 1 0 14 8A1 1 0 1 0 12 8Z', fill: 'ink' }] },
  /* Lucide eraser (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuEraser. */
  eraser: { box: 24, layers: [{ d: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/show_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuEye. */
  eye: { box: 16, layers: [{ d: 'M5.5 8A2.5 2.5 0 1 0 10.5 8A2.5 2.5 0 1 0 5.5 8ZM3.348 11.464C2.033 10.55 1.014 9.319 .53 8C1.014 6.681 2.033 5.45 3.348 4.535C4.714 3.585 6.366 3 8 3C9.634 3 11.286 3.585 12.652 4.535C13.967 5.45 14.986 6.681 15.47 8C14.986 9.319 13.967 10.55 12.652 11.464C11.286 12.415 9.634 13 8 13C6.366 13 4.714 12.415 3.348 11.464Z', stroke: 'ink' }] },
  /* Lucide eye-off (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuEyeOff (the Int UI set has no closed eye). */
  'eye-off': { box: 24, layers: [{ d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide file-cog (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuFileCog. */
  'file-cog': { box: 24, layers: [{ d: 'M14 2v4a2 2 0 0 0 2 2h4M3.2 12.9l-.9-.4M3.2 15.1l-.9.4M4.677 21.5a2 2 0 0 0 1.313.5H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v2.5M4.9 11.2l-.4-.9M4.9 16.8l-.4.9M7.5 10.3l-.4.9M7.5 17.7l-.4-.9M9.7 12.5l-.9.4M9.7 15.5l-.9-.4M3 14A3 3 0 1 0 9 14A3 3 0 1 0 3 14Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide folder-tree (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuFolderTree. */
  'folder-tree': { box: 24, layers: [{ d: 'M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide gauge (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuGauge. */
  gauge: { box: 24, layers: [{ d: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide globe (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuGlobe. */
  globe: { box: 24, layers: [{ d: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12ZM12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide hard-drive (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuHardDrive. */
  'hard-drive': { box: 24, layers: [{ d: 'M22 12L2 12M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16L6.01 16M10 16L10.01 16', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide hard-drive-download (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuHardDriveDownload. */
  'hard-drive-download': { box: 24, layers: [{ d: 'M12 2v8M16 6l-4 4-4-4M4 14H20A2 2 0 0 1 22 16V20A2 2 0 0 1 20 22H4A2 2 0 0 1 2 20V16A2 2 0 0 1 4 14ZM6 18h.01M10 18h.01', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide hourglass (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuHourglass. */
  hourglass: { box: 24, layers: [{ d: 'M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide key-round (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuKeyRound. */
  'key-round': { box: 24, layers: [{ d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }, { d: 'M16 7.5A.5 .5 0 1 0 17 7.5A.5 .5 0 1 0 16 7.5Z', fill: 'ink', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide layers (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLayers. */
  layers: { box: 24, layers: [{ d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83ZM22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide layout-template (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLayoutTemplate. */
  'layout-template': { box: 24, layers: [{ d: 'M4 3H20A1 1 0 0 1 21 4V9A1 1 0 0 1 20 10H4A1 1 0 0 1 3 9V4A1 1 0 0 1 4 3ZM4 14H11A1 1 0 0 1 12 15V20A1 1 0 0 1 11 21H4A1 1 0 0 1 3 20V15A1 1 0 0 1 4 14ZM17 14H20A1 1 0 0 1 21 15V20A1 1 0 0 1 20 21H17A1 1 0 0 1 16 20V15A1 1 0 0 1 17 14Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide list-filter (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuListFilter. */
  'list-filter': { box: 24, layers: [{ d: 'M3 6h18M7 12h10M10 18h4', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide list-ordered (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuListOrdered. */
  'list-ordered': { box: 24, layers: [{ d: 'M10 12h11M10 18h11M10 6h11M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide loader (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLoader. */
  loader: { box: 24, layers: [{ d: 'M12 2v4M16.2 7.8l2.9-2.9M18 12h4M16.2 16.2l2.9 2.9M12 18v4M4.9 19.1l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide loader-circle (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLoaderCircle. */
  'loader-circle': { box: 24, layers: [{ d: 'M21 12a9 9 0 1 1-6.219-8.56', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/remove_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuMinus. */
  minus: { box: 16, layers: [{ d: 'M1 7.5C1 7.776 1.224 8 1.5 8L13.5 8C13.776 8 14 7.776 14 7.5C14 7.224 13.776 7 13.5 7L1.5 7C1.224 7 1 7.224 1 7.5Z', fill: 'ink', evenodd: true }] },
  /* Lucide network (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuNetwork. */
  network: { box: 24, layers: [{ d: 'M17 16H21A1 1 0 0 1 22 17V21A1 1 0 0 1 21 22H17A1 1 0 0 1 16 21V17A1 1 0 0 1 17 16ZM3 16H7A1 1 0 0 1 8 17V21A1 1 0 0 1 7 22H3A1 1 0 0 1 2 21V17A1 1 0 0 1 3 16ZM10 2H14A1 1 0 0 1 15 3V7A1 1 0 0 1 14 8H10A1 1 0 0 1 9 7V3A1 1 0 0 1 10 2ZM5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide panel-bottom (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuPanelBottom. */
  'panel-bottom': { box: 24, layers: [{ d: 'M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3ZM3 15h18', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI run/pause_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuPause. */
  pause: { box: 16, layers: [{ d: 'M4 2.5H6A.5 .5 0 0 1 6.5 3V13A.5 .5 0 0 1 6 13.5H4A.5 .5 0 0 1 3.5 13V3A.5 .5 0 0 1 4 2.5ZM10 2.5H12A.5 .5 0 0 1 12.5 3V13A.5 .5 0 0 1 12 13.5H10A.5 .5 0 0 1 9.5 13V3A.5 .5 0 0 1 10 2.5Z', stroke: 'ink' }] },
  /* Int UI run/run_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuPlay. */
  play: { box: 16, layers: [{ d: 'M13.5 7.134C14.167 7.519 14.167 8.481 13.5 8.866L4.5 14.062C3.833 14.447 3 13.966 3 13.196L3 2.804C3 2.034 3.833 1.553 4.5 1.938L13.5 7.134Z', fill: '#253627', stroke: 'success' }] },
  /* Int UI general/add_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuPlus. */
  plus: { box: 16, layers: [{ d: 'M7.5 1C7.776 1 8 1.224 8 1.5V7H13.5C13.776 7 14 7.224 14 7.5C14 7.776 13.776 8 13.5 8H8V13.5C8 13.776 7.776 14 7.5 14C7.224 14 7 13.776 7 13.5V8H1.5C1.224 8 1 7.776 1 7.5C1 7.224 1.224 7 1.5 7H7V1.5C7 1.224 7.224 1 7.5 1Z', fill: 'ink', evenodd: true }] },
  /* Int UI general/refresh_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuRefreshCw, LuRefreshCcw. */
  refresh: { box: 16, layers: [{ d: 'M2.5 9V8C2.5 4.962 4.962 2.5 8 2.5 9.107 2.5 10.137 2.827 11 3.389M5 12.611C5.863 13.173 6.893 13.5 8 13.5 11.038 13.5 13.5 11.038 13.5 8V7M.5 7.5L2.5 9.5 4.5 7.5M11.5 8.5L13.5 6.5 15.5 8.5', stroke: 'ink', cap: 'round' }] },
  /* Lucide regex (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuRegex. */
  regex: { box: 24, layers: [{ d: 'M17 3v10M12.67 5.5l8.66 5M12.67 10.5l8.66-5M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide repeat (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuRepeat. */
  repeat: { box: 24, layers: [{ d: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide rocket (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuRocket. */
  rocket: { box: 24, layers: [{ d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide ruler (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuRuler. */
  ruler: { box: 24, layers: [{ d: 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0ZM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide scaling (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuScaling. */
  scaling: { box: 24, layers: [{ d: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M14 15H9v-5M16 3h5v5M21 3 9 15', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide scroll-text (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuScrollText. */
  'scroll-text': { box: 24, layers: [{ d: 'M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/search_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuSearch. */
  search: { box: 16, layers: [{ d: 'M2.5 7A4.5 4.5 0 1 0 11.5 7A4.5 4.5 0 1 0 2.5 7ZM10.199 10.2L13.499 13.496', stroke: 'ink', cap: 'round' }] },
  /* Lucide search-x (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuSearchX. */
  'search-x': { box: 24, layers: [{ d: 'M13.5 8.5l-5 5M8.5 8.5l5 5M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11ZM21 21l-4.3-4.3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide server (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuServer. */
  server: { box: 24, layers: [{ d: 'M4 2H20A2 2 0 0 1 22 4V8A2 2 0 0 1 20 10H4A2 2 0 0 1 2 8V4A2 2 0 0 1 4 2ZM4 14H20A2 2 0 0 1 22 16V20A2 2 0 0 1 20 22H4A2 2 0 0 1 2 20V16A2 2 0 0 1 4 14ZM6 6L6.01 6M6 18L6.01 18', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide server-cog (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuServerCog. */
  'server-cog': { box: 24, layers: [{ d: 'M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12ZM4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5M4.5 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5M6 6h.01M6 18h.01M15.7 13.4l-.9-.3M9.2 10.9l-.9-.3M10.6 15.7l.3-.9M13.6 15.7l-.4-1M10.8 9.3l-.4-1M8.3 13.6l1-.4M14.7 10.8l1-.4M13.4 8.3l-.3.9', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide settings-2 (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuSettings2. */
  'settings-2': { box: 24, layers: [{ d: 'M20 7h-9M14 17H5M14 17A3 3 0 1 0 20 17A3 3 0 1 0 14 17ZM4 7A3 3 0 1 0 10 7A3 3 0 1 0 4 7Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide shield (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuShield. */
  shield: { box: 24, layers: [{ d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide shield-check (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuShieldCheck. */
  'shield-check': { box: 24, layers: [{ d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide split (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuSplit. */
  split: { box: 24, layers: [{ d: 'M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3M15 9l6-6', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI status/error_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: IntUiError. */
  'status-error': {
    box: 16,
    layers: [
      { d: 'M1 8A7 7 0 1 0 15 8A7 7 0 1 0 1 8Z', fill: 'error' },
      { d: 'M9 5C9 4.448 8.552 4 8 4 7.448 4 7 4.448 7 5V7.5C7 8.052 7.448 8.5 8 8.5 8.552 8.5 9 8.052 9 7.5L9 5ZM8 12C8.552 12 9 11.552 9 11 9 10.448 8.552 10 8 10 7.448 10 7 10.448 7 11 7 11.552 7.448 12 8 12Z', fill: '#FFFFFF' },
    ],
  },
  /* Int UI status/info_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: IntUiInfo. */
  'status-info': {
    box: 16,
    layers: [
      { d: 'M1 8A7 7 0 1 0 15 8A7 7 0 1 0 1 8Z', fill: 'info' },
      { d: 'M7 11C7 11.552 7.448 12 8 12 8.552 12 9 11.552 9 11L9 8.5C9 7.948 8.552 7.5 8 7.5 7.448 7.5 7 7.948 7 8.5L7 11ZM8 4C7.448 4 7 4.448 7 5 7 5.552 7.448 6 8 6 8.552 6 9 5.552 9 5 9 4.448 8.552 4 8 4Z', fill: '#FFFFFF' },
    ],
  },
  /* Int UI status/success_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: IntUiSuccess. */
  'status-success': {
    box: 16,
    layers: [
      { d: 'M1 8A7 7 0 1 0 15 8A7 7 0 1 0 1 8Z', fill: 'success' },
      { d: 'M4.5 8L7 10.5 11.5 6', stroke: '#FFFFFF', width: 2, cap: 'round', join: 'round' },
    ],
  },
  /* Int UI status/warning_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: IntUiWarning. */
  'status-warning': {
    box: 16,
    layers: [
      { d: 'M1.276 10.863L6.303 1.989C7.05 .67 8.949 .67 9.696 1.989L14.723 10.863C15.516 12.264 14.505 14 12.896 14H3.103C1.494 14 .483 12.264 1.276 10.863Z', fill: 'warning', evenodd: true },
      { d: 'M9 5C9 4.448 8.552 4 8 4 7.448 4 7 4.448 7 5V7.5C7 8.052 7.448 8.5 8 8.5 8.552 8.5 9 8.052 9 7.5L9 5ZM8 12C8.552 12 9 11.552 9 11 9 10.448 8.552 10 8 10 7.448 10 7 10.448 7 11 7 11.552 7.448 12 8 12Z', fill: 'warning-mark' },
    ],
  },
  /* Lucide target (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuTarget. */
  target: { box: 24, layers: [{ d: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12ZM6 12A6 6 0 1 0 18 12A6 6 0 1 0 6 12ZM10 12A2 2 0 1 0 14 12A2 2 0 1 0 10 12Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/delete_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuTrash2. */
  trash: { box: 16, layers: [{ d: 'M7 2H9C9.552 2 10 2.448 10 3H6C6 2.448 6.448 2 7 2ZM5 3C5 1.895 5.895 1 7 1H9C10.105 1 11 1.895 11 3H13C13.552 3 14 3.448 14 4V5V6H13V13C13 14.105 12.105 15 11 15H5C3.895 15 3 14.105 3 13V6H2V5V4C2 3.448 2.448 3 3 3H5ZM11 4H10H6H5H3V5H4H12H13V4H11ZM4 6H12V13C12 13.552 11.552 14 11 14H5C4.448 14 4 13.552 4 13V6ZM6.5 7C6.224 7 6 7.224 6 7.5V11.5C6 11.776 6.224 12 6.5 12C6.776 12 7 11.776 7 11.5V7.5C7 7.224 6.776 7 6.5 7ZM9 7.5C9 7.224 9.224 7 9.5 7C9.776 7 10 7.224 10 7.5V11.5C10 11.776 9.776 12 9.5 12C9.224 12 9 11.776 9 11.5V7.5Z', fill: 'ink', evenodd: true }] },
  /* Lucide umbrella (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuUmbrella. */
  umbrella: { box: 24, layers: [{ d: 'M22 12a10.06 10.06 1 0 0-20 0ZM12 12v8a2 2 0 0 0 4 0M12 2v1', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/undo_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuUndo2. */
  undo: { box: 16, layers: [{ d: 'M1.5 7.5V10.5H4.5M1.963 10.004C3.433 8.483 6.62 5.488 9.519 5.497C12.452 5.457 14.415 7.529 14.486 10.502', stroke: 'ink', cap: 'round' }] },
  /* Lucide waypoints (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuWaypoints. */
  waypoints: { box: 24, layers: [{ d: 'M9.5 4.5A2.5 2.5 0 1 0 14.5 4.5A2.5 2.5 0 1 0 9.5 4.5ZM10.2 6.3l-3.9 3.9M2 12A2.5 2.5 0 1 0 7 12A2.5 2.5 0 1 0 2 12ZM7 12h10M17 12A2.5 2.5 0 1 0 22 12A2.5 2.5 0 1 0 17 12ZM13.8 17.7l3.9-3.9M9.5 19.5A2.5 2.5 0 1 0 14.5 19.5A2.5 2.5 0 1 0 9.5 19.5Z', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
};

/** Whether a string is a glyph of the registry: a name that came from outside (a plugin's contribution) is checked with it before it is drawn. */
export const isIconName = (name: string): name is IconName => Object.hasOwn(GLYPHS, name);
