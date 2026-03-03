import type { PaletteMode, Shadows } from '@mui/material/styles';
import type { ThemeOptions } from '@mui/material/styles';

export type ThemeVariant = 'default' | 'solarized';

export type ColorScale = Record<number, string>;

export interface ThemePalettes {
  gray: ColorScale;
  brand: ColorScale;
  green: ColorScale;
  orange: ColorScale;
  red: ColorScale;
  purple: ColorScale;
}

export interface ThemeDefinition {
  palettes: ThemePalettes;
  getDesignTokens: (mode: PaletteMode) => { palette: object };
  getShadows: (mode: PaletteMode) => Shadows;
  getCustomizations: () => NonNullable<ThemeOptions['components']>;
}
