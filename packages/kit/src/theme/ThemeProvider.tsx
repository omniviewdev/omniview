/*
 * Adapted from omniviewdev/ui `packages/base-ui/src/theme/ThemeProvider.tsx` and `context.ts` at 65bbefb. Carried over:
 * requested versus active resolution with a safe fallback (a theme id the host persisted but the kit no longer has renders
 * the default and says so), and the pre-paint attribute flip. Changed: every axis is controlled by the host through props,
 * where the old provider took `initial*` props plus setters; `useTheme()` outside a provider throws instead of returning a
 * silent default; the registry is gone, the kit has nine built-in themes and no runtime registration.
 */
import { createContext, useContext, useInsertionEffect, type ReactNode } from 'react';
import {
  DEFAULT_DENSITY,
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME_ID,
  THEMES,
  type Density,
  type TextSize,
  type ThemeSummary,
} from '../generated/tokenNames';
import { applyRootAttributes } from './applyRoot';

export type ThemeState = {
  /** The id the host asked for, as given. */
  readonly requestedThemeId: string;
  /** The theme that renders: the requested one, or the default when the kit does not have it. */
  readonly activeTheme: ThemeSummary;
  readonly isFallback: boolean;
  readonly density: Density;
  readonly textSize: TextSize;
};

export type ThemeProviderProps = {
  /** A theme id. An id the kit does not have renders the default theme; `useTheme().isFallback` tells the difference. */
  readonly themeId?: string;
  readonly density?: Density;
  readonly textSize?: TextSize;
  readonly children?: ReactNode;
};

const ThemeContext = createContext<ThemeState | null>(null);

function resolveTheme(requested: string): { theme: ThemeSummary; isFallback: boolean } {
  const found = THEMES.find((theme) => theme.id === requested);
  if (found !== undefined) {
    return { theme: found, isFallback: false };
  }

  const fallback = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
  if (fallback === undefined) {
    throw new Error(`The default theme "${DEFAULT_THEME_ID}" is missing from the generated themes`);
  }

  return { theme: fallback, isFallback: true };
}

/**
 * Flips the document to a theme, a density and a text size by attributes on `<html>`; the static stylesheet does the rest, so no
 * part re-renders for a pure CSS change. Mount one provider per document.
 */
export function ThemeProvider({
  themeId = DEFAULT_THEME_ID,
  density = DEFAULT_DENSITY,
  textSize = DEFAULT_TEXT_SIZE,
  children,
}: ThemeProviderProps) {
  const { theme, isFallback } = resolveTheme(themeId);

  useInsertionEffect(
    () => applyRootAttributes(document.documentElement, { theme: theme.id, density, textSize }),
    [theme.id, density, textSize],
  );

  return (
    <ThemeContext.Provider value={{ requestedThemeId: themeId, activeTheme: theme, isFallback, density, textSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (state === null) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }

  return state;
}
