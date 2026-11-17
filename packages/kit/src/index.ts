// The public surface. Everything a plugin or the host may import from "@omniviewdev/kit" is exported here and nowhere else;
// `api/kit.api.md` is the report of exactly this file, and CI fails when the two differ.
export { Icon } from './components/Icon';
export type { IconName, IconProps, IconSize } from './components/Icon';
export { Stack } from './components/Stack';
export type { StackAlign, StackDirection, StackJustify, StackProps } from './components/Stack';
export { Text } from './components/Text';
export type { TextElement, TextProps, TextTone, TextVariant } from './components/Text';
export { ThemeProvider, useTheme } from './theme/ThemeProvider';
export type { ThemeProviderProps, ThemeState } from './theme/ThemeProvider';
export { tokenVar } from './theme/tokenVar';
export { DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES, THEMES } from './generated/tokenNames';
export type { DataAttributes } from './shared/dataAttributes';
export type {
  ColorRole,
  Density,
  RadiusRole,
  SpacingStep,
  TextSize,
  ThemeId,
  ThemeScheme,
  ThemeSummary,
  TokenName,
} from './generated/tokenNames';
