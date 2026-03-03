import { ThemeRegistry } from './registry';
import { defaultTheme } from './variants/default';
import { solarizedTheme } from './variants/solarized';

export function initThemeRegistry(): void {
  ThemeRegistry.register('default', defaultTheme);
  ThemeRegistry.register('solarized', solarizedTheme);
}
