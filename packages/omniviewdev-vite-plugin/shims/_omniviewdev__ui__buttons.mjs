// Auto-generated shim for '@omniviewdev/ui/buttons'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/buttons'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/buttons" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ActionMenu = mod.ActionMenu;
export const Button = mod.Button;
export const ButtonGroup = mod.ButtonGroup;
export const ConfirmButton = mod.ConfirmButton;
export const CopyButton = mod.CopyButton;
export const IconButton = mod.IconButton;
export const SearchBar = mod.SearchBar;
export const ToggleButton = mod.ToggleButton;
export const ToggleGroup = mod.ToggleGroup;
export const Toolbar = mod.Toolbar;
export const ToolbarGroup = mod.ToolbarGroup;

export default mod.default !== undefined ? mod.default : mod;
