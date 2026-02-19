// Auto-generated shim for '@monaco-editor/react'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@monaco-editor/react'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@monaco-editor/react" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const DiffEditor = mod.DiffEditor;
export const Editor = mod.Editor;
export const loader = mod.loader;
export const useMonaco = mod.useMonaco;

export default mod.default !== undefined ? mod.default : mod;
