// Auto-generated shim for '@omniviewdev/runtime/models'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime/models'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime/models" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ActionTargetBuilder = mod.ActionTargetBuilder;
export const AggregateValue = mod.AggregateValue;
export const BuildError = mod.BuildError;
export const Category = mod.Category;
export const ColorRange = mod.ColorRange;
export const Connection = mod.Connection;
export const ConnectionAutoConnect = mod.ConnectionAutoConnect;
export const ConnectionAutoConnectRetry = mod.ConnectionAutoConnectRetry;
export const ConnectionAutoConnectTrigger = mod.ConnectionAutoConnectTrigger;
export const ConnectionLifecycle = mod.ConnectionLifecycle;
export const ConnectionStatus = mod.ConnectionStatus;
export const ConnectionStatusCode = mod.ConnectionStatusCode;
export const CurrentValue = mod.CurrentValue;
export const DataPoint = mod.DataPoint;
export const DevProcessStatus = mod.DevProcessStatus;
export const DevServerErrorPayload = mod.DevServerErrorPayload;
export const DevServerLogEntry = mod.DevServerLogEntry;
export const DevServerMode = mod.DevServerMode;
export const DevServerState = mod.DevServerState;
export const FileDialogOptions = mod.FileDialogOptions;
export const FileFilter = mod.FileFilter;
export const FindPortForwardSessionRequest = mod.FindPortForwardSessionRequest;
export const GetPluginComponentsInput = mod.GetPluginComponentsInput;
export const GetResourceAreaComponentInput = mod.GetResourceAreaComponentInput;
export const GetResourceComponentsInput = mod.GetResourceComponentsInput;
export const Handler = mod.Handler;
export const LifecycleStage = mod.LifecycleStage;
export const LogSession = mod.LogSession;
export const LogSessionOptions = mod.LogSessionOptions;
export const LogSessionStatus = mod.LogSessionStatus;
export const LogSource = mod.LogSource;
export const LogStreamCommand = mod.LogStreamCommand;
export const MetricDescriptor = mod.MetricDescriptor;
export const MetricResult = mod.MetricResult;
export const MetricShape = mod.MetricShape;
export const MetricUnit = mod.MetricUnit;
export const PluginAuthor = mod.PluginAuthor;
export const PluginCapability = mod.PluginCapability;
export const PluginComponentArea = mod.PluginComponentArea;
export const PluginComponents = mod.PluginComponents;
export const PluginInfo = mod.PluginInfo;
export const PluginLogEntry = mod.PluginLogEntry;
export const PluginMaintainer = mod.PluginMaintainer;
export const PluginMeta = mod.PluginMeta;
export const PluginResourceComponent = mod.PluginResourceComponent;
export const PluginTheme = mod.PluginTheme;
export const PluginThemeColors = mod.PluginThemeColors;
export const PortForwardConnectionType = mod.PortForwardConnectionType;
export const PortForwardProtocol = mod.PortForwardProtocol;
export const PortForwardSession = mod.PortForwardSession;
export const PortForwardSessionEncryption = mod.PortForwardSessionEncryption;
export const QueryResponse = mod.QueryResponse;
export const ResourceComponent = mod.ResourceComponent;
export const ResourceComponentArea = mod.ResourceComponentArea;
export const Session = mod.Session;
export const SessionOptions = mod.SessionOptions;
export const SessionState = mod.SessionState;
export const Setting = mod.Setting;
export const SettingFileSelection = mod.SettingFileSelection;
export const SettingOption = mod.SettingOption;
export const SettingType = mod.SettingType;
export const StateIsolationProvenance = mod.StateIsolationProvenance;
export const SyncPolicy = mod.SyncPolicy;
export const TimeSeries = mod.TimeSeries;
export const ValidationResult = mod.ValidationResult;
export const WatchState = mod.WatchState;
export const config = mod.config;
export const devserver = mod.devserver;
export const exec = mod.exec;
export const logs = mod.logs;
export const metric = mod.metric;
export const networker = mod.networker;
export const pluginlog = mod.pluginlog;
export const registry = mod.registry;
export const sameGraphNode = mod.sameGraphNode;
export const settings = mod.settings;
export const time = mod.time;
export const types = mod.types;
export const ui = mod.ui;
export const utils = mod.utils;

export default mod.default !== undefined ? mod.default : mod;
