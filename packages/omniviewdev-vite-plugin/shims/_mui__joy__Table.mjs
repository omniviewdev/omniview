// Auto-generated shim for '@mui/joy/Table'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Table'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Table" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const tableClasses = mod.tableClasses;
export const getTableUtilityClass = mod.getTableUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
