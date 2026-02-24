// Auto-generated shim for '@mui/material/LinearProgress'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/material/LinearProgress'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/material/LinearProgress" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const getLinearProgressUtilityClass = mod.getLinearProgressUtilityClass;
export const linearProgressClasses = mod.linearProgressClasses;

export default mod.default !== undefined ? mod.default : mod;
