import type { EngineAppearance } from './engine';

// The look of the screen, from the theme (docs/ui-next/status/T1.md, "The look"). An emulator that draws on a canvas cannot read a stylesheet, and the host writes no colour in code: the body renders a hidden
// swatch for each colour the screen needs (`TerminalBody.tsx`), the stylesheet paints each with the theme's own token, and this reads what the engine resolved for it. A theme change, or a change of
// the text size, is one read of about two dozen computed styles, applied to the emulator that is there.

/** The colours of the 16 of the palette, in the order an emulator numbers them. */
export const PALETTE_ROLES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;

/** Every swatch the body renders: the screen's own colours, then the palette. */
export const SWATCH_ROLES = ['background', 'foreground', 'cursor', 'cursorAccent', 'selection', 'selectionInactive', ...PALETTE_ROLES] as const;

/** What a font gets when the engine could not say: the mock's 12 px on a 16 px line. */
const FALLBACK = Object.freeze({ fontSize: 12, lineHeight: 16 / 12 });

const swatch = (root: ParentNode, role: string): Element | null => root.querySelector(`[data-swatch="${role}"]`);

/** The colour a swatch resolved to, as the engine writes it (`rgb(…)`). */
function colourOf(root: ParentNode, role: string): string {
  const element = swatch(root, role);
  return element === null ? '' : getComputedStyle(element).color;
}

/** A length in pixels, or nothing for a word (`normal`, `auto`) and for what is not a length. */
function pixelsOf(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return value.endsWith('px') && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Reads the look of the screen from the swatches under `root`. */
export function readAppearance(root: ParentNode): EngineAppearance {
  const face = swatch(root, 'font');
  const style = face === null ? undefined : getComputedStyle(face);
  const fontSize = pixelsOf(style?.fontSize ?? '') ?? FALLBACK.fontSize;
  const line = pixelsOf(style?.lineHeight ?? '');
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
    fontFamily: style?.fontFamily ?? 'monospace',
    fontSize,
    lineHeight: line === undefined ? FALLBACK.lineHeight : line / fontSize,
  };
}
