# Plugin UI System

The plugin UI system loads, manages, and renders plugin frontend modules within the Omniview host application.

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│ PluginServiceProvider (React)                       │
│   owns PluginService instance, drives startup       │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ PluginService (core, framework-agnostic)        │ │
│ │   load / unload / reload / retry / forceReset   │ │
│ │   state machine, validation, normalization      │ │
│ │   useSyncExternalStore integration              │ │
│ └────────────────┬──────────────────────┬─────────┘ │
│                  │                      │           │
│   ┌──────────────▼───────┐  ┌───────────▼────────┐ │
│   │ PluginServiceDeps    │  │ Extension Registry  │ │
│   │ (injected adapters)  │  │ (@omniviewdev/      │ │
│   │  - importModule      │  │  runtime)           │ │
│   │  - clearModule       │  │  - addExtensionPoint│ │
│   │  - onPluginEvent     │  │  - registerContrib. │ │
│   │  - validateExports   │  │  - useExtensionPoint│ │
│   └──────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```text
ui/features/plugins/
├── core/                    # Framework-agnostic business logic
│   ├── PluginService.ts     # Central service class — state machine, lifecycle
│   ├── types.ts             # All type definitions (phases, state, config, deps)
│   ├── transitions.ts       # Phase transition validation (state machine rules)
│   ├── validation.ts        # Plugin export validation (shape checking)
│   ├── normalization.ts     # Normalize sidebars/drawers/extensions → contributions
│   └── errors.ts            # Typed error hierarchy
│
├── adapters/                # Dependency injection — wires real infra to PluginService
│   ├── createProductionDeps.ts  # Production deps (SystemJS, Wails events, etc.)
│   ├── importPlugin.ts      # SystemJS (prod) / ESM (dev) module import
│   ├── builtinModules.ts    # Static lazy imports, declarative routes, trusted resolution
│   ├── clearPlugin.ts       # Module cache cleanup
│   └── devSharedDeps.ts     # Dev-mode shared dependency setup
│
├── react/                   # React bindings
│   ├── PluginServiceProvider.tsx  # Context provider, startup orchestration
│   ├── usePluginService.ts  # Primary hook — snapshot + bound action methods
│   ├── usePluginRoutes.ts   # Derives wrapped route tree from plugin registrations
│   └── context.ts           # React context definition
│
├── components/              # UI components
│   ├── ExtensionPointRenderer.tsx  # Renders all contributions for an extension point
│   ├── PluginSurfaceBoundary.tsx   # Error boundary for plugin surfaces
│   ├── PluginRenderer.tsx          # Route-level plugin layout + error boundary
│   ├── PluginRouteStatus.tsx       # Progress/error surface before routes are available
│   ├── PluginLoadErrorPage.tsx     # Error page shown when plugin fails to load
│   └── PluginNotFoundPage.tsx      # 404 page for unknown plugin routes
│
├── testing/                 # Test infrastructure
│   └── helpers.ts           # InMemoryModuleImporter, createTestDeps(), Deferred<T>
│
├── api/                     # Low-level module loading utilities
│   ├── preloader.ts         # <link rel="modulepreload"> injection
│   ├── systemjs.ts          # SystemJS loader configuration
│   ├── shared_dependencies.ts   # Shared dep map (React, MUI, etc.)
│   ├── devSharedExporter.ts # Dev-mode: expose shared deps on window
│   └── utils.ts             # URL/path helpers
│
└── index.ts                 # Feature barrel — single import point for consumers
```

## Plugin Lifecycle

A plugin moves through these phases:

```text
idle ──→ loading ──→ ready
  ↑         │         │
  │         ▼         ▼
  │       error    unloading ──→ idle
  │         │
  │         ▼
  └──── retrying ──→ loading
```

**Phase transitions** are validated by `transitions.ts`. Invalid transitions throw.

### Loading a Plugin

1. **Resolve and import** — Native inventory selects the source. Built-ins activate their backend before a static lazy import; external plugins retain SystemJS/Vite loading.
2. **Validate** — `deps.validateExports(module)` checks the module exports a `PluginWindow` and valid contribution shapes
3. **Build registrations** — Extract routes (set via `PluginWindow.withRoutes()`)
4. **Normalize contributions** — Transform sidebars, drawers, and extension registrations into a unified `NormalizedContribution[]`
5. **Define extension points** — Register any extension points the plugin declares
6. **Apply contributions** — Register contributions into the extension point registry
7. **Emit event + notify** — Fire Wails event, notify `useSyncExternalStore` subscribers

