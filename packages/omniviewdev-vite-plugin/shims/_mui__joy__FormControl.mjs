// Auto-generated shim for '@mui/joy/FormControl'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/FormControl'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/FormControl" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const formControlClasses = mod.formControlClasses;
export const getFormControlUtilityClass = mod.getFormControlUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
