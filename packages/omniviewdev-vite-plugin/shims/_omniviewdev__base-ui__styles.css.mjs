// Auto-generated shim for '@omniviewdev/base-ui/styles.css'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/base-ui/styles.css'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/base-ui/styles.css" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

// Default export: prefer mod.default, fall back to the module namespace itself.
export default mod.default !== undefined ? mod.default : mod;
