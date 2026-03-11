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
3. **Build registrations** — Extract routes from `PluginWindow._routes`
4. **Normalize contributions** — Transform sidebars, drawers, and extension registrations into a unified `NormalizedContribution[]`
5. **Define extension points** — Register any extension points the plugin declares
6. **Apply contributions** — Register contributions into the extension point registry
7. **Emit event + notify** — Fire Wails event, notify `useSyncExternalStore` subscribers

### Concurrency Safety

- `load()` deduplicates concurrent calls via `inflightLoads` map
- `reload()` uses a generation counter (`loadGeneration`) to discard stale results
- `loadAll()` runs a two-pass strategy: Pass 1 loads in parallel, Pass 2 retries failures (dependency ordering)

## Extension Points

Extension points are the primary way plugins contribute UI to the host.

### How They Work

1. **Host declares an extension point** — e.g., `sidebar:resource:{group}:{version}:{kind}`
2. **Plugins register contributions** — Components or data matching an extension point ID pattern
3. **Host renders contributions** — `<ExtensionPointRenderer extensionPointId="..." />` resolves and renders all matched contributions

### Built-in Extension Points

Defined in `ui/features/extensions/registerBuiltinExtensionPoints.ts`:
- `sidebar:resource:{group}:{version}:{kind}` — Resource detail sidebars
- `drawer:resource:{group}:{version}:{kind}` — Resource detail drawers
- `dashboard:widget` — Dashboard widgets
- `homepage:card` — Homepage cards
- `logviewer:toolbar:action` — Log viewer toolbar actions

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

Derives the route tree from loaded plugin registrations. Each plugin's routes are nested under `/_plugin/{pluginId}` with a `PluginRenderer` layout component. The `usePluginRoutes` hook creates a wrapper route per plugin with `path: pluginId`, and `RouteProvider` nests those under the top-level `/_plugin` parent:

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
