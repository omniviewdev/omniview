// Auto-generated shim for '@omniviewdev/runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ALL_SESSIONS_KEY = mod.ALL_SESSIONS_KEY;
export const BottomDrawerContext = mod.BottomDrawerContext;
export const ConfirmationModalContext = mod.ConfirmationModalContext;
export const ErrorTypes = mod.ErrorTypes;
export const ExtensionPointRegistry = mod.ExtensionPointRegistry;
export const ExtensionPointStore = mod.ExtensionPointStore;
export const ExtensionProvider = mod.ExtensionProvider;
export const InformerResourceState = mod.InformerResourceState;
export const InformerSyncPolicy = mod.InformerSyncPolicy;
export const Link = mod.Link;
export const OperationsContext = mod.OperationsContext;
export const OperationsProvider = mod.OperationsProvider;
export const PluginContext = mod.PluginContext;
export const PluginContextProvider = mod.PluginContextProvider;
export const PluginErrorCode = mod.PluginErrorCode;
export const PluginWindow = mod.PluginWindow;
export const PluginWindowRootProps = mod.PluginWindowRootProps;
export const RightDrawerContext = mod.RightDrawerContext;
export const SettingsContext = mod.SettingsContext;
export const SettingsProvider = mod.SettingsProvider;
export const SnackbarProvider = mod.SnackbarProvider;
export const actionToSnackbar = mod.actionToSnackbar;
export const connectionListQueryKey = mod.connectionListQueryKey;
export const createErrorHandler = mod.createErrorHandler;
export const defaultState = mod.defaultState;
export const isCancelledError = mod.isCancelledError;
export const parseAppError = mod.parseAppError;
export const showAppError = mod.showAppError;
export const useActiveSyncs = mod.useActiveSyncs;
export const useBottomDrawer = mod.useBottomDrawer;
export const useConfirmationModal = mod.useConfirmationModal;
export const useConnection = mod.useConnection;
export const useConnectionNamespaces = mod.useConnectionNamespaces;
export const useConnectionStatus = mod.useConnectionStatus;
export const useConnections = mod.useConnections;
export const useEditorSchemas = mod.useEditorSchemas;
export const useExec = mod.useExec;
export const useExecuteAction = mod.useExecuteAction;
export const useExtensionPoint = mod.useExtensionPoint;
export const useExtensionPointComponents = mod.useExtensionPointComponents;
export const useExtensionRegistry = mod.useExtensionRegistry;
export const useInformerState = mod.useInformerState;
export const useLogs = mod.useLogs;
export const useMetricProviders = mod.useMetricProviders;
export const useMetricProvidersForResource = mod.useMetricProvidersForResource;
export const useMetricStream = mod.useMetricStream;
export const useOperations = mod.useOperations;
export const usePluginContext = mod.usePluginContext;
export const usePluginData = mod.usePluginData;
export const usePluginRouter = mod.usePluginRouter;
export const usePluginSettings = mod.usePluginSettings;
export const usePortForwardSessions = mod.usePortForwardSessions;
export const useResolvedPluginId = mod.useResolvedPluginId;
export const useResource = mod.useResource;
export const useResourceActions = mod.useResourceActions;
export const useResourceAreaComponent = mod.useResourceAreaComponent;
export const useResourceGroups = mod.useResourceGroups;
export const useResourceMetrics = mod.useResourceMetrics;
export const useResourceMutations = mod.useResourceMutations;
export const useResourcePortForwarder = mod.useResourcePortForwarder;
export const useResourceSearch = mod.useResourceSearch;
export const useResourceType = mod.useResourceType;
export const useResourceTypes = mod.useResourceTypes;
export const useResources = mod.useResources;
export const useRightDrawer = mod.useRightDrawer;
export const useSettings = mod.useSettings;
export const useSnackbar = mod.useSnackbar;
export const useStreamAction = mod.useStreamAction;

export default mod.default !== undefined ? mod.default : mod;
