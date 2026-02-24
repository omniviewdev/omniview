// Auto-generated shim for '@mui/material/Grid'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/material/Grid'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/material/Grid" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const getGridUtilityClass = mod.getGridUtilityClass;
export const gridClasses = mod.gridClasses;

export default mod.default !== undefined ? mod.default : mod;
