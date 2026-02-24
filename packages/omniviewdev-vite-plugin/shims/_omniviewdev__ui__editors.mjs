// Auto-generated shim for '@omniviewdev/ui/editors'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/editors'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/editors" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CodeEditor = mod.CodeEditor;
export const DiffViewer = mod.DiffViewer;
export const Terminal = mod.Terminal;
export const CommandPalette = mod.CommandPalette;
export const MarkdownPreview = mod.MarkdownPreview;
export const registerOmniviewThemes = mod.registerOmniviewThemes;
export const omniviewDark = mod.omniviewDark;
export const omniviewLight = mod.omniviewLight;

export default mod.default !== undefined ? mod.default : mod;
