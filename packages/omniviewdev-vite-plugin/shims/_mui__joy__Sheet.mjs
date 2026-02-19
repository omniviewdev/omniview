// Auto-generated shim for '@mui/joy/Sheet'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Sheet'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Sheet" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const sheetClasses = mod.sheetClasses;
export const getSheetUtilityClass = mod.getSheetUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
