// Handwritten resource boundaries hide generated transport DTOs from consumers.
export * as ExecClient from './exec';
export * as NetworkerClient from './networker';
export * as PluginManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper';
export * as ResourceClient from './resource/v2/client';
export { QueryLeaseObserver } from './resource/v2/query-observer';
export type { ObserverAction, ObserverSnapshot } from './resource/v2/query-observer';
export * as GraphClient from './resource/v2/graph-client';
export * as SettingsService from './bindings/github.com/omniviewdev/omniview/backend/pkg/settings/binding';
export * as HostProfiling from './bindings/github.com/omniviewdev/omniview/internal/profiling/servicewrapper';
export * as ProcessInventory from './bindings/github.com/omniviewdev/omniview/internal/processinfo/service';
export type { Process as InventoryProcess } from './bindings/github.com/omniviewdev/omniview/internal/processinfo/models';
export * as UiInspection from './bindings/github.com/omniviewdev/omniview/internal/uiinspection/service';
export * as McpRelayClient from './bindings/github.com/omniviewdev/omniview/internal/mcprelay/servicewrapper';
export * as UtilsClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/utils/client';
export * as UIClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/servicewrapper';
export * as DiagnosticsClient from './bindings/github.com/omniviewdev/omniview/backend/diagnostics/diagnosticsclient';
export * as TelemetryClient from './bindings/github.com/omniviewdev/omniview/internal/telemetry/telemetrybinding';
export * as LogsClient from './logs';
export * as MetricClient from './metric';
export * as DataClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/data/servicewrapper';
export * as WindowClient from './bindings/github.com/omniviewdev/omniview/backend/window/service';
export * as ExtensionDiagnosticsClient from './bindings/github.com/omniviewdev/omniview/backend/extensiondiagnostics/host/service';
export * as Diagnostics from './bindings/github.com/omniviewdev/omniview/internal/diagnostics/host/service';
export type { Snapshot, Metric, MetricDescriptor, Capture, CaptureSummary, Comparison, Catalog as DiagnosticsCatalog, Health as DiagnosticsHealth } from './bindings/github.com/omniviewdev/omniview/internal/diagnostics/models';

export * as DevServerManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/devserver/servicewrapper';
export * as PluginLogManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog/servicewrapper';

export * from './bindings/github.com/omniviewdev/omniview/appservice';
