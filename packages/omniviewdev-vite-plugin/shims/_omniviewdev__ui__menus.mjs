// Auto-generated shim for '@omniviewdev/ui/menus'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/menus'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/menus" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ContextMenu = mod.ContextMenu;
export const DropdownMenu = mod.DropdownMenu;
export const MenuBar = mod.MenuBar;
export const NestedMenuItem = mod.NestedMenuItem;
export const SplitButton = mod.SplitButton;

export default mod.default !== undefined ? mod.default : mod;
