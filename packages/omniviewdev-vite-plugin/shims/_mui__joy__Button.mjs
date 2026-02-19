// Auto-generated shim for '@mui/joy/Button'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Button'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Button" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const buttonClasses = mod.buttonClasses;
export const getButtonUtilityClass = mod.getButtonUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
