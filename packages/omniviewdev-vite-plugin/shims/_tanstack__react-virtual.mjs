// Auto-generated shim for '@tanstack/react-virtual'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@tanstack/react-virtual'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@tanstack/react-virtual" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Virtualizer = mod.Virtualizer;
export const approxEqual = mod.approxEqual;
export const debounce = mod.debounce;
export const defaultKeyExtractor = mod.defaultKeyExtractor;
export const defaultRangeExtractor = mod.defaultRangeExtractor;
export const elementScroll = mod.elementScroll;
export const measureElement = mod.measureElement;
export const memo = mod.memo;
export const notUndefined = mod.notUndefined;
export const observeElementOffset = mod.observeElementOffset;
export const observeElementRect = mod.observeElementRect;
export const observeWindowOffset = mod.observeWindowOffset;
export const observeWindowRect = mod.observeWindowRect;
export const useVirtualizer = mod.useVirtualizer;
export const useWindowVirtualizer = mod.useWindowVirtualizer;
export const windowScroll = mod.windowScroll;

export default mod.default !== undefined ? mod.default : mod;