### Startup and Development Server Readiness

The host starts external plugin UI loading during startup, not on the first sidebar click.
`useInstalledPlugins()` combines host inventory descriptors with the live dev-server
state from `useDevServers()`. That subscription is installed before fetching its
initial snapshot; status events received during the request take precedence over
the older snapshot.
Discovery shares the management `plugins` query cache, so install/uninstall
invalidation also refreshes startup descriptors without a second cache.

A positive `vitePort` only means a port has been allocated. Dev UI imports require
`viteStatus === "ready"` and a positive port. Already-ready dev plugins join the
initial `loadAll()` batch; delayed dev plugins start loading when their status
becomes ready. Both paths consume the same reconciled state. Initial-batch IDs
remain reserved until the batch settles, including plugins queued behind its
concurrency limit, so a status update cannot start a competing import.

Installed development inventory can remain stopped or failed without an active
dev-server instance. Discovery preserves the inventory phase and error so these
routes show an actionable failure instead of waiting indefinitely for a port.
The failure view exposes restart and build output even when no footer server
indicator exists. A live ready server takes precedence over stale inventory
failure metadata, allowing startup to recover without another inventory fetch.
Inventory failure details take precedence over server-discovery failures when no
server state exists. Route recovery tracks the restart request and displays its
rejection inline even when the backend emits no status event. Production plugin
failures do not offer development-only restart instructions or actions.

The provider releases its plugin registrations and native-import refresh ownership
on unmount, not just its event listeners. The extension registry is retained across
live module updates, so a replacement provider must be able to register the same
plugin-defined extension points without inheriting the retired provider's entries.
Builtins and contributions owned by other plugins are not cleared. Pending imports,
startup batches and delayed retries from the retired lifetime cannot publish into
the replacement lifetime; React Strict Mode effect replay starts a fresh batch.

The shell remains interactive while plugins initialize. `ready` describes the
initial eligible batch settling, not every development server becoming ready.
The page routes of every page tab (`ui/features/workspace/pageRoutes.tsx`) reserve `/_plugin/:pluginId/*` before plugin routes exist:
known plugins show progress, dev-server failures offer a restart, import failures
offer retry/reset (reset clears state and immediately reloads with the original
dev options), and unknown plugin URLs show not-found feedback. Once routes
are registered, each tab's memory router is rebuilt with the concrete plugin
route at the tab's current location, including deep links. Replaced routers are
disposed to release their listeners.

The homepage also distinguishes pending registration from an empty installation.
On a frontend reload it shows progress until discovery and plugin imports settle,
including dev plugins waiting for their server. Welcome is only used once that
state is settled and no cards are registered. Existing cards remain usable while
other plugins load, and saved card order is not pruned against a partial registry.

### Built-in Discovery and Demand

The host-owned `PluginInfo.origin` and `frontendModule` fields select product code.
Installed metadata cannot opt into built-in loading. `adapters/builtinModules.ts`
contains an explicit module-key registry. Each entry declares inexpensive route
metadata and a `load: () => import('./feature/entry')` function. Route metadata must
not import the feature entry. Grafana is a trusted in-tree module and declares
`activateAtStartup` because its settings contributions must exist before navigation.

Discovery registers those route descriptors without evaluating modules or calling
`PluginManager.LoadPlugin`. Built-ins never join `loadAll`, including when callers
pass them directly. Opening `/_plugin/<id>/...` activates the feature through
`PluginRouteStatus`. Commands and capability consumers explicitly call the shared
`usePluginService().load(id)` action before using feature registrations.
Startup explicitly calls that same `load(id)` action for enabled trusted modules
with `activateAtStartup`; all other built-ins remain demand-loaded. This does not
add built-ins to the external `loadAll` batch.

Typed `omniview/plugin/settings` contributions replace only their registration
owner's settings body and register draft/save/discard navigation state.
Typed `omniview/connection/settings` contributions render only where the resource
owner places `ConnectionSettingsContributions`. The owner supplies approved public
metadata; rendering never grants source credentials or resource-query authority.
Both settings surfaces accept function/class components and React memo/lazy
wrappers; lazy contributions render through the existing Suspense boundary.

