import type { ThemeDefinitionV1 } from '@omniviewdev/base-ui';
import type {
  ExtensionPointSettings,
  ExtensionRenderContext,
} from '@omniviewdev/runtime';

export const THEME_EXTENSION_POINT_ID = 'omniview/theme';

export type ThemeContribution = Omit<ThemeDefinitionV1, 'id'>;

export function createThemeExtensionPoint(): ExtensionPointSettings<
  ExtensionRenderContext,
  ThemeContribution
> {
  return {
    id: THEME_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'multiple',
  };
}
