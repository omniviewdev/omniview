// Auto-generated shim for '@mui/joy/Input'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Input'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Input" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const inputClasses = mod.inputClasses;
export const getInputUtilityClass = mod.getInputUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
