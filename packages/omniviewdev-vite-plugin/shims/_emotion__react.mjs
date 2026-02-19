// Auto-generated shim for '@emotion/react'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@emotion/react'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@emotion/react" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CacheProvider = mod.CacheProvider;
export const ClassNames = mod.ClassNames;
export const Global = mod.Global;
export const ThemeContext = mod.ThemeContext;
export const ThemeProvider = mod.ThemeProvider;
export const __unsafe_useEmotionCache = mod.__unsafe_useEmotionCache;
export const createElement = mod.createElement;
export const css = mod.css;
export const jsx = mod.jsx;
export const keyframes = mod.keyframes;
export const useTheme = mod.useTheme;
export const withEmotionCache = mod.withEmotionCache;
export const withTheme = mod.withTheme;

export default mod.default !== undefined ? mod.default : mod;