Resource metric views use one finite catalog and observation surface. Native
samples remain current-only; external sources can return supported range histories.
Mixed selections partition into disjoint current/range observations by supported
shape; no current-only metric is requested as a range. Relative windows send a
duration for host-owned evaluation, while absolute bounds remain fixed. Chart
domains come from the corresponding delivered snapshot, not a frontend timer.
Profile/kind presentation preferences retain metric selection and order, layout,
display mode, time range and details visibility. Owner-connection source choices
remain separate from presentation preferences and provider credentials.
Owning views declare initial CPU/memory favorites. Selected metrics appear as
compact removable chips; additional catalog metrics live in the searchable Add
metric menu, without pruning saved unavailable IDs. History panels compose a
prominent latest value, area chart, icon display menu and shared Details footer.
Area, line and sample-bar chart modes persist exactly as `area`, `line` and
`sample-bars`; native current-only value/capacity preferences retain their vocabulary.
Source selection persists separately by owner connection and resource kind.
Successful source saves publish the host-returned revision before completion;
failed choices remain visible without replacing admitted query-cache routing.
Missing validation, preview and discovery responses are failures, not empty success.
Concise normalized errors remain visible; extended diagnostics belong in Details.
Failed, ambiguous and invalid-context/mapping results render as errors, not empty
samples. Healthy metrics remain visible when another metric fails.
Sample provenance resolves result source, then matching descriptor source, then
catalog source, preserving native supplementation inside mixed catalogs.
Genuine cluster/namespace dashboard operations retain their existing non-resource
query contract until an equivalent finite aggregate contract exists.

The production resolver reads authoritative native inventory, rejects disabled
plugins and unknown module keys, calls native `LoadPlugin`, and only then imports
the module. Unknown built-in keys never fall back to SystemJS or a dev server.
All sources use the same export validation, normalization, extension ordering and
registration pipeline. Static imports use the host's existing React/runtime
singletons; no second shared-dependency map is introduced.

Concurrent requests join one activation. Disable, unload, inventory replacement,
and provider reset retire pending work. Retirement before native startup finishes
also prevents module evaluation. Retirement during import prevents late routes or
contributions from publishing. Disable removes active registrations immediately
and hides declarative routes. Re-enable restores discovery without eager
activation; an already-open plugin page counts as navigation demand.

The management page labels built-ins as product managed, shows disabled or failed
state, and calls `SetPluginEnabled(id, enabled)` for enable/disable. Update and
uninstall actions are absent. Versions ship with Omniview, not marketplace updates.
Tests inject a `BuiltinModuleRegistry` into `createPluginModuleResolver` and
`builtinRoutes`; production feature modules need no runtime registration hook.

### Concurrency Safety

- `load()` and `reload()` deduplicate concurrent calls via `inflightLoads`; an old
  operation only releases its own reservation.
- Load generations remain monotonic across `reset()` so retired imports, delayed
  retries and cleanup continuations cannot overwrite replacement state.
- `loadAll()` imports/validates in bounded parallel chunks, registers all owned
  extension points, then applies contributions and routes. Cancelled participants
  do not publish.

### Connection Profiles

Connection editing distinguishes explicit desired profiles from the last observed effective source configuration. **Save and apply** reports success only after source application and durable host storage complete. Typed failures remain visible; an unknown source state never displays an old endpoint as current.

Native **Disable in Omniview** writes a host-owned tombstone; it does not modify native configuration files. Manual **Delete saved profile** removes the owned profile. **Reset / restore native configuration** removes an override or tombstone. Old saved discovery entries appear as inactive review candidates and activate only through explicit Import or Save; native discovery is never automatically replayed as desired configuration.


## Extension Points

Extension points are the primary way plugins contribute UI to the host.

### How They Work

1. **Extension points are declared** — The host defines built-in extension points (see below), and plugins can declare their own via `PluginWindow.registerExtensionPoints()`
2. **Plugins register contributions** — Components or data matching an extension point ID
3. **Host renders contributions** — `<ExtensionPointRenderer extensionPointId="..." />` resolves and renders all matched contributions

### Built-in Extension Points

Defined in `ui/features/extensions/registerBuiltinExtensionPoints.ts`:
- `omniview/resource/sidebar/infopanel` — Resource detail sidebars, keyed by the registering plugin and an opaque resource type ID
- `omniview/resource/drawer` — Resource detail drawers, keyed the same way
- `omniview/resource/cell` — Custom resource table cells declared by provider columns
- `dashboard:widget` — Dashboard widgets
- `homepage:card` — Homepage cards
- `logviewer:toolbar:action` — Log viewer toolbar actions

Resource drawers receive canonical `reference`, `route`, `representation`, and host-issued `targetId` independently. Observed table rows also pass their `HostRecord`, so opening a row does not issue another read. Linked resources resolve through the host and perform a fresh canonical `Get`; cancellation and optional incarnation checks remain active. Resource bodies are presentation data, never authority or cache identity.

