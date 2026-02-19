/**
 * Theme exports for @omniviewdev/ui
 *
 * Two systems coexist:
 *  1. MUI Theme (AppTheme, primitives, customizations) — controls MUI component appearance
 *  2. CSS Custom Properties (tokens.css, applyTheme/resetTheme) — controls custom component styling
 */

// ---------------------------------------------------------------------------
// MUI Theme
// ---------------------------------------------------------------------------
export { default as AppTheme } from './AppTheme';
export type { ColorMode } from './AppTheme';

export {
  brand,
  gray,
  green,
  orange,
  red,
  purple,
  getDesignTokens,
  typography,
  shape,
  customShadows,
} from './primitives';

export { inputsCustomizations } from './customizations/inputs';
export { navigationCustomizations } from './customizations/navigation';
export { feedbackCustomizations } from './customizations/feedback';
export { dataDisplayCustomizations } from './customizations/dataDisplay';

// ---------------------------------------------------------------------------
// CSS Custom Property Runtime Theming
// ---------------------------------------------------------------------------
export interface OmniviewTheme {
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  typography?: {
    fontFamily?: string;
    monoFontFamily?: string;
    fontSize?: number;
  };
}

/**
 * Apply a theme by setting CSS custom properties on :root.
 *
 * Color keys use dot notation (e.g., "bg.surface") which maps to
 * the CSS property `--ov-bg-surface`.
 */
export function applyTheme(theme: OmniviewTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-ov-theme", theme.type);

  for (const [key, value] of Object.entries(theme.colors)) {
    const prop = `--ov-${key.replace(/\./g, "-")}`;
    root.style.setProperty(prop, value);
  }

  if (theme.typography?.fontFamily) {
    root.style.setProperty("--ov-font-ui", theme.typography.fontFamily);
  }
  if (theme.typography?.monoFontFamily) {
    root.style.setProperty("--ov-font-mono", theme.typography.monoFontFamily);
  }
  if (theme.typography?.fontSize) {
    root.style.setProperty(
      "--ov-text-base",
      `${theme.typography.fontSize / 16}rem`
    );
  }
}

/**
 * Reset to built-in theme (remove all user overrides).
 * Removes inline style overrides so the tokens.css cascade takes effect.
 */
export function resetTheme(type: "dark" | "light" = "dark"): void {
  const root = document.documentElement;
  root.setAttribute("data-ov-theme", type);
  root.removeAttribute("style");
}
