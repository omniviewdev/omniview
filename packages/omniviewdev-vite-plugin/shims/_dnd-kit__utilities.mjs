// Auto-generated shim for '@dnd-kit/utilities'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@dnd-kit/utilities'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@dnd-kit/utilities" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

// Default export: prefer mod.default, fall back to the module namespace itself.
export default mod.default !== undefined ? mod.default : mod;