The generic resource table uses catalog type IDs without parsing provider-specific group/version tuples. It uses only an explicit provider default representation or a user selection, exposes declared query scope dimensions, and follows native page cursors. Watch counts retain their decimal strings and count kind instead of converting them to JavaScript numbers.

Editor schemas carry canonical schema bindings. The host fetches each referenced schema document once per route and revision, registers that shared document, and links each resource editor to its declared root. YAML editor parsing retains integer precision before canonical mutation encoding.

### Resource Table Cells

A provider names a custom column renderer in `ColumnDefinition.component`. A plugin supplies it as a
`ResourceCellContribution` registered at `RESOURCE_CELL_EXTENSION_POINT_ID` (`omniview/resource/cell`) through
its existing `extensionRegistrations`; there is no module-federation loader and no second registry. The
host registers the core-owned point in `registerBuiltinExtensionPoints.ts`, and the registry rejects
malformed descriptors (`validateResourceCellContribution`) and duplicate IDs. The loader logs a rejected
contribution with its safe diagnostic and keeps the plugin's other contributions.

`CustomTableCell` resolves renderers from `useExtensionPointSnapshot`, so register, reload and unload update
mounted cells without any cached renderer reference. The pure `resolveResourceCell` selects the single
renderer: ownership is the registry's host-assigned `plugin`, never descriptor data; a plugin serves only its own
column declarations unless the contribution lists the provider in `providers`; `name` and the opaque
`resourceKeys` are compared for equality; the provider's own renderer beats an opted-in foreign one and an exact
type beats a type-agnostic renderer; equally specific candidates are ambiguous and never chosen by order.
The renderer receives `{ data, componentParams }`: the value the column accessor produced for the row and the
column declaration's `componentParams`, forwarded unchanged (`undefined` when the provider declared none).
A missing, mismatched or ambiguous renderer renders an explicit **Unavailable** cell. Each contributed cell has
its own error boundary: a crash is logged with `logPluginBoundaryError`, recorded against the contribution for
the extension inspector, and shows **Failed to render** in that cell only. Cell crashes do not quarantine
the contribution. The sidebar and drawer points use the same ownership rule: `contribution.plugin` must be the
plugin whose resource type is requested, and `meta.resourceKey` selects the type.

The generic linked-resource drawer (`ui/features/resource-drawer/`) is the host fallback used when no plugin
drawer is registered for a resource type.

### Kubernetes Resource Editors

The runtime exports `RESOURCE_EDITOR_EXTENSION_POINT` (`kubernetes/resource/editor/v1`) and
`ResourceEditorContribution`. Register a descriptor as the `value` of an existing
`ExtensionRegistration<ResourceEditorContribution>`; do not create another registry.
The authenticated loader assigns plugin ownership and contribution IDs. The registry
rejects malformed descriptors and duplicate IDs; the loader isolates rejected editor
contributions without failing unrelated plugin contributions.

Contract version 1 matches exact group, version, kind, discovered plural and scope.
Optional requirements narrow applicability through explicit capability, action, feature
and schema facts. Unknown availability never grants a requirement. Passive inspection
does not imply create/update permission. Empty resource names are reserved for
inspect-only protocol envelopes without owned paths, or explicit request protocols;
they never identify a CRUD collection.
For imported local captures only, the host may set the reserved discovery feature
`host.local-capture: 'available'` after validating the captured exact GVK. This permits
`inspect` matching when server discovery is absent or unknown, without changing that
server status. It never enables create/edit/action, overrides denied/unavailable
discovery, or satisfies other capability/schema requirements. Descriptor and manifest
data cannot establish this host-owned capture marker.

Descriptors may declare `ownershipPolicy: 'declarative' | 'conditional' | 'controller' |
'system'`; omission remains unknown. This is domain editing policy, not an RBAC grant.
The authenticated host may classify declarative resources as application-owned for
explicit create/edit, but controller owner references or actual system/installer
evidence override that classification. Conditional resources permit explicit manual
create; existing unknown ownership stays inspection-only until real policy establishes
ownership. Controller/system resources remain inspection-only. Manifest annotations,
checkboxes and descriptor policy cannot bypass discovery, real verbs or server
admission. Feature requirements must refer to evidence the host actually provides:
discovering a gated kind can establish API availability, while unknown optional
controller health is not itself permission denial.

`selectResourceEditor` prefers a compatible remembered ID, then a sole compatible
built-in, then a sole add-on. Competing providers require a chooser; no match preserves
YAML fallback. Built-in identity comes from authenticated registry ownership, not
descriptor metadata.

