import type { SemanticColor } from '../types';

/**
 * Maps SemanticColor values to their --ov-* CSS custom property names.
 * SVG fills/strokes need actual color strings, so we resolve at runtime.
 */
const tokenMap: Record<SemanticColor, string> = {
  primary: '--ov-accent',
  secondary: '--ov-fg-muted',
  success: '--ov-success-default',
  warning: '--ov-warning-default',
  error: '--ov-danger-default',
  info: '--ov-info-default',
  neutral: '--ov-fg-default',
  accent: '--ov-accent',
  danger: '--ov-danger-default',
  muted: '--ov-fg-muted',
};

const semanticColors = new Set<string>(Object.keys(tokenMap));
const colorCache = new Map<string, string>();

/** Resolves a SemanticColor or raw CSS color string to a concrete color value. */
export function resolveChartColor(color: SemanticColor | string): string {
  const cached = colorCache.get(color);
  if (cached !== undefined) return cached;

  let result: string;
  if (semanticColors.has(color)) {
    const prop = tokenMap[color as SemanticColor];
    if (typeof document !== 'undefined') {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
      result = resolved || `var(${prop})`;
    } else {
      result = `var(${prop})`;
    }
  } else {
    result = color;
  }
  colorCache.set(color, result);
  return result;
}

/** Flush cached color values (call on theme change). */
export function clearColorCache(): void {
  colorCache.clear();
}

/** Default ordered palette for chart series. */
const defaultPalette: SemanticColor[] = [
  'primary',
  'success',
  'warning',
  'info',
  'error',
  'secondary',
  'accent',
  'neutral',
];

/** Returns an array of resolved color strings for chart series. */
export function chartPalette(colors?: (SemanticColor | string)[]): string[] {
  const source = colors && colors.length > 0 ? colors : defaultPalette;
  return source.map(resolveChartColor);
}
