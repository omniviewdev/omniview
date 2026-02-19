// Auto-generated shim for '@mui/joy/Divider'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Divider'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Divider" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const dividerClasses = mod.dividerClasses;
export const getDividerUtilityClass = mod.getDividerUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
