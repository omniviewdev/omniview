// Auto-generated shim for '@dnd-kit/modifiers'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@dnd-kit/modifiers'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@dnd-kit/modifiers" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const createSnapModifier = mod.createSnapModifier;
export const restrictToFirstScrollableAncestor = mod.restrictToFirstScrollableAncestor;
export const restrictToHorizontalAxis = mod.restrictToHorizontalAxis;
export const restrictToParentElement = mod.restrictToParentElement;
export const restrictToVerticalAxis = mod.restrictToVerticalAxis;
export const restrictToWindowEdges = mod.restrictToWindowEdges;
export const snapCenterToCursor = mod.snapCenterToCursor;

export default mod.default !== undefined ? mod.default : mod;
