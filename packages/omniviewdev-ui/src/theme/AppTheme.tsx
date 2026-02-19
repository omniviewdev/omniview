/**
 * AppTheme - ThemeProvider wrapper for Omniview UI
 * Based on MUI Dashboard template pattern.
 *
 * Provides a complete MUI theme with CSS variables, light/dark color schemes,
 * and component customizations. Any app consuming @omniviewdev/ui wraps its
 * tree in <AppTheme> to get consistent styling.
 */
import { ThemeProvider, createTheme, useColorScheme, CssBaseline } from '@mui/material';
import type { ThemeOptions } from '@mui/material/styles';
import { useMemo, useEffect, type ReactNode } from 'react';
import {
  getDesignTokens,
  typography,
  shape,
  customShadows,
} from './primitives';
import { inputsCustomizations } from './customizations/inputs';
import { navigationCustomizations } from './customizations/navigation';
import { feedbackCustomizations } from './customizations/feedback';
import { dataDisplayCustomizations } from './customizations/dataDisplay';

export type ColorMode = 'light' | 'dark' | 'system';

interface AppThemeProps {
  children: ReactNode;
  /** Additional component overrides to merge into the theme */
  themeComponents?: ThemeOptions['components'];
  /** Skip all custom theming (renders children with a bare MUI theme) */
  disableCustomTheme?: boolean;
  /** Default color mode. Defaults to 'dark'. */
  defaultMode?: ColorMode;
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

export default function AppTheme({
  children,
  disableCustomTheme,
  themeComponents,
  defaultMode = 'dark',
}: AppThemeProps) {
  const theme = useMemo(() => {
    if (disableCustomTheme) {
      return createTheme();
    }

    return createTheme({
      cssVariables: {
        colorSchemeSelector: 'data-mui-color-scheme',
        cssVarPrefix: 'ov-mui',
      },
      colorSchemes: {
        light: {
          palette: getDesignTokens('light').palette,
        },
        dark: {
          palette: getDesignTokens('dark').palette,
        },
      },
      typography,
      shape,
      shadows: customShadows('light'),
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            html: { height: '100%' },
            body: { height: '100%' },
          },
        },
        ...inputsCustomizations,
        ...navigationCustomizations,
        ...feedbackCustomizations,
        ...dataDisplayCustomizations,
        ...themeComponents,
      },
    });
  }, [disableCustomTheme, themeComponents]);

  if (disableCustomTheme) {
    return <>{children}</>;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <ColorModeSync mode={defaultMode} />
      {children}
    </ThemeProvider>
  );
}
