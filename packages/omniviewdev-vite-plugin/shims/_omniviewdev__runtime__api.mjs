// Auto-generated shim for '@omniviewdev/runtime/api'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime/api'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime/api" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const DiagnosticsClient = mod.DiagnosticsClient;
export const ExecClient = mod.ExecClient;
export const GetOperatingSystem = mod.GetOperatingSystem;
export const LogsClient = mod.LogsClient;
export const NetworkerClient = mod.NetworkerClient;
export const OpenFileSelectionDialog = mod.OpenFileSelectionDialog;
export const PluginManager = mod.PluginManager;
export const ResourceClient = mod.ResourceClient;
export const SaveFileDialog = mod.SaveFileDialog;
export const SettingsClient = mod.SettingsClient;
export const SettingsProvider = mod.SettingsProvider;
export const UIClient = mod.UIClient;
export const UtilsClient = mod.UtilsClient;
export const WriteFileContent = mod.WriteFileContent;

export default mod.default !== undefined ? mod.default : mod;
