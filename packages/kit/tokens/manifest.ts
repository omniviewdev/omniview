/**
 * The token vocabulary: the one source every token artefact is generated from (`scripts/generate.ts` writes
 * `src/generated/tokens.css` and `src/generated/tokenNames.ts` from this file and `themes.ts`).
 *
 * The names are the design lab's roles (mock `frontend/mock/base.css`, research chapters 01, 02, 04 section 9, 13 section 7,
 * 14 section 1). A colour role keeps the mock's name with its `--int-` prefix swapped for `--ov-`: `--int-bg-island` is
 * `--ov-bg-island`. The one group the mock does not name is `tint` (below): values the mock computes in CSS, written out here.
 * There is ONE scale per kind of value and no alias for any of them; a role that changes meaning is renamed
 * and the old name is deleted in the same commit (strategy R6).
 *
 * Scale steps are named by their pixel value and the roles the mock gives them stay documentation: `spacing` 4 is the
 * icon/text gap, 6 the label/control gap, 8 the related gap, 12 the pane inset and row gap, 16 the gap between independent
 * controls, 20 the gap between unrelated groups; 2 is a hairline adjustment inside a component, 24 the largest step.
 *
 * Not carried yet, because no part reads them: motion, z-index, icon sizes, the control insets and the shell geometry, and the shadows
 * other than the tooltip's and the popup's. Each arrives with the first screen that needs it.
 */

/** The CSS custom property prefix. Every generated token starts with it. */
export const TOKEN_PREFIX = '--ov-';

/**
 * Colour roles by group, in the order the generated CSS declares them. A theme defines every role of every group.
 * Roles are text/glyph/fill/edge colours for chrome; hex literals in a view are for data and brand identity only.
 */
export const COLOR_ROLE_GROUPS = {
  /** Planes. The window plane around the work is lighter than the island that holds it. */
  surface: ['bg-window', 'bg-island', 'bg-editor', 'bg-dialog', 'bg-inline', 'bg-popup', 'bg-feedback'],
  /** Text. `fg-secondary` is for nonessential text only; `fg-on-data` is the text on a solid data fill. */
  text: ['fg', 'fg-muted', 'fg-secondary', 'fg-disabled', 'fg-editor', 'fg-over-accent', 'fg-on-data'],
  icon: ['icon', 'icon-disabled', 'icon-active'],
  border: ['border-subtle', 'border-popup', 'border-control', 'border-disabled', 'border-raised'],
  /** Focus, primary action and link. */
  accent: ['accent', 'link'],
  selection: ['selection-active', 'selection-inactive'],
  tab: ['tab-bg', 'tab-border', 'tab-inactive-bg', 'tab-inactive-border'],
  segment: ['segment-bg', 'segment-border', 'segment-focused-bg'],
  /** Overlays (8-digit hex): row hover, toolbar hover, pressed. */
  state: ['hover-row', 'hover-toolbar', 'pressed'],
  /** Severity text and opaque feedback fills, borders and solid control fills, plus the progress track. */
  severity: [
    'success-fg',
    'warning-fg',
    'error-fg',
    'info-bg',
    'info-border',
    'warning-bg',
    'warning-border',
    'error-bg',
    'error-border',
    'success-bg',
    'success-border',
    'error-control',
    'error-control-inactive',
    'warning-control',
    'warning-control-inactive',
    'progress-track',
  ],
  chart: ['chart-purple', 'chart-teal'],
  syntax: [
    'syntax-keyword',
    'syntax-string',
    'syntax-number',
    'syntax-comment',
    'syntax-function',
    'syntax-key',
    'syntax-type',
    'syntax-variable',
    'syntax-annotation',
    'syntax-operator',
  ],
  /** The paint the shipped glyph artwork carries. */
  glyph: [
    'icon-info',
    'icon-success',
    'icon-warning',
    'icon-warning-mark',
    'icon-error',
    'icon-chevron',
    'icon-help',
  ],
  /** Brand identity hues, for provider tiles. */
  brand: [
    'brand-orange',
    'brand-green',
    'brand-blue',
    'brand-purple',
    'brand-pink',
    'brand-red',
    'brand-teal',
  ],
  /**
   * The tints of the data palette, one per hue: the hue mixed 24% over `bg-island`, the fill under a tinted avatar and under an
   * unavailable swatch. The mock mixes in CSS with `color-mix` (the avatar `base.css` 1576, the unavailable swatch 2058, at 30%); the kit
   * writes no colour function, so a theme carries each mix as a literal, and `tint.test.ts` holds every literal to the mix of its own
   * theme. The hues are `link` (blue), `success-fg` (green), `warning-fg` (amber), `error-fg` (red), `chart-purple` (purple),
   * `chart-teal` (cyan) and `fg-muted` (gray).
   */
  tint: ['tint-blue', 'tint-green', 'tint-amber', 'tint-red', 'tint-purple', 'tint-cyan', 'tint-gray'],
} as const;

