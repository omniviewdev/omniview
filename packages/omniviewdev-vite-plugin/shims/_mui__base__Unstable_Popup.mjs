// Auto-generated shim for '@mui/base/Unstable_Popup'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/base/Unstable_Popup'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/base/Unstable_Popup" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Unstable_Popup = mod.Unstable_Popup;
export const getPopupUtilityClass = mod.getPopupUtilityClass;
export const popupClasses = mod.popupClasses;
export const PopupContext = mod.PopupContext;

export default mod.default !== undefined ? mod.default : mod;
