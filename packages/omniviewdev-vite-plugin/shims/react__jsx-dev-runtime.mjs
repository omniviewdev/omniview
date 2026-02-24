// Auto-generated shim for 'react/jsx-dev-runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react/jsx-dev-runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react/jsx-dev-runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Fragment = mod.Fragment;
export const jsxDEV = mod.jsxDEV;

export default mod.default !== undefined ? mod.default : mod;
