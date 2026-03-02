/**
 * AppTheme - ThemeProvider wrapper for Omniview UI
 * Based on MUI Dashboard template pattern.
 *
 * Provides a complete MUI theme with CSS variables, light/dark color schemes,
 * and component customizations. Any app consuming @omniviewdev/ui wraps its
 * tree in <AppTheme> to get consistent styling.
 *
 * Supports theme variants (e.g. 'solarized') via the `variant` prop. Each
 * variant is registered in the ThemeRegistry and supplies its own palette set
 * and component customizations while sharing typography, shape, and layout
 * tokens.
 */
import { ThemeProvider, createTheme, useColorScheme, CssBaseline } from '@mui/material';
import type { ThemeOptions } from '@mui/material/styles';
import { useMemo, useEffect, createContext, useContext, type ReactNode } from 'react';
import { typography, shape } from './primitives';
import { ThemeRegistry } from './registry/registry';
import type { ThemeVariant } from './registry/types';

export type { ThemeVariant } from './registry/types';
export type ColorMode = 'light' | 'dark' | 'system';

// ---------------------------------------------------------------------------
// Theme-variant context — lets descendants (CodeEditor, ColorSchemeToggle,
// etc.) read the active variant without prop drilling.
// ---------------------------------------------------------------------------
interface ThemeVariantContextValue {
  variant: ThemeVariant;
  colorMode: ColorMode;
}

export const ThemeVariantContext = createContext<ThemeVariantContextValue>({
  variant: 'default',
  colorMode: 'dark',
});

export function useThemeVariant() {
  return useContext(ThemeVariantContext);
}

interface AppThemeProps {
  children: ReactNode;
  /** Additional component overrides to merge into the theme */
  themeComponents?: ThemeOptions['components'];
  /** Skip all custom theming (renders children with a bare MUI theme) */
  disableCustomTheme?: boolean;
  /** Default color mode. Defaults to 'dark'. */
  defaultMode?: ColorMode;
  /** Theme variant. Defaults to 'default'. */
  variant?: ThemeVariant;
}

/**
 * ColorModeSync - Syncs a requested color mode with MUI's internal color scheme.
 * Must be rendered inside ThemeProvider.
 */
function ColorModeSync({ mode }: { mode: ColorMode }) {
  const { setMode } = useColorScheme();

  useEffect(() => {
    if (setMode) {
      setMode(mode);
    }
  }, [mode, setMode]);

  return null;
}

/**
 * OvThemeSync — keeps the `data-ov-theme` attribute on <html> in sync with
 * the chosen variant + MUI's *actual* resolved color mode so that CSS
 * custom-property themes update when the user toggles light/dark or when
 * the OS preference changes.
 */
function OvThemeSync({ variant }: { variant: ThemeVariant }) {
  const { mode, systemMode } = useColorScheme();

  useEffect(() => {
    const resolvedMode =
      mode === 'system'
        ? (systemMode ?? 'dark')
        : (mode ?? 'dark');

    const attr = variant === 'default'
      ? resolvedMode
      : `${variant}-${resolvedMode}`;

    document.documentElement.setAttribute('data-ov-theme', attr);
  }, [variant, mode, systemMode]);

  return null;
}

export default function AppTheme({
  children,
  disableCustomTheme,
  themeComponents,
  defaultMode = 'dark',
  variant = 'default',
}: AppThemeProps) {
  const theme = useMemo(() => {
    if (disableCustomTheme) {
      return createTheme();
    }

    const def = ThemeRegistry.get(variant);

    return createTheme({
      cssVariables: {
        colorSchemeSelector: 'data-mui-color-scheme',
        cssVarPrefix: 'ov-mui',
      },
      colorSchemes: {
        light: { palette: def.getDesignTokens('light').palette },
        dark: { palette: def.getDesignTokens('dark').palette },
      },
      typography,
      shape,
      shadows: def.getShadows('light'),
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            html: { height: '100%' },
            body: { height: '100%' },
          },
        },
        ...def.getCustomizations(),
        ...themeComponents,
      },
    });
  }, [disableCustomTheme, themeComponents, variant]);

  if (disableCustomTheme) {
    return <>{children}</>;
  }

  return (
    <ThemeVariantContext.Provider value={{ variant, colorMode: defaultMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <ColorModeSync mode={defaultMode} />
        <OvThemeSync variant={variant} />
        {children}
      </ThemeProvider>
    </ThemeVariantContext.Provider>
  );
}
