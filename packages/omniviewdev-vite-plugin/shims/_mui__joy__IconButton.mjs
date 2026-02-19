// Auto-generated shim for '@mui/joy/IconButton'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/IconButton'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/IconButton" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const iconButtonClasses = mod.iconButtonClasses;
export const getIconButtonUtilityClass = mod.getIconButtonUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
