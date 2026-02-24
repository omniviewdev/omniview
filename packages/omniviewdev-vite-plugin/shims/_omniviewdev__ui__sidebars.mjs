// Auto-generated shim for '@omniviewdev/ui/sidebars'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/sidebars'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/sidebars" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ActivityBar = mod.ActivityBar;
export const NavMenu = mod.NavMenu;
export const PropertyGrid = mod.PropertyGrid;
export const SidebarGroup = mod.SidebarGroup;
export const SidebarPanel = mod.SidebarPanel;
export const SidebarTreeItem = mod.SidebarTreeItem;

export default mod.default !== undefined ? mod.default : mod;
