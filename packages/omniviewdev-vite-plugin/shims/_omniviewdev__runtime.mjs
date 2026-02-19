// Auto-generated shim for '@omniviewdev/runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BottomDrawerContext = mod.BottomDrawerContext;
export const ConfirmationModalContext = mod.ConfirmationModalContext;
export const ExtensionPointRegistry = mod.ExtensionPointRegistry;
export const ExtensionPointStore = mod.ExtensionPointStore;
export const ExtensionProvider = mod.ExtensionProvider;
export const Link = mod.Link;
export const PluginContext = mod.PluginContext;
export const PluginContextProvider = mod.PluginContextProvider;
export const PluginErrorCode = mod.PluginErrorCode;
export const PluginWindow = mod.PluginWindow;
export const PluginWindowRootProps = mod.PluginWindowRootProps;
export const RightDrawerContext = mod.RightDrawerContext;
export const SettingsContext = mod.SettingsContext;
export const SettingsProvider = mod.SettingsProvider;
export const SnackbarProvider = mod.SnackbarProvider;
export const defaultState = mod.defaultState;
export const useBottomDrawer = mod.useBottomDrawer;
export const useConfirmationModal = mod.useConfirmationModal;
export const useConnection = mod.useConnection;
export const useConnectionNamespaces = mod.useConnectionNamespaces;
export const useConnections = mod.useConnections;
export const useExec = mod.useExec;
export const useExtensionPoint = mod.useExtensionPoint;
export const useExtensionPointComponents = mod.useExtensionPointComponents;
export const useExtensionRegistry = mod.useExtensionRegistry;
export const useLogs = mod.useLogs;
export const usePluginContext = mod.usePluginContext;
export const usePluginData = mod.usePluginData;
export const usePluginRouter = mod.usePluginRouter;
export const usePluginSettings = mod.usePluginSettings;
export const useResource = mod.useResource;
export const useResourceAreaComponent = mod.useResourceAreaComponent;
export const useResourceGroups = mod.useResourceGroups;
export const useExecuteAction = mod.useExecuteAction;
export const useResourceActions = mod.useResourceActions;
export const useResourceMutations = mod.useResourceMutations;
export const useResourcePortForwarder = mod.useResourcePortForwarder;
export const useResourceSearch = mod.useResourceSearch;
export const useResourceType = mod.useResourceType;
export const useResourceTypes = mod.useResourceTypes;
export const useResources = mod.useResources;
export const useRightDrawer = mod.useRightDrawer;
export const useSettings = mod.useSettings;
export const useSnackbar = mod.useSnackbar;

export default mod.default !== undefined ? mod.default : mod;
