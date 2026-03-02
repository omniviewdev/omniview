/**
 * Solarized Primitives — Ethan Schoonover's Solarized palette adapted
 * to the same 10-step scale structure used by primitives.ts.
 *
 * Each scale is built around the canonical Solarized accent color
 * with lighter tints (50–200) for light-mode surfaces and darker
 * shades (700–900) for dark-mode surfaces.
 */
import type { PaletteMode, Shadows } from '@mui/material/styles';
import { createTheme } from '@mui/material/styles';

const defaultTheme = createTheme();

// ---------------------------------------------------------------------------
// Color Palettes
// ---------------------------------------------------------------------------

/**
 * Gray scale aligned with the solarized-dark --ov-scale-gray-* tokens.
 * 50 = lightest (base2), 900 = darkest (base03).
 */
export const solarizedGray = {
  50:  '#EEE8D5', // base2
  100: '#93A1A1', // base1
  200: '#839496', // base0
  300: '#657B83', // base00
  400: '#586E75', // base01
  500: '#4C666E',
  600: '#35565F',
  700: '#1E4651',
  800: '#073642', // base02
  900: '#002B36', // base03
};

/** Brand — 10-step scale around Solarized Blue (#268BD2). */
export const solarizedBrand = {
  50:  '#E4F1FB',
  100: '#C6E2F8',
  200: '#7CBCE8',
  300: '#4FA3DD',
  400: '#268BD2',
  500: '#1A73AD',
  600: '#2E91D5',
  700: '#105F94',
  800: '#07354F',
  900: '#032A40',
};

/** Green — 10-step scale around Solarized Green (#859900). Dark steps read clearly green for chip distinction. */
export const solarizedGreen = {
  50:  '#F5F7E6',
  100: '#E5EBBD',
  200: '#93B86A',
  300: '#A8BB4D',
  400: '#859900',
  500: '#6E7F00',
  600: '#5D6B06',
  700: '#434F04',
  800: '#0F3D2A',
  900: '#083320',
};

/** Orange — 10-step scale around Solarized Yellow (#B58900). Dark steps read clearly amber for chip distinction. */
export const solarizedOrange = {
  50:  '#FEF8E6',
  100: '#FAECBA',
  200: '#D4B85A',
  300: '#DFB540',
  400: '#B58900',
  500: '#997300',
  600: '#9B4A08',
  700: '#6E5302',
  800: '#3D2808',
  900: '#2D1E06',
};

/** Red — 10-step scale around Solarized Red (#DC322F). */
export const solarizedRed = {
  50:  '#FBECEC',
  100: '#F5CECE',
  200: '#EA9695',
  300: '#DE6462',
  400: '#DC322F',
  500: '#BC2320',
  600: '#981D1B',
  700: '#701411',
  800: '#4A0B09',
  900: '#2F0504',
};

/** Purple — 10-step scale around Solarized Violet (#6C71C4). */
export const solarizedPurple = {
  50:  '#EEEEF9',
  100: '#D1D2F0',
  200: '#A4A7DD',
  300: '#8387CF',
  400: '#6C71C4',
  500: '#5559AC',
  600: '#474A92',
  700: '#363972',
  800: '#232547',
  900: '#14152D',
};

// ---------------------------------------------------------------------------
// Design Tokens (mode-aware palette)
// ---------------------------------------------------------------------------

export const getSolarizedDesignTokens = (mode: PaletteMode) => ({
  palette: {
    mode,
    primary: {
      light: solarizedBrand[200],
      main: solarizedBrand[400],
      dark: solarizedBrand[700],
      contrastText: solarizedBrand[50],
      ...(mode === 'dark' && {
        contrastText: solarizedBrand[50],
        light: solarizedBrand[300],
        main: solarizedBrand[400],
        dark: solarizedBrand[700],
      }),
    },
    info: {
      light: solarizedBrand[100],
      main: solarizedBrand[300],
      dark: solarizedBrand[600],
      contrastText: solarizedGray[50],
      ...(mode === 'dark' && {
        contrastText: solarizedBrand[300],
        light: solarizedBrand[500],
        main: solarizedBrand[700],
        dark: solarizedBrand[900],
      }),
    },
    warning: {
      light: solarizedOrange[300],
      main: solarizedOrange[400],
      dark: solarizedOrange[800],
      ...(mode === 'dark' && {
        light: solarizedOrange[400],
        main: solarizedOrange[500],
        dark: solarizedOrange[700],
      }),
    },
    error: {
      light: solarizedRed[300],
      main: solarizedRed[400],
      dark: solarizedRed[800],
      ...(mode === 'dark' && {
        light: solarizedRed[400],
        main: solarizedRed[500],
        dark: solarizedRed[700],
      }),
    },
    success: {
      light: solarizedGreen[300],
      main: solarizedGreen[400],
      dark: solarizedGreen[800],
      ...(mode === 'dark' && {
        light: solarizedGreen[400],
        main: solarizedGreen[500],
        dark: solarizedGreen[700],
      }),
    },
    secondary: {
      light: solarizedPurple[300],
      main: solarizedPurple[400],
      dark: solarizedPurple[700],
      contrastText: solarizedPurple[50],
      ...(mode === 'dark' && {
        light: solarizedPurple[300],
        main: solarizedPurple[400],
        dark: solarizedPurple[800],
      }),
    },
    grey: solarizedGray,
    divider: mode === 'dark'
      ? 'rgba(76, 102, 110, 0.6)'
      : 'rgba(201, 194, 175, 0.6)',
    background: {
      default: mode === 'dark' ? '#002B36' : '#FDF6E3',
      paper: mode === 'dark' ? '#073642' : '#EEE8D5',
    },
    text: {
      primary: mode === 'dark' ? 'rgba(147, 161, 161, 0.92)' : 'rgba(88, 110, 117, 0.92)',
      secondary: mode === 'dark' ? 'rgba(147, 161, 161, 0.64)' : 'rgba(88, 110, 117, 0.64)',
    },
    action: {
      hover: mode === 'dark' ? 'rgba(147, 161, 161, 0.04)' : 'rgba(88, 110, 117, 0.04)',
      selected: mode === 'dark' ? 'rgba(38, 139, 210, 0.10)' : 'rgba(38, 139, 210, 0.10)',
    },
    baseShadow:
      mode === 'dark'
        ? '0 4px 12px rgba(0, 20, 26, 0.35), 0 2px 4px rgba(0, 20, 26, 0.25)'
        : '0 4px 12px rgba(88, 110, 117, 0.12), 0 2px 4px rgba(88, 110, 117, 0.08)',
  },
});

export const solarizedCustomShadows = (mode: PaletteMode): Shadows => {
  const baseShadow =
    mode === 'dark'
      ? '0 4px 12px rgba(0, 20, 26, 0.35), 0 2px 4px rgba(0, 20, 26, 0.25)'
      : '0 4px 12px rgba(88, 110, 117, 0.12), 0 2px 4px rgba(88, 110, 117, 0.08)';

  const shadows = [...defaultTheme.shadows] as Shadows;
  shadows[1] = baseShadow;
  return shadows;
};
