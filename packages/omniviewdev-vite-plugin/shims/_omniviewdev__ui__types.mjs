// Auto-generated shim for '@omniviewdev/ui/types'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/types'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/types" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const INPUT_HEIGHTS = mod.INPUT_HEIGHTS;
export const sizeOverrideSx = mod.sizeOverrideSx;
export const statusToColor = mod.statusToColor;
export const toBorderRadius = mod.toBorderRadius;
export const toCssColor = mod.toCssColor;
export const toMuiColor = mod.toMuiColor;
export const toMuiInputSize = mod.toMuiInputSize;
export const toMuiSize = mod.toMuiSize;
export const toMuiVariant = mod.toMuiVariant;

export default mod.default !== undefined ? mod.default : mod;
