// Auto-generated shim for 'react'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Children = mod.Children;
export const Component = mod.Component;
export const Fragment = mod.Fragment;
export const Profiler = mod.Profiler;
export const PureComponent = mod.PureComponent;
export const StrictMode = mod.StrictMode;
export const Suspense = mod.Suspense;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = mod.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
export const act = mod.act;
export const cloneElement = mod.cloneElement;
export const createContext = mod.createContext;
export const createElement = mod.createElement;
export const createFactory = mod.createFactory;
export const createRef = mod.createRef;
export const forwardRef = mod.forwardRef;
export const isValidElement = mod.isValidElement;
export const lazy = mod.lazy;
export const memo = mod.memo;
export const startTransition = mod.startTransition;
export const unstable_act = mod.unstable_act;
export const useCallback = mod.useCallback;
export const useContext = mod.useContext;
export const useDebugValue = mod.useDebugValue;
export const useDeferredValue = mod.useDeferredValue;
export const useEffect = mod.useEffect;
export const useId = mod.useId;
export const useImperativeHandle = mod.useImperativeHandle;
export const useInsertionEffect = mod.useInsertionEffect;
export const useLayoutEffect = mod.useLayoutEffect;
export const useMemo = mod.useMemo;
export const useReducer = mod.useReducer;
export const useRef = mod.useRef;
export const useState = mod.useState;
export const useSyncExternalStore = mod.useSyncExternalStore;
export const useTransition = mod.useTransition;
export const version = mod.version;

export default mod.default !== undefined ? mod.default : mod;
