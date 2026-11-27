import type { EngineAppearance } from './engine';
import { sanitiseFontFamily, type TerminalPreferences } from './preferences';

// The look of the screen, from the theme (docs/ui-next/status/T1.md, "The look"). An emulator that draws on a canvas cannot read a stylesheet, and the host writes no colour in code: the body renders a hidden
// swatch for each colour the screen needs (`TerminalBody.tsx`), the stylesheet paints each with the theme's own token, and this reads what the engine resolved for it. A theme change, or a change of
// the text size, is one read of about two dozen computed styles, applied to the emulator that is there.

/** The colours of the 16 of the palette, in the order an emulator numbers them. */
export const PALETTE_ROLES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;

/** Every swatch the body renders: the screen's own colours, then the palette. */
export const SWATCH_ROLES = ['background', 'foreground', 'cursor', 'cursorAccent', 'selection', 'selectionInactive', ...PALETTE_ROLES] as const;

/** What a font gets when the engine could not say: the mock's 12 px on an 18 px row. */
const FALLBACK = Object.freeze({ fontSize: 12, lineHeight: 18 / 12 });

const swatch = (root: ParentNode, role: string): Element | null => root.querySelector(`[data-swatch="${role}"]`);

/** What a canvas context offers of its pixel: all that `normaliseColour` needs, so a test can give its own. */
export type PixelContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  readonly clearRect: (x: number, y: number, width: number, height: number) => void;
  readonly fillRect: (x: number, y: number, width: number, height: number) => void;
  readonly getImageData: (x: number, y: number, width: number, height: number) => { readonly data: ArrayLike<number> };
};

/** The one pixel the colours that are not `rgb()` are drawn on: made when the first of them is read. */
let pixel: PixelContext | null | undefined;

function pixelContext(): PixelContext | null {
  if (pixel === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    pixel = canvas.getContext('2d', { willReadFrequently: true });
  }

  return pixel;
}

/** The colour functions `getComputedStyle` returns as they were written (measured in WebKit and Chromium). */
const MODERN = /^(?:oklch|oklab|lab|lch|color|color-mix)\(/;

/**
 * A colour as `rgb()`, the one form the emulator reads in both its renderers. `getComputedStyle` gives `rgb()` and `rgba()` for hex, rgb, hsl and names, but `oklch()`, `color()` and `color-mix()` come back in
 * their own syntax (measured in both engines): those are drawn on a pixel and read back, which is sRGB whatever the colour's space. A colour the context refuses, or no context, is left as it was.
 */
export function normaliseColour(value: string, given?: PixelContext | null): string {
  // Only the spaces the engine hands back in their own syntax are drawn: everything else (hex, rgb, hsl, hwb, names, currentcolor) it has already resolved to `rgb()`.
  if (!MODERN.test(value)) {
    return value;
  }

  const context = given === undefined ? pixelContext() : given;
  if (context === null) {
    return value;
  }

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = '#000000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const { data } = context.getImageData(0, 0, 1, 1);
  const [red, green, blue, alpha] = [data[0], data[1], data[2], data[3]];
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    return value;
  }

  return alpha === 255 ? `rgb(${String(red)}, ${String(green)}, ${String(blue)})` : `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(Math.round((alpha / 255) * 1000) / 1000)})`;
}

/** The colour a swatch resolved to, as the emulator reads it (`rgb(…)`). */
function colourOf(root: ParentNode, role: string): string {
  const element = swatch(root, role);
  return element === null ? '' : normaliseColour(getComputedStyle(element).color);
}

/** A length in pixels, or nothing for a word (`normal`, `auto`) and for what is not a length. */
function pixelsOf(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return value.endsWith('px') && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** The size the theme draws its code at 100 percent of the text scale: the person's size is multiplied by the swatch's size over it, so the text scale still reaches the terminal. */
const SCALE_BASE = 12;

/**
 * Reads the look of the screen from the swatches under `root`, and from the person's settings when there are some (`preferences.ts`): the colours are always the theme's. A person's font names come before the theme's face (a name
 * that is not installed falls through to it), their size is scaled by the theme's text scale, their line height is a multiple of that size, and their cursor is the cursor.
 */
export function readAppearance(root: ParentNode, preferences?: TerminalPreferences): EngineAppearance {
  const face = swatch(root, 'font');
  const style = face === null ? undefined : getComputedStyle(face);
  const themeSize = pixelsOf(style?.fontSize ?? '') ?? FALLBACK.fontSize;
  const line = pixelsOf(style?.lineHeight ?? '');
  const themeFace = style?.fontFamily ?? 'monospace';
  const names = sanitiseFontFamily(preferences?.fontFamily);
  const fontSize = preferences === undefined ? themeSize : Math.round(((preferences.fontSize * themeSize) / SCALE_BASE) * 100) / 100;
  return {
    theme: {
      background: colourOf(root, 'background'),
      foreground: colourOf(root, 'foreground'),
      cursor: colourOf(root, 'cursor'),
      cursorAccent: colourOf(root, 'cursorAccent'),
      selectionBackground: colourOf(root, 'selection'),
      selectionInactiveBackground: colourOf(root, 'selectionInactive'),
      palette: PALETTE_ROLES.map((role) => colourOf(root, role)),
    },
    fontFamily: names === '' ? themeFace : `${names}, ${themeFace}`,
    fontSize,
    lineHeight: preferences === undefined ? (line === undefined ? FALLBACK.lineHeight : line / themeSize) : preferences.lineHeight,
    cursorStyle: preferences?.cursorStyle ?? 'block',
  };
}
