// The runtime's curated surface for a plugin's NEW-UI bundle: `@omniviewdev/runtime/ui/v1`.
//
// A plugin built for the new shell imports its data hooks from here and from nowhere else in this package. The host serves this module to the
// plugin at run time as one shared instance (`ui-next/plugins/loader`), so a hook here reads the host's QueryClient, its connection readiness
// store and its Wails runtime. It is its own entry, not a subset served under the main entry's name, so TypeScript rejects any other name at
// compile time.
//
// Rules (docs/ui-next/slices/n19-plugin-seam.md, section 2.3):
//   1. A name is added only by a reviewed change to this file AND to the API report (`api/ui-v1.api.md`, `pnpm run api:update`; CI fails on drift).
//   2. Nothing reachable from here may import the previous UI libraries (`@omniviewdev/base-ui`, `ai-ui`, `editors`), the router or Monaco, in
//      source or in declarations: `scripts/check-ui-v1.ts` proves it on the module graph and on `dist/`, and the host's `next` build is checked
//      the same way (`scripts/ui-flavour.test.mjs`).
//   3. A later contract is `./v2` beside this file; this one keeps its meaning (the export name is the version).
//
// The VALUES are the data layer the first plugin (the Pods list) reads through: ten functions and constants. No component, no router, no raw RPC.
// The TYPES are the closure of their signatures: every type a hook's parameters or results mention is exported here, so the API report holds the
// whole shape a plugin compiles against and a change to any of them shows in its diff (the build fails on a type that is mentioned and not exported).

// The connection a page reads through: its readiness, and the list of the plugin's connections.
export { useConnectionReadiness } from '../hooks/connection/useConnectionReadiness';
export type { ConnectionReadiness, ConnectionReadinessPhase, UseConnectionReadinessOptions } from '../hooks/connection/useConnectionReadiness';
export { useConnections } from '../hooks/connection/useConnections';
export type { UseConnectionsOptions } from '../hooks/connection/useConnections';
export type {
  Connection,
  ConnectionAutoConnect,
  ConnectionAutoConnectRetry,
  ConnectionAutoConnectTrigger,
  ConnectionLifecycle,
} from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';

// The catalog, the resolved target and the records of a collection.
export { useResourceTypes } from '../hooks/resource/useResourceTypes';
export { useResolvedResourceTarget } from '../hooks/resource/useResolvedResourceTarget';
export { useResources } from '../hooks/resource/useResources';
export type { AcquiredResourcePage, UseResourcesOptions } from '../hooks/resource/useResources';
export type {
  AuthorityDisclosure,
  HostEnumerateRequest,
  HostRecord,
  HostSourcePage,
  HostSourceStatus,
  ResolvedResourceTarget,
  ResolveTargetRequest,
  ResourceView,
} from '../resource/v2/host';
export type { SourceContinuity, SourceCoverage, SourceMode, SourceSessionState } from '../types/source';
// `Record` is `ResourceRecord` here: a module that exports `Record` shadows the global one for whoever imports it.
export type {
  AccessRoute,
  Count,
  Coverage,
  Dimension,
  EnumerateRequest,
  NativeAuthorityHint,
  NativeQueryDescriptor,
  Operation,
  QueryScope,
  ReadTarget,
  Record as ResourceRecord,
  Representation,
  ResourceAddress,
  ResourceCapability,
  ResourceReference,
  ResourceType,
  ScopeConstraint,
  ScopeEntry,
  SourcePage,
  Value,
} from '../resource/v2/domain';
export type { Schema, SchemaProperty, SchemaType } from '../resource/v2/ancillary';

// A record's body is an exact `Value` tree: `valueToJSON` is its presentation projection, `jsonToValue` its inverse (a test builds a record with it).
export { jsonToValue, valueToJSON } from '../resource/v2/value';

// What the runtime's errors are called and how to read one.
export { ErrorTypes } from '../errors/types';
export type { AppError, AppErrorAction } from '../errors/types';
export { isCancelledError, parseAppError } from '../errors/parseAppError';
