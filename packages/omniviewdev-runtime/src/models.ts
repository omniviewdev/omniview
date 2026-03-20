export * from './bindings/github.com/omniviewdev/omniview/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/config/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';

// exec: selectively re-export to avoid Handler/ActionTargetBuilder collisions
// with logs and metric packages. The UI only uses exec's Handler.
export {
  ActionTargetBuilder,
  Handler,
  Session,
  SessionOptions,
} from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';

// logs: re-export everything except Handler and ActionTargetBuilder (collide with exec)
export {
  CreateSessionOptions,
  LogSession,
  LogSessionOptions,
  LogSessionStatus,
  LogSource,
  LogStreamCommand,
} from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';

// metric: re-export everything except Handler (collides with exec)
export {
  AggregateValue,
  ColorRange,
  CurrentValue,
  DataPoint,
  MetricDescriptor,
  MetricResult,
  MetricShape,
  MetricUnit,
  QueryRequest,
  QueryResponse,
  TimeSeries,
} from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';

// networker: re-export everything except Connection (collides with types)
export {
  FindPortForwardSessionRequest,
  PortForwardConnectionType,
  PortForwardProtocol,
  PortForwardSession,
  PortForwardSessionEncryption,
  PortForwardSessionOptions,
  SessionState,
} from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';

export * from './bindings/github.com/omniviewdev/plugin-sdk/settings/models';

// devserver: re-export everything except LogEntry (collides with pluginlog)
export {
  BuildError,
  DevInfoFile,
  DevProcessStatus,
  DevServerErrorPayload,
  DevServerManager,
  DevServerMode,
  DevServerState,
  LogEntry as DevServerLogEntry,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/devserver/models';

// pluginlog: re-export everything except LogEntry (collides with devserver)
export {
  EmitFunc,
  Manager,
  PluginLogStream,
  LogEntry as PluginLogEntry,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog/models';

export * from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/models';
