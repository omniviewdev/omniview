/**
 * AppTheme - ThemeProvider wrapper for Omniview UI
 * Based on MUI Dashboard template pattern.
 *
 * Provides a complete MUI theme with CSS variables, light/dark color schemes,
 * and component customizations. Any app consuming @omniviewdev/ui wraps its
 * tree in <AppTheme> to get consistent styling.
 *
 * Supports theme variants (e.g. 'solarized') via the `variant` prop. Each
 * variant supplies its own palette set and component customizations while
 * sharing typography, shape, and layout tokens.
 */
import { ThemeProvider, createTheme, useColorScheme, CssBaseline } from '@mui/material';
import type { ThemeOptions } from '@mui/material/styles';
import { useMemo, useEffect, createContext, useContext, type ReactNode } from 'react';
import {
  getDesignTokens,
  typography,
  shape,
  customShadows,
} from './primitives';
import { createInputsCustomizations, inputsCustomizations } from './customizations/inputs';
import { createNavigationCustomizations, navigationCustomizations } from './customizations/navigation';
import { createFeedbackCustomizations, feedbackCustomizations } from './customizations/feedback';
import { createDataDisplayCustomizations, dataDisplayCustomizations } from './customizations/dataDisplay';
import {
  solarizedGray,
  solarizedBrand,
  solarizedGreen,
  solarizedOrange,
  solarizedRed,
  solarizedPurple,
  getSolarizedDesignTokens,
  solarizedCustomShadows,
} from './solarized';

export type ColorMode = 'light' | 'dark' | 'system';
export type ThemeVariant = 'default' | 'solarized';

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
 * custom-property themes update when the user toggles light/dark.
 */
function OvThemeSync({ variant }: { variant: ThemeVariant }) {
  const { mode } = useColorScheme();

  useEffect(() => {
    const resolvedMode = (mode === 'system' || !mode)
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;

    const attr = variant === 'default'
      ? resolvedMode
      : `${variant}-${resolvedMode}`;

    document.documentElement.setAttribute('data-ov-theme', attr);
  }, [variant, mode]);

  return null;
}

// ---------------------------------------------------------------------------
// Solarized customizations (computed once at module level)
// ---------------------------------------------------------------------------
const solarizedPalettes = {
  gray: solarizedGray,
  brand: solarizedBrand,
  green: solarizedGreen,
  orange: solarizedOrange,
  red: solarizedRed,
  purple: solarizedPurple,
};

const solarizedInputs = createInputsCustomizations(solarizedPalettes);
const solarizedNavigation = createNavigationCustomizations(solarizedPalettes);
const solarizedFeedback = createFeedbackCustomizations(solarizedPalettes);
const solarizedDataDisplay = createDataDisplayCustomizations(solarizedPalettes);

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

    const isSolarized = variant === 'solarized';
    const tokensFn = isSolarized ? getSolarizedDesignTokens : getDesignTokens;
    const shadowsFn = isSolarized ? solarizedCustomShadows : customShadows;

    return createTheme({
      cssVariables: {
        colorSchemeSelector: 'data-mui-color-scheme',
        cssVarPrefix: 'ov-mui',
      },
      colorSchemes: {
        light: { palette: tokensFn('light').palette },
        dark: { palette: tokensFn('dark').palette },
      },
      typography,
      shape,
      shadows: shadowsFn('light'),
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            html: { height: '100%' },
            body: { height: '100%' },
          },
        },
        ...(isSolarized ? solarizedInputs : inputsCustomizations),
        ...(isSolarized ? solarizedNavigation : navigationCustomizations),
        ...(isSolarized ? solarizedFeedback : feedbackCustomizations),
        ...(isSolarized ? solarizedDataDisplay : dataDisplayCustomizations),
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
