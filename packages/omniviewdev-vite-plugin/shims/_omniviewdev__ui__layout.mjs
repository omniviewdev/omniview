// Auto-generated shim for '@omniviewdev/ui/layout'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/layout'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/layout" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const AppShell = mod.AppShell;
export const DockLayout = mod.DockLayout;
export const Inline = mod.Inline;
export const Panel = mod.Panel;
export const ResizableSplitPane = mod.ResizableSplitPane;
export const Spacer = mod.Spacer;
export const Stack = mod.Stack;
export const useResizablePanel = mod.useResizablePanel;

export default mod.default !== undefined ? mod.default : mod;
