export * from './bindings/github.com/omniviewdev/omniview/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/config/models';
export * from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
// graph: RelationshipType is already exported from the SDK resource models.
export {
  DependencyNode,
  DependencyTree,
  GraphEdge,
  GraphNode,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph/models';
// Shadows the generated WatchState with the alias-carrying one.
export { WatchState } from './compat/resource';

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
  DevServerMode,
  DevServerState,
  LogEntry as DevServerLogEntry,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/devserver/models';

// pluginlog: only LogEntry remains (re-aliased to avoid collision with devserver)
export {
  LogEntry as PluginLogEntry,
} from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog/models';

export * from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/models';

// ---------------------------------------------------------------------------
// Namespace exports (back-compat with the Wails v2 bindings)
//
// Plugins are compiled against the published runtime, which exposed the Go
// packages as namespaces (`types.Connection`, `exec.SessionOptions`, ...). The
// v3 bindings are one module per package with flat exports, so the host has to
// keep handing plugins the namespace objects or their imports resolve to
// undefined at runtime.
// ---------------------------------------------------------------------------
export * as types from './compat/types';
export * as config from './bindings/github.com/omniviewdev/plugin-sdk/pkg/config/models';
export * as exec from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';
export * as logs from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
export * as metric from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
export * as networker from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';
export * as resource from './compat/resource';
export * as settings from './bindings/github.com/omniviewdev/plugin-sdk/settings/models';
export * as devserver from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/devserver/models';
export * as pluginlog from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog/models';
export * as registry from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/registry/models';
export * as ui from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/models';
export * as utils from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/utils/models';
export * as time from './bindings/time/models';
