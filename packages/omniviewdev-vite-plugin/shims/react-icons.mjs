// Auto-generated shim for 'react-icons'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react-icons'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react-icons" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const DefaultContext = mod.DefaultContext;
export const GenIcon = mod.GenIcon;
export const IconBase = mod.IconBase;
export const IconContext = mod.IconContext;
export const IconsManifest = mod.IconsManifest;

export default mod.default !== undefined ? mod.default : mod;