Forms receive an immutable redacted draft and submit atomic session/revision patches
within declared owned paths. Keep invalid local input local. Never persist drafts,
credentials or opaque markers. Reference services return sanitized projections and
distinguish empty results, denial, absence and unavailable transport. Action services
accept host-whitelisted protocols, cancellation and session generations, not URLs.
Provider `request.buildInput` callbacks always receive redacted projections. Sensitive
Kubernetes bodies instead declare `request: { protocol, source: 'canonical' }` without
a callback. Only review, service-account-token, CSR approval, pod eviction and scale
protocols permit canonical extraction. The host privately checks exact protocol,
GVK, identity and session, then extracts the minimal protocol payload. CSR approval
includes metadata and conditions only, never certificate request bytes. Projection
markers are never transport payloads; calling provider code from the host does not
make that code trusted for raw source access.
Optional `validateSubmission(draft, context, { references, actions }, signal)` performs
read-only asynchronous domain admission using real prerequisite evidence. It receives
only the immutable redacted projection and returns safe field issues; it must not
perform mutations or automatic corrective effects. The host runs it on actual submit
in both Form and YAML modes, alongside pure `validate`, even when a form is unmounted.
The host binds cancellation to session/revision and rechecks the snapshot after awaiting
before mutation. Registration, matching, selection and passive inspection never invoke
submission validators or pure validators.
This is a trusted in-process UI contract, not a security sandbox. Plugins must use the
host's compatible runtime/base-ui/theme release cohort; MUI/Emotion and private
Kubernetes components are not shared public dependencies.

The host shares `@omniviewdev/base-ui/metrics` as a separate singleton module.
Keep its entry in `api/shared_dependencies.ts` and the Vite plugin's
`SHARED_PACKAGES` list in sync: development imports use host-backed shims, while
production bundles leave the subpath external for the host's SystemJS import map.
After installing the matching UI cohort, build runtime before building the Vite
plugin; the Vite plugin build regenerates and checks shared shims.

### Error Isolation

Each contribution is wrapped in its own React `ErrorBoundary`, which catches render-time and lifecycle errors. A render crash in one plugin's contribution does not affect other contributions or the host. Crashes are logged via `logPluginBoundaryError()` with structured data (plugin ID, extension point ID, contribution ID, stack trace). Note that `ErrorBoundary` does not catch errors in event handlers, async callbacks, or non-render code paths — those require explicit `try/catch` handling within the plugin.

## React Integration

### `usePluginService()`

The primary hook. Returns a reactive snapshot of all plugin state plus bound action methods:

```tsx
const { ready, plugins, registrations, load, unload, reload } = usePluginService();
```

Uses `useSyncExternalStore` — re-renders only when the service snapshot changes.

### `usePluginRoutes()`

Derives the route tree from loaded plugin registrations. Each plugin's routes are nested under `/_plugin/{pluginId}` with a `PluginRenderer` layout component. The `usePluginRoutes` hook creates a wrapper route per plugin with `path: pluginId`, and `buildPageRoutes` nests those under the top-level `/_plugin` parent of every page tab's router:

```text
/_plugin/{pluginId}/...routes
```

Each registered route receives a local error boundary unless the plugin provides one, including boundaries exported by lazy route modules. Child route render and loader failures, function-form lazy import failures, and object-form `lazy.Component` import failures show an error inside the parent outlet, preserving the parent layout and navigation. The outer `PluginRenderer` boundary remains the last resort for failures in the plugin layout itself.

### `<ExtensionPointRenderer>`

Resolves and renders all contributions for a given extension point:

```tsx
<ExtensionPointRenderer
  extensionPointId="sidebar:resource:apps:v1:Deployment"
  context={{ resource, namespace }}
/>
```

## Testing

All core logic is tested against real implementations (not mocks) using `createTestDeps()`:

```tsx
const { service, deps, importer, eventBus } = createTestDeps();

// Register a module the importer will resolve
importer.register('my-plugin', moduleExports);

// Load and assert
await service.load('my-plugin');
expect(service.getSnapshot().plugins.get('my-plugin')?.phase).toBe('ready');
```

Key test utilities:
- `InMemoryModuleImporter` — synchronous or async-controlled module resolution
- `InMemoryEventBus` — captures emitted events for assertion
- `Deferred<T>` — manual promise resolution for testing async timing
- `LogCapture` — captures console.error calls

Run tests: `pnpm exec vitest run ui/features/plugins/`
