// Auto-generated shim for '@omniviewdev/ui/feedback'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/feedback'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/feedback" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Alert = mod.Alert;
export const ConnectionIndicator = mod.ConnectionIndicator;
export const EmptyState = mod.EmptyState;
export const ErrorState = mod.ErrorState;
export const IDEStatusFooter = mod.IDEStatusFooter;
export const NotificationStackProvider = mod.NotificationStackProvider;
export const ProgressBar = mod.ProgressBar;
export const ProgressRing = mod.ProgressRing;
export const RunButton = mod.RunButton;
export const Skeleton = mod.Skeleton;
export const StatusBar = mod.StatusBar;
export const StatusBarItem = mod.StatusBarItem;
export const StatusDot = mod.StatusDot;
export const StatusPill = mod.StatusPill;
export const useNotificationStack = mod.useNotificationStack;

export default mod.default !== undefined ? mod.default : mod;
