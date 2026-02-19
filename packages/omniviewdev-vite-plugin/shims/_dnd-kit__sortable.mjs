// Auto-generated shim for '@dnd-kit/sortable'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@dnd-kit/sortable'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@dnd-kit/sortable" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const SortableContext = mod.SortableContext;
export const arrayMove = mod.arrayMove;
export const arraySwap = mod.arraySwap;
export const defaultAnimateLayoutChanges = mod.defaultAnimateLayoutChanges;
export const defaultNewIndexGetter = mod.defaultNewIndexGetter;
export const hasSortableData = mod.hasSortableData;
export const horizontalListSortingStrategy = mod.horizontalListSortingStrategy;
export const rectSortingStrategy = mod.rectSortingStrategy;
export const rectSwappingStrategy = mod.rectSwappingStrategy;
export const sortableKeyboardCoordinates = mod.sortableKeyboardCoordinates;
export const useSortable = mod.useSortable;
export const verticalListSortingStrategy = mod.verticalListSortingStrategy;

export default mod.default !== undefined ? mod.default : mod;
