// Auto-generated shim for '@omniviewdev/runtime/runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime/runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime/runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Application = mod.Application;
export const Browser = mod.Browser;
export const Call = mod.Call;
export const Clipboard = mod.Clipboard;
export const Dialogs = mod.Dialogs;
export const Events = mod.Events;
export const Flags = mod.Flags;
export const Screens = mod.Screens;
export const System = mod.System;
export const WML = mod.WML;
export const Window = mod.Window;

export default mod.default !== undefined ? mod.default : mod;
