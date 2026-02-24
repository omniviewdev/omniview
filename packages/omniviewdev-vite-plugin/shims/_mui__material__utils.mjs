// Auto-generated shim for '@mui/material/utils'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/material/utils'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/material/utils" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const capitalize = mod.capitalize;
export const createChainedFunction = mod.createChainedFunction;
export const createSvgIcon = mod.createSvgIcon;
export const debounce = mod.debounce;
export const deprecatedPropType = mod.deprecatedPropType;
export const isMuiElement = mod.isMuiElement;
export const mergeSlotProps = mod.mergeSlotProps;
export const ownerDocument = mod.ownerDocument;
export const ownerWindow = mod.ownerWindow;
export const requirePropFactory = mod.requirePropFactory;
export const setRef = mod.setRef;
export const unstable_ClassNameGenerator = mod.unstable_ClassNameGenerator;
export const unstable_memoTheme = mod.unstable_memoTheme;
export const unstable_useEnhancedEffect = mod.unstable_useEnhancedEffect;
export const unstable_useId = mod.unstable_useId;
export const unsupportedProp = mod.unsupportedProp;
export const useControlled = mod.useControlled;
export const useEventCallback = mod.useEventCallback;
export const useForkRef = mod.useForkRef;

export default mod.default !== undefined ? mod.default : mod;
