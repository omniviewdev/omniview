// Auto-generated shim for 'react/compiler-runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react/compiler-runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react/compiler-runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const c = mod.c;

export default mod.default !== undefined ? mod.default : mod;
