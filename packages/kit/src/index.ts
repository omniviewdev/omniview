// The public surface. Everything a plugin or the host may import from "@omniviewdev/kit" is exported here and nowhere else;
// `api/kit.api.md` is the report of exactly this file, and CI fails when the two differ.
export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonTone, ButtonVariant } from './components/Button';
export { Icon } from './components/Icon';
export type { IconName, IconProps, IconSize } from './components/Icon';
export { IconButton } from './components/IconButton';
export type { IconButtonProps, IconButtonSize } from './components/IconButton';
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
export { DataTable } from './components/DataTable';
export type {
  DataTableAlign,
  DataTableColumn,
  DataTableDirection,
  DataTableFit,
  DataTableProps,
  DataTableSelection,
  DataTableSort,
  DataTableSortKind,
  TextRun,
} from './components/DataTable';
export { ageTip, compactAge, useAge } from './table/age';
export type { AgeFormatter, AgeLabel } from './table/age';
export { RowMenu, RowMenuTrigger, createRowMenu } from './components/RowMenu';
export type { RowMenuFocus, RowMenuHandle, RowMenuItem, RowMenuProps, RowMenuState, RowMenuTriggerProps } from './components/RowMenu';
