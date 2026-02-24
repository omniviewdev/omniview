// Auto-generated shim for '@omniviewdev/ui/theme'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/theme'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/theme" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const AppTheme = mod.AppTheme;
export const applyTheme = mod.applyTheme;
export const brand = mod.brand;
export const customShadows = mod.customShadows;
export const dataDisplayCustomizations = mod.dataDisplayCustomizations;
export const feedbackCustomizations = mod.feedbackCustomizations;
export const getDesignTokens = mod.getDesignTokens;
export const gray = mod.gray;
export const green = mod.green;
export const inputsCustomizations = mod.inputsCustomizations;
export const navigationCustomizations = mod.navigationCustomizations;
export const orange = mod.orange;
export const purple = mod.purple;
export const red = mod.red;
export const resetTheme = mod.resetTheme;
export const shape = mod.shape;
export const typography = mod.typography;

export default mod.default !== undefined ? mod.default : mod;
