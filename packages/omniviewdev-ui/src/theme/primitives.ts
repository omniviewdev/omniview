/**
 * Theme Primitives - Design tokens for Omniview UI
 * HSL-based color palettes with light/dark mode support.
 * Adapted from MUI Dashboard template.
 */
import { createTheme, type PaletteMode, type Shadows } from '@mui/material/styles';

declare module '@mui/material/Paper' {
  interface PaperPropsVariantOverrides {
    highlighted: true;
  }
}

declare module '@mui/material/styles' {
  interface ColorRange {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  }

  interface PaletteColor extends ColorRange {}

  interface Palette {
    baseShadow: string;
  }
}

const defaultTheme = createTheme();

// ---------------------------------------------------------------------------
// Color Palettes
// ---------------------------------------------------------------------------

export const brand = {
  50: 'hsl(210, 100%, 95%)',
  100: 'hsl(210, 100%, 92%)',
  200: 'hsl(210, 100%, 80%)',
  300: 'hsl(210, 100%, 65%)',
  400: 'hsl(210, 98%, 48%)',
  500: 'hsl(210, 98%, 42%)',
  600: 'hsl(210, 98%, 55%)',
  700: 'hsl(210, 100%, 35%)',
  800: 'hsl(210, 100%, 16%)',
  900: 'hsl(210, 100%, 21%)',
};

/**
 * Gray scale aligned with --ov-scale-gray-* tokens from tokens.css.
 * These values are the single source of truth for neutral colors.
 */
export const gray = {
  50:  '#ECF0F6', // --ov-scale-gray-13
  100: '#CBD5E1', // --ov-scale-gray-12
  200: '#ABB8CC', // --ov-scale-gray-11
  300: '#8B9BB5', // --ov-scale-gray-10
  400: '#6B7D96', // --ov-scale-gray-9
  500: '#3E4F66', // --ov-scale-gray-8
  600: '#2D3D52', // --ov-scale-gray-6
  700: '#1F2937', // --ov-scale-gray-4
  800: '#151B23', // --ov-scale-gray-2
  900: '#0D1117', // --ov-scale-gray-0
};

export const green = {
  50: 'hsl(120, 80%, 98%)',
  100: 'hsl(120, 75%, 94%)',
  200: 'hsl(120, 75%, 87%)',
  300: 'hsl(120, 61%, 77%)',
  400: 'hsl(120, 44%, 53%)',
  500: 'hsl(120, 59%, 30%)',
  600: 'hsl(120, 70%, 25%)',
  700: 'hsl(120, 75%, 16%)',
  800: 'hsl(120, 84%, 10%)',
  900: 'hsl(120, 87%, 6%)',
};

export const orange = {
  50: 'hsl(45, 100%, 97%)',
  100: 'hsl(45, 92%, 90%)',
  200: 'hsl(45, 94%, 80%)',
  300: 'hsl(45, 90%, 65%)',
  400: 'hsl(45, 90%, 40%)',
  500: 'hsl(45, 90%, 35%)',
  600: 'hsl(45, 91%, 25%)',
  700: 'hsl(45, 94%, 20%)',
  800: 'hsl(45, 95%, 16%)',
  900: 'hsl(45, 93%, 12%)',
};

export const red = {
  50: 'hsl(0, 100%, 97%)',
  100: 'hsl(0, 92%, 90%)',
  200: 'hsl(0, 94%, 80%)',
  300: 'hsl(0, 90%, 65%)',
  400: 'hsl(0, 90%, 40%)',
  500: 'hsl(0, 90%, 30%)',
  600: 'hsl(0, 91%, 25%)',
  700: 'hsl(0, 94%, 18%)',
  800: 'hsl(0, 95%, 12%)',
  900: 'hsl(0, 93%, 6%)',
};

export const purple = {
  50: 'hsl(270, 100%, 97%)',
  100: 'hsl(270, 92%, 90%)',
  200: 'hsl(270, 80%, 80%)',
  300: 'hsl(270, 70%, 65%)',
  400: 'hsl(270, 70%, 50%)',
  500: 'hsl(270, 70%, 42%)',
  600: 'hsl(270, 70%, 35%)',
  700: 'hsl(270, 75%, 25%)',
  800: 'hsl(270, 80%, 16%)',
  900: 'hsl(270, 85%, 10%)',
};

// ---------------------------------------------------------------------------
// Design Tokens (mode-aware palette)
// ---------------------------------------------------------------------------

/**
 * Design tokens aligned with tokens.css --ov-* semantic tokens.
 * Dark/light values here MUST match the CSS custom properties so that
 * MUI-themed components and custom components share identical colors.
 */
