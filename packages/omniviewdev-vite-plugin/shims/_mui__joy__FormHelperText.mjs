// Auto-generated shim for '@mui/joy/FormHelperText'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/FormHelperText'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/FormHelperText" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const formHelperTextClasses = mod.formHelperTextClasses;
export const getFormHelperTextUtilityClass = mod.getFormHelperTextUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
