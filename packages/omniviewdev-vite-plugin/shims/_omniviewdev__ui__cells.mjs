// Auto-generated shim for '@omniviewdev/ui/cells'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/cells'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/cells" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BadgesCell = mod.BadgesCell;
export const ChipCell = mod.ChipCell;
export const SelectBoxHeader = mod.SelectBoxHeader;
export const SelectBoxRow = mod.SelectBoxRow;
export const TextCell = mod.TextCell;

export default mod.default !== undefined ? mod.default : mod;
