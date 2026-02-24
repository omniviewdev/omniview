// Auto-generated shim for '@omniviewdev/ui/navigation'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/navigation'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/navigation" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Breadcrumbs = mod.Breadcrumbs;
export const DraggableTabs = mod.DraggableTabs;
export const Pagination = mod.Pagination;
export const PersistentTabPanel = mod.PersistentTabPanel;
export const Stepper = mod.Stepper;
export const TabPanel = mod.TabPanel;
export const Tabs = mod.Tabs;
export const TreeView = mod.TreeView;

export default mod.default !== undefined ? mod.default : mod;