export const getDesignTokens = (mode: PaletteMode) => ({
  palette: {
    mode,
    primary: {
      light: brand[200],
      main: brand[400],
      dark: brand[700],
      contrastText: brand[50],
      ...(mode === 'dark' && {
        contrastText: brand[50],
        light: brand[300],
        main: brand[400],
        dark: brand[700],
      }),
    },
    info: {
      light: brand[100],
      main: brand[300],
      dark: brand[600],
      contrastText: gray[50],
      ...(mode === 'dark' && {
        contrastText: brand[300],
        light: brand[500],
        main: brand[700],
        dark: brand[900],
      }),
    },
    warning: {
      light: orange[300],
      main: orange[400],
      dark: orange[800],
      ...(mode === 'dark' && {
        light: orange[400],
        main: orange[500],
        dark: orange[700],
      }),
    },
    error: {
      light: red[300],
      main: red[400],
      dark: red[800],
      ...(mode === 'dark' && {
        light: red[400],
        main: red[500],
        dark: red[700],
      }),
    },
    success: {
      light: green[300],
      main: green[400],
      dark: green[800],
      ...(mode === 'dark' && {
        light: green[400],
        main: green[500],
        dark: green[700],
      }),
    },
    secondary: {
      light: purple[300],
      main: purple[400],
      dark: purple[700],
      contrastText: purple[50],
      ...(mode === 'dark' && {
        light: purple[300],
        main: purple[400],
        dark: purple[800],
      }),
    },
    grey: gray,
    // Matches --ov-border-default / --ov-border-muted
    divider: mode === 'dark'
      ? 'rgba(62, 79, 102, 0.6)' // alpha(--ov-scale-gray-8, 0.6)
      : 'rgba(208, 215, 222, 0.6)', // alpha(--ov-border-default light, 0.6)
    background: {
      // Matches --ov-bg-base / --ov-bg-surface
      default: mode === 'dark' ? '#0D1117' : '#FFFFFF',
      paper: mode === 'dark' ? '#151B23' : '#F6F8FA',
    },
    text: {
      // Matches --ov-fg-default / --ov-fg-muted
      primary: mode === 'dark' ? 'rgba(236, 240, 246, 0.92)' : 'rgba(31, 35, 40, 0.92)',
      secondary: mode === 'dark' ? 'rgba(236, 240, 246, 0.64)' : 'rgba(31, 35, 40, 0.64)',
    },
    action: {
      // Matches --ov-state-hover / --ov-state-selected
      hover: mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(31, 35, 40, 0.04)',
      selected: mode === 'dark' ? 'rgba(88, 166, 255, 0.10)' : 'rgba(9, 105, 218, 0.10)',
    },
    baseShadow:
      mode === 'dark'
        ? '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.25)'
        : '0 4px 12px rgba(31, 35, 40, 0.12), 0 2px 4px rgba(31, 35, 40, 0.08)',
  },
});

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const typography = {
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    '"Noto Sans"',
    'Helvetica',
    'Arial',
    'sans-serif',
  ].join(','),
  h1: { fontSize: defaultTheme.typography.pxToRem(48), fontWeight: 600, lineHeight: 1.2, letterSpacing: -0.5 },
  h2: { fontSize: defaultTheme.typography.pxToRem(36), fontWeight: 600, lineHeight: 1.2 },
  h3: { fontSize: defaultTheme.typography.pxToRem(30), fontWeight: 600, lineHeight: 1.2 },
  h4: { fontSize: defaultTheme.typography.pxToRem(24), fontWeight: 600, lineHeight: 1.5 },
  h5: { fontSize: defaultTheme.typography.pxToRem(20), fontWeight: 600 },
  h6: { fontSize: defaultTheme.typography.pxToRem(18), fontWeight: 600 },
  subtitle1: { fontSize: defaultTheme.typography.pxToRem(18) },
  subtitle2: { fontSize: defaultTheme.typography.pxToRem(14), fontWeight: 500 },
  body1: { fontSize: defaultTheme.typography.pxToRem(14) },
  body2: { fontSize: defaultTheme.typography.pxToRem(14), fontWeight: 400 },
  caption: { fontSize: defaultTheme.typography.pxToRem(12), fontWeight: 400 },
  button: { textTransform: 'none' as const, fontWeight: 600 },
  overline: {
    fontSize: defaultTheme.typography.pxToRem(12),
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
};

export const shape = { borderRadius: 8 };

export const customShadows = (mode: PaletteMode): Shadows => {
  // Matches --ov-shadow-md from tokens.css
  const baseShadow =
    mode === 'dark'
      ? '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.25)'
      : '0 4px 12px rgba(31, 35, 40, 0.12), 0 2px 4px rgba(31, 35, 40, 0.08)';

  const shadows = [...defaultTheme.shadows] as Shadows;
  shadows[1] = baseShadow;
  return shadows;
};
