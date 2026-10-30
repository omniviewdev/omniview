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

1. **Import** — `deps.importModule(pluginId)` fetches the JS module (SystemJS in prod, ESM in dev)
2. **Validate** — `deps.validateExports(module)` checks the module exports a `PluginWindow` and valid contribution shapes
3. **Build registrations** — Extract routes (set via `PluginWindow.withRoutes()`)
4. **Normalize contributions** — Transform sidebars, drawers, and extension registrations into a unified `NormalizedContribution[]`
5. **Define extension points** — Register any extension points the plugin declares
6. **Apply contributions** — Register contributions into the extension point registry
7. **Emit event + notify** — Fire Wails event, notify `useSyncExternalStore` subscribers

### Startup and Development Server Readiness

The host starts plugin UI loading during startup, not on the first sidebar click.
`useInstalledPlugins()` combines installed descriptors with the live dev-server
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
- `sidebar:resource:{group}:{version}:{kind}` — Resource detail sidebars
- `drawer:resource:{group}:{version}:{kind}` — Resource detail drawers
- `dashboard:widget` — Dashboard widgets
- `homepage:card` — Homepage cards
- `logviewer:toolbar:action` — Log viewer toolbar actions

Resource drawers receive canonical `reference`, `route`, `representation`, and host-issued `targetId` independently. Observed table rows also pass their `HostRecord`, so opening a row does not issue another read. Linked resources resolve through the host and perform a fresh canonical `Get`; cancellation and optional incarnation checks remain active. Resource bodies are presentation data, never authority or cache identity.

The generic resource table uses catalog type IDs without parsing provider-specific group/version tuples. It uses only an explicit provider default representation or a user selection, exposes declared query scope dimensions, and follows native page cursors. Watch counts retain their decimal strings and count kind instead of converting them to JavaScript numbers.

Editor schemas carry canonical schema bindings. The host fetches each referenced schema document once per route and revision, registers that shared document, and links each resource editor to its declared root. YAML editor parsing retains integer precision before canonical mutation encoding.

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
