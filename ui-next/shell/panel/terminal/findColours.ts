import type { EngineTheme } from './engine';

// The colours of a find in the terminal (T3a). The search addon draws the matches as decorations of the emulator, and takes their backgrounds as `#RRGGBB` and no other form, while the colours the host resolved from its
// theme arrive as `rgb()`, `rgba()` or a hex (`appearance.ts`). The highlights are derived from the theme, as the rest of the screen is, and drawn as the design mock draws a find: a dim amber for every match, and the colour
// of the selection for the current one (it is selected: the emulator paints a selection over a decoration, so its own colour is what is seen), each only as far as the screen's text can still be read over it (WCAG's 4.5 to 1,
// measured on the colour the addon is given). Pure, and nothing here knows the emulator.

/** A colour as its three channels, each 0 to 255. */
export type Rgb = readonly [number, number, number];

/**
 * What the search addon draws a find with: every colour is `#RRGGBB`. A match has a border only when its fill cannot mark it (no mix of the yellow keeps the text readable, so its fill is the screen's own background): the
 * border then tells it from the screen.
 */
export type FindDecorations = {
  readonly matchBackground: string;
  readonly matchBorder?: string;
  readonly matchOverviewRuler: string;
  readonly activeMatchBackground: string;
  readonly activeMatchBorder: string;
  readonly activeMatchColorOverviewRuler: string;
};

/** The least contrast the text of the screen may have over a highlight: WCAG's 4.5 to 1 for text. */
const READABLE = 4.5;

/** How much of the accent is mixed into the background, strongest first: the most that keeps the text readable is the one used. The mock's amber is dim, a fifth of the way to the yellow at most (its warning background). */
const MATCH_AMOUNTS = [0.2, 0.15, 0.1] as const;
/** The same for the blue of the current match, which is used only when the selection's own colour cannot be. */
const ACTIVE_AMOUNTS = [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15] as const;

/** What a theme that gave no colour a find can read is drawn with: a yellow over the dark background of an editor. */
const FALLBACK = { background: [30, 30, 30], foreground: [212, 212, 212], yellow: [229, 192, 123], blue: [97, 175, 239] } as const satisfies Record<string, Rgb>;

const HEX_COLOUR = /^#(?:([0-9a-f]{3})|([0-9a-f]{6})(?:[0-9a-f]{2})?)$/i;
const FUNCTION_COLOUR = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[\s,/]\s*[\d.]+%?)?\s*\)$/i;

/** The channels of a colour the host resolved (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`), or nothing for any other form: its alpha is not read, the background it lies on is opaque. */
export function parseColour(value: string): Rgb | undefined {
  const hex = HEX_COLOUR.exec(value);
  if (hex !== null) {
    const digits = hex[1] === undefined ? hex[2] : [...hex[1]].map((digit) => digit + digit).join('');
    if (digits === undefined) {
      return undefined;
    }

    return [Number.parseInt(digits.slice(0, 2), 16), Number.parseInt(digits.slice(2, 4), 16), Number.parseInt(digits.slice(4, 6), 16)];
  }

  const functional = FUNCTION_COLOUR.exec(value);
  if (functional === null) {
    return undefined;
  }

  const channels = [functional[1], functional[2], functional[3]].map((channel) => Number.parseFloat(channel ?? ''));
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined || channels.some((channel) => !Number.isFinite(channel) || channel > 255)) {
    return undefined;
  }

  return [red, green, blue];
}

/** A colour with each channel rounded to a whole number from 0 to 255: the colour `hexOf` writes, and so the one the addon draws. */
function rounded(colour: Rgb): Rgb {
  const channel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
  return [channel(colour[0]), channel(colour[1]), channel(colour[2])];
}

/** A colour as `#rrggbb`, each channel rounded to a whole number. */
export function hexOf(colour: Rgb): string {
  return `#${rounded(colour).map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** `base` with `amount` (0 to 1) of `accent` mixed into it, channel by channel. */
export function mix(base: Rgb, accent: Rgb, amount: number): Rgb {
  return [base[0] + (accent[0] - base[0]) * amount, base[1] + (accent[1] - base[1]) * amount, base[2] + (accent[2] - base[2]) * amount];
}

const luminance = (colour: Rgb): number => {
  const [red, green, blue] = colour.map((channel) => {
    const level = channel / 255;
    return level <= 0.039_28 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

/** The contrast of two colours as WCAG measures it: 1 for a colour on itself, up to 21 for black on white. */
export function contrast(first: Rgb, second: Rgb): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The colour of a theme, or what a find falls back to when it is not one the host can read. */
const channelsOf = (value: string | undefined, fallback: Rgb): Rgb => (value === undefined ? undefined : parseColour(value)) ?? fallback;

/**
 * `base` with the most of `accent` mixed into it, out of `amounts` (the most first), that the text can still be read over, or nothing when no amount keeps it readable. The contrast is that of the colour the addon is
 * given, which is rounded to whole channels: a mix of 118.5 in every channel is 4.51 to 1 against white, and the `#777777` it is drawn as is 4.478.
 */
function readableMix(base: Rgb, text: Rgb, accent: Rgb, amounts: readonly number[]): Rgb | undefined {
  for (const amount of amounts) {
    const candidate = rounded(mix(base, accent, amount));
    if (contrast(text, candidate) >= READABLE) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * The decorations of a find in this theme. A match is the background with the palette's yellow (the fourth colour) mixed into it, dim, with the most of the yellow that keeps the text of the screen readable over it; when no
 * mix does, it keeps the background (the text is as readable over it as anywhere on the screen) and has a border, so that it is still told from the screen. The current match is the colour of the selection when the text can be
 * read over it: the emulator selects the current match, and paints a selection over a decoration, so that is the colour it shows. When it cannot, it is the palette's blue (the fifth) mixed in the same way, and then the
 * background; its border is the text's colour, so that the two kinds of match are told apart whatever the theme. The overview ruler has the two accents.
 */
export function findDecorations(theme: EngineTheme): FindDecorations {
  const background = channelsOf(theme.background, FALLBACK.background);
  const foreground = channelsOf(theme.foreground, FALLBACK.foreground);
  const yellow = channelsOf(theme.palette[3], FALLBACK.yellow);
  const blue = channelsOf(theme.palette[4], FALLBACK.blue);
  const selected = parseColour(theme.selectionBackground);
  const selection = selected === undefined ? undefined : rounded(selected);
  const match = readableMix(background, foreground, yellow, MATCH_AMOUNTS);
  const active = (selection !== undefined && contrast(foreground, selection) >= READABLE ? selection : undefined) ?? readableMix(background, foreground, blue, ACTIVE_AMOUNTS) ?? background;

  return {
    matchBackground: hexOf(match ?? background),
    ...(match === undefined ? { matchBorder: hexOf(mix(background, yellow, 0.6)) } : {}),
    matchOverviewRuler: hexOf(yellow),
    activeMatchBackground: hexOf(active),
    activeMatchBorder: hexOf(foreground),
    activeMatchColorOverviewRuler: hexOf(blue),
  };
}
