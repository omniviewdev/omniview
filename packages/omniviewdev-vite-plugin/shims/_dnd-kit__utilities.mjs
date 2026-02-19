// Auto-generated shim for '@dnd-kit/utilities'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@dnd-kit/utilities'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@dnd-kit/utilities" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CSS = mod.CSS;
export const add = mod.add;
export const canUseDOM = mod.canUseDOM;
export const findFirstFocusableNode = mod.findFirstFocusableNode;
export const getEventCoordinates = mod.getEventCoordinates;
export const getOwnerDocument = mod.getOwnerDocument;
export const getWindow = mod.getWindow;
export const hasViewportRelativeCoordinates = mod.hasViewportRelativeCoordinates;
export const isDocument = mod.isDocument;
export const isHTMLElement = mod.isHTMLElement;
export const isKeyboardEvent = mod.isKeyboardEvent;
export const isNode = mod.isNode;
export const isSVGElement = mod.isSVGElement;
export const isTouchEvent = mod.isTouchEvent;
export const isWindow = mod.isWindow;
export const subtract = mod.subtract;
export const useCombinedRefs = mod.useCombinedRefs;
export const useEvent = mod.useEvent;
export const useInterval = mod.useInterval;
export const useIsomorphicLayoutEffect = mod.useIsomorphicLayoutEffect;
export const useLatestValue = mod.useLatestValue;
export const useLazyMemo = mod.useLazyMemo;
export const useNodeRef = mod.useNodeRef;
export const usePrevious = mod.usePrevious;
export const useUniqueId = mod.useUniqueId;

export default mod.default !== undefined ? mod.default : mod;
