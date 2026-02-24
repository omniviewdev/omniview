// Auto-generated shim for '@mui/material/CircularProgress'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/material/CircularProgress'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/material/CircularProgress" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const circularProgressClasses = mod.circularProgressClasses;
export const getCircularProgressUtilityClass = mod.getCircularProgressUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