export type ColorRoleGroup = keyof typeof COLOR_ROLE_GROUPS;
export type ColorRole = (typeof COLOR_ROLE_GROUPS)[ColorRoleGroup][number];

export const COLOR_ROLES: readonly ColorRole[] = Object.values(COLOR_ROLE_GROUPS).flat();

/**
 * Font families. The faces register under these aliases (`Int UI Inter` 400 and 600, `Int UI Mono` 400). Delivering the font
 * files is the host's job (design D4.7) and has not landed: until it does, a stack falls through to the system font.
 * `calt` stays off for every text: Inter's contextual alternates draw the `x` of `7x5nx` as a
 * multiplication sign and turn `->` into an arrow, and a name must read as it is stored.
 */
export const FONTS = {
  ui: '\'Int UI Inter\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif',
  code: '\'Int UI Mono\', monospace',
  features: '\'calt\' 0',
} as const;

/**
 * The closed type scale, in pixels at text size 100. Weights are 400 and 600 and are literals in CSS, not tokens.
 * `fs-N` is N px times the text scale; `lh-N` is the same rounded to whole pixels.
 */
export const FONT_SIZES = [12, 13, 16, 18] as const;
export const LINE_HEIGHTS = [16, 18, 20, 24] as const;

/** The text-size axis (`data-ov-text-size`): one number scales the whole closed type scale. Absent means 100. */
export const TEXT_SIZES = { '80': 0.8, '90': 0.9, '100': 1, '110': 1.1, '125': 1.25 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = '100';

/** The closed spacing scale in pixels (`--ov-spacing-N`). `10` exists only as a table cell's interior inset and is not a step. */
export const SPACING = [2, 4, 6, 8, 12, 16, 20, 24] as const;

/** Radii by owner, in pixels (`--ov-radius-<role>`); `50%` (dots, avatars, rings) is a keyword, not a token. */
export const RADII = { mark: 2, control: 4, tab: 6, popup: 8, island: 10 } as const;

/** The height of a standard control, in pixels (`--ov-control-height`). */
export const CONTROL_HEIGHT = 28;

/**
 * Elevation by owner (`--ov-shadow-<role>`), the same in every theme (research chapter 15, section 3.5). Two are drawn so far: the mock's
 * `.tooltip` shadow, and the restrained popup shadow its hover card shares with dialogs and the palette (`0 8px 24px #00000040`, the mock's
 * `.detail__card`), first read by the `HoverCardHost`.
 */
export const SHADOWS = { tooltip: '0 2px 8px #0006', popup: '0 8px 24px #00000040' } as const;

/**
 * The density axis (`data-ov-density`) changes the rows of lists and tables only; controls, icons, chrome and type keep
 * their sizes. `comfortable` is the design and the default.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
export const DEFAULT_DENSITY: Density = 'comfortable';

/** Row tokens in pixels per density (`--ov-<name>`). */
export const DENSITY_TOKENS = {
  'row-height': { comfortable: 24, compact: 22 },
  'row-pad': { comfortable: 4, compact: 3 },
  'row-target': { comfortable: 24, compact: 22 },
  'table-metadata-height': { comfortable: 40, compact: 38 },
  'table-header-height': { comfortable: 25, compact: 23 },
} as const satisfies Record<string, Record<Density, number>>;
