// Auto-generated shim for '@omniviewdev/editors'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/editors'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/editors" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CodeEditor = mod.CodeEditor;
export const CommandPalette = mod.CommandPalette;
export const DiffViewer = mod.DiffViewer;
export const MarkdownPreview = mod.MarkdownPreview;
export const OV_MONACO_THEME = mod.OV_MONACO_THEME;
export const ObjectInspector = mod.ObjectInspector;
export const Terminal = mod.Terminal;
export const buildMonacoTheme = mod.buildMonacoTheme;
export const buildXtermTheme = mod.buildXtermTheme;
export const editorSchemas = mod.editorSchemas;
export const getComputedToken = mod.getComputedToken;
export const setupMonacoWorkers = mod.setupMonacoWorkers;
export const useEditorTheme = mod.useEditorTheme;

export default mod.default !== undefined ? mod.default : mod;
