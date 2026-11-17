/*
 * The glyph registry: every icon the kit can draw, as data. There is no icon library, no namespace import and no lookup by an
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
 * its outline. Each glyph was rasterized beside its original in WebKit and Chromium and matched pixel for pixel.
 */

/** The name of a glyph in the registry: the only icons the kit draws. A new glyph is a new line here and in `GLYPHS`. */
export type IconName =
  | 'arrow-down'
  | 'arrow-up'
  | 'box'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'circle-minus'
  | 'clock'
  | 'close'
  | 'columns'
  | 'copy'
  | 'folder-tree'
  | 'layers'
  | 'loader'
  | 'loader-circle'
  | 'play'
  | 'refresh'
  | 'search'
  | 'search-x'
  | 'server'
  | 'status-error'
  | 'status-info'
  | 'status-success'
  | 'status-warning';

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
  /* Int UI general/down_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowDown. */
  'arrow-down': { box: 16, layers: [{ d: 'M12.354 9.654C12.549 9.458 12.549 9.142 12.354 8.946 12.158 8.751 11.842 8.751 11.646 8.946L8.5 12.093 8.5 2.5C8.5 2.224 8.276 2 8 2 7.724 2 7.5 2.224 7.5 2.5L7.5 12.093 4.354 8.946C4.158 8.751 3.842 8.751 3.646 8.946 3.451 9.142 3.451 9.458 3.646 9.654L7.646 13.654 8 14.007 8.354 13.654 12.354 9.654Z', fill: 'ink', evenodd: true }] },
  /* Int UI general/up_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuArrowUp. */
  'arrow-up': { box: 16, layers: [{ d: 'M12.354 6.346C12.549 6.542 12.549 6.858 12.354 7.054 12.158 7.249 11.842 7.249 11.646 7.054L8.5 3.907 8.5 13.507C8.5 13.783 8.276 14.007 8 14.007 7.724 14.007 7.5 13.783 7.5 13.507L7.5 3.907 4.354 7.054C4.158 7.249 3.842 7.249 3.646 7.054 3.451 6.858 3.451 6.542 3.646 6.346L7.646 2.346 8 1.993 8.354 2.346 12.354 6.346Z', fill: 'ink', evenodd: true }] },
  /* Lucide box (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuBox. */
  box: { box: 24, layers: [{ d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI actions/checked_dark.svg. Copyright 2000-2024 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuCheck. */
  check: { box: 16, layers: [{ d: 'M2.5 8.25L6 11.75 13.5 4.25', stroke: 'ink', width: 1.5, cap: 'round', join: 'round' }] },
  /* Int UI general/chevronDown_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuChevronDown. */
  'chevron-down': { box: 16, layers: [{ d: 'M11.5 6.25L8 9.75 4.5 6.25', stroke: 'chevron', cap: 'round' }] },
  /* Int UI general/chevronRight_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuChevronRight. */
  'chevron-right': { box: 16, layers: [{ d: 'M6 11.5L9.5 8 6 4.5', stroke: 'chevron', cap: 'round' }] },
  /* Lucide circle-minus (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuCircleMinus. */
  'circle-minus': { box: 24, layers: [{ d: 'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12ZM8 12h8', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/history_dark.svg. Copyright 2000-2022 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuClock, LuHistory. */
  clock: { box: 16, layers: [{ d: 'M1.5 8A6.5 6.5 0 1 0 14.5 8A6.5 6.5 0 1 0 1.5 8ZM8 5V8L10.5 9.5', stroke: 'ink', cap: 'round', join: 'round' }] },
  /* Int UI general/close_dark.svg. Copyright 2000-2025 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuX. */
  close: { box: 16, layers: [{ d: 'M3.5 12.5L12.5 3.5M12.5 12.5L3.5 3.5', stroke: 'ink', cap: 'round' }] },
  /* Lucide columns-3 (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuColumns3. */
  columns: { box: 24, layers: [{ d: 'M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3ZM9 3v18M15 3v18', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI general/copy_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuCopy. */
  copy: { box: 16, layers: [{ d: 'M4 3H10A2 2 0 0 1 12 5V12A2 2 0 0 1 10 14H4A2 2 0 0 1 2 12V5A2 2 0 0 1 4 3ZM4 4H10A1 1 0 0 1 11 5V12A1 1 0 0 1 10 13H4A1 1 0 0 1 3 12V5A1 1 0 0 1 4 4ZM5.5 6H8.5A.5 .5 0 0 1 9 6.5V6.5A.5 .5 0 0 1 8.5 7H5.5A.5 .5 0 0 1 5 6.5V6.5A.5 .5 0 0 1 5.5 6ZM5.5 8H8.5A.5 .5 0 0 1 9 8.5V8.5A.5 .5 0 0 1 8.5 9H5.5A.5 .5 0 0 1 5 8.5V8.5A.5 .5 0 0 1 5.5 8ZM5.5 10H8.5A.5 .5 0 0 1 9 10.5V10.5A.5 .5 0 0 1 8.5 11H5.5A.5 .5 0 0 1 5 10.5V10.5A.5 .5 0 0 1 5.5 10ZM11.002 2H11.6C12.373 2 13 2.627 13 3.4V3.911C13.001 3.94 13.002 3.97 13.002 4V11.548C13.606 11.112 14 10.402 14 9.6V3.4C14 2.075 12.925 1 11.6 1H6.4C5.597 1 4.886 1.394 4.45 2H6.4 11.002Z', fill: 'ink', evenodd: true }] },
  /* Lucide folder-tree (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuFolderTree. */
  'folder-tree': { box: 24, layers: [{ d: 'M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide layers (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLayers. */
  layers: { box: 24, layers: [{ d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83ZM22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide loader (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLoader. */
  loader: { box: 24, layers: [{ d: 'M12 2v4M16.2 7.8l2.9-2.9M18 12h4M16.2 16.2l2.9 2.9M12 18v4M4.9 19.1l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide loader-circle (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuLoaderCircle. */
  'loader-circle': { box: 24, layers: [{ d: 'M21 12a9 9 0 1 1-6.219-8.56', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Int UI run/run_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuPlay. */
  play: { box: 16, layers: [{ d: 'M13.5 7.134C14.167 7.519 14.167 8.481 13.5 8.866L4.5 14.062C3.833 14.447 3 13.966 3 13.196L3 2.804C3 2.034 3.833 1.553 4.5 1.938L13.5 7.134Z', fill: '#253627', stroke: 'success' }] },
  /* Int UI general/refresh_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuRefreshCw, LuRefreshCcw. */
  refresh: { box: 16, layers: [{ d: 'M2.5 9V8C2.5 4.962 4.962 2.5 8 2.5 9.107 2.5 10.137 2.827 11 3.389M5 12.611C5.863 13.173 6.893 13.5 8 13.5 11.038 13.5 13.5 11.038 13.5 8V7M.5 7.5L2.5 9.5 4.5 7.5M11.5 8.5L13.5 6.5 15.5 8.5', stroke: 'ink', cap: 'round' }] },
  /* Int UI general/search_dark.svg. Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. Mock keys: LuSearch. */
  search: { box: 16, layers: [{ d: 'M2.5 7A4.5 4.5 0 1 0 11.5 7A4.5 4.5 0 1 0 2.5 7ZM10.199 10.2L13.499 13.496', stroke: 'ink', cap: 'round' }] },
  /* Lucide search-x (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuSearchX. */
  'search-x': { box: 24, layers: [{ d: 'M13.5 8.5l-5 5M8.5 8.5l5 5M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11ZM21 21l-4.3-4.3', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
  /* Lucide server (ISC; the glyphs Lucide derives from Feather carry Feather's MIT notice, see NOTICE). Mock key: LuServer. */
  server: { box: 24, layers: [{ d: 'M4 2H20A2 2 0 0 1 22 4V8A2 2 0 0 1 20 10H4A2 2 0 0 1 2 8V4A2 2 0 0 1 4 2ZM4 14H20A2 2 0 0 1 22 16V20A2 2 0 0 1 20 22H4A2 2 0 0 1 2 20V16A2 2 0 0 1 4 14ZM6 6L6.01 6M6 18L6.01 18', stroke: 'ink', width: 2, cap: 'round', join: 'round' }] },
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
};
