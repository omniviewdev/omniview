// Handwritten resource boundaries hide generated transport DTOs from consumers.
export * as ExecClient from './exec';
export * as NetworkerClient from './networker';
export * as PluginManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper';
export * as ResourceClient from './resource/v2/client';
export * as GraphClient from './resource/v2/graph-client';
export * as SettingsService from './bindings/github.com/omniviewdev/omniview/backend/pkg/settings/binding';
export * as HostProfiling from './bindings/github.com/omniviewdev/omniview/internal/profiling/servicewrapper';
export * as McpRelayClient from './bindings/github.com/omniviewdev/omniview/internal/mcprelay/servicewrapper';
export * as UtilsClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/utils/client';
export * as UIClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/servicewrapper';
export * as DiagnosticsClient from './bindings/github.com/omniviewdev/omniview/backend/diagnostics/diagnosticsclient';
export * as LogsClient from './logs';
export * as MetricClient from './metric';
export * as DataClient from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/data/servicewrapper';
export * as WindowClient from './bindings/github.com/omniviewdev/omniview/backend/window/service';

export * as DevServerManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/devserver/servicewrapper';
export * as PluginLogManager from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog/servicewrapper';

export * from './bindings/github.com/omniviewdev/omniview/appservice';
