import { themeRegistry, type ThemeDefinition } from '@omniviewdev/base-ui';

export const SOLARIZED_THEME_ID = 'solarized';

/**
 * Ethan Schoonover's Solarized (dark), ported from the legacy design-system
 * tokens. base-ui derives its component tokens (tabs, editor, terminal, ...)
 * from these semantic tokens, so they follow automatically.
 */
const solarized: ThemeDefinition = {
  id: SOLARIZED_THEME_ID,
  name: 'Solarized',
  base: 'dark',
  colors: {
    'color.bg.base': '#002B36',
    'color.bg.inset': '#04313C',
    'color.bg.surface': '#073642',
    'color.bg.surface.raised': '#133E49',
    'color.bg.surface.overlay': '#1E4651',
    'color.bg.elevated': '#1E4651',

    'color.fg.default': 'rgba(147, 161, 161, 0.92)',
    'color.fg.muted': 'rgba(147, 161, 161, 0.64)',
    'color.fg.subtle': 'rgba(147, 161, 161, 0.44)',
    'color.fg.disabled': 'rgba(147, 161, 161, 0.28)',
    'color.fg.inverse': '#002B36',

    'color.border.default': '#4C666E',
    'color.border.muted': '#415E66',
    'color.border.strong': '#586E75',
    'color.border.focus': '#268BD2',

    'color.accent.soft': 'rgba(38, 139, 210, 0.20)',
    'color.accent.strong': '#268BD2',
    'color.brand.300': '#268BD2',
    'color.brand.400': '#268BD2',

    'color.success': '#859900',
    'color.success.soft': 'rgba(133, 153, 0, 0.12)',
    'color.warning': '#B58900',
    'color.warning.soft': 'rgba(181, 137, 0, 0.12)',
    'color.danger': '#DC322F',
    'color.danger.soft': 'rgba(220, 50, 47, 0.12)',
    'color.info': '#268BD2',
    'color.info.soft': 'rgba(38, 139, 210, 0.12)',

    'color.state.hover': 'rgba(147, 161, 161, 0.04)',
    'color.state.pressed': 'rgba(147, 161, 161, 0.07)',
    'color.state.selected': 'rgba(38, 139, 210, 0.10)',
    'color.state.focus.ring': '#268BD2',
  },
};

/** Registers the Solarized theme with base-ui. Safe to call more than once. */
export function registerSolarizedTheme(): void {
  if (!themeRegistry.has(SOLARIZED_THEME_ID)) {
    themeRegistry.register(solarized);
  }
}
