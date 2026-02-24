// Auto-generated shim for '@omniviewdev/ui/table'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/table'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/table" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ColumnFilter = mod.ColumnFilter;
export const DataTable = mod.DataTable;
export const IDETable = mod.IDETable;
export const TableEmptyState = mod.TableEmptyState;
export const TableSkeleton = mod.TableSkeleton;
export const TableToolbar = mod.TableToolbar;

export default mod.default !== undefined ? mod.default : mod;
