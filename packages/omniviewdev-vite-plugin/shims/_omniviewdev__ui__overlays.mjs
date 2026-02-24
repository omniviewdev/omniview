// Auto-generated shim for '@omniviewdev/ui/overlays'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/overlays'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/overlays" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Dialog = mod.Dialog;
export const Drawer = mod.Drawer;
export const ErrorOverlay = mod.ErrorOverlay;
export const Modal = mod.Modal;
export const NotificationCenter = mod.NotificationCenter;
export const Popover = mod.Popover;
export const Spotlight = mod.Spotlight;
export const ToastProvider = mod.ToastProvider;
export const Tooltip = mod.Tooltip;
export const useToast = mod.useToast;

export default mod.default !== undefined ? mod.default : mod;
