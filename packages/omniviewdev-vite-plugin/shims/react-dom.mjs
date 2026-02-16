// Auto-generated shim for 'react-dom'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react-dom'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react-dom" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const createPortal = mod.createPortal;
export const flushSync = mod.flushSync;
export const hydrate = mod.hydrate;
export const render = mod.render;
export const unmountComponentAtNode = mod.unmountComponentAtNode;
export const unstable_batchedUpdates = mod.unstable_batchedUpdates;
export const unstable_renderSubtreeIntoContainer = mod.unstable_renderSubtreeIntoContainer;
export const version = mod.version;

export default mod.default !== undefined ? mod.default : mod;
