# 01: Cascading Generic Type Parameters

## Pain Point

The SDK requires **three generic type parameters** (`ClientT`, `DiscoveryT`, `InformerT`) that
cascade through every layer of the system. Every service, manager, factory, and controller must
carry these type parameters even when it only uses one of them.

### Current Code

Registration entry point (`sdk/plugin.go:170`):
```go
func RegisterResourcePlugin[ClientT, DiscoveryT, InformerT any](
    p *Plugin,
    opts IResourcePluginOpts[ClientT, DiscoveryT, InformerT],
)
```

Options interface (`sdk/resource_opts.go:11`):
```go
type IResourcePluginOpts[CT, DT, IT any] interface {
    GetClientFactory() factories.ResourceClientFactory[CT]
    GetDiscoveryClientFactory() factories.ResourceDiscoveryClientFactory[DT]
    GetInformerOpts() *types.InformerOptions[CT, IT]
    // ... 14 more methods
}
```

Concrete opts struct (`sdk/resource_opts.go:34`):
```go
type ResourcePluginOpts[ClientT, DiscoveryClientT, InformerT any] struct { ... }
```

Controller (`resource/controller.go:52`):
```go
type resourceController[ClientT, InformerT any] struct {
    resourcerManager    services.ResourcerManager[ClientT]
    connectionManager   services.ConnectionManager[ClientT]
    informerManager     *services.InformerManager[ClientT, InformerT]
    // ...
}
```

Connection manager (`resource/services/connection_manager.go:26`):
```go
type ConnectionManager[ClientT any] interface { ... }
```

### The Problem

- **`DiscoveryT`** is only used inside `RegisterResourcePlugin()` to create the type manager.
  It never appears in the controller, connection manager, resourcer manager, or any runtime path.
  Yet it forces the opts interface and struct to carry a third type parameter.

- **`InformerT`** is only used to create the informer manager. The controller carries it but
  only passes it through to `InformerManager`. Most of the controller's methods never touch it.

- **`ClientT`** is the only genuinely useful generic. It flows through `Resourcer`, `ConnectionManager`,
  and is used at call sites by plugin authors.

The cascading effect means the Kubernetes plugin registration looks like:
```go
sdk.RegisterResourcePlugin[clients.ClientSet, clients.DiscoveryClient, dynamicinformer.DynamicSharedInformerFactory](
    plugin,
    sdk.ResourcePluginOpts[clients.ClientSet, clients.DiscoveryClient, dynamicinformer.DynamicSharedInformerFactory]{...},
)
```

Three type parameters repeated twice, when only `ClientSet` matters at runtime.

---

## Options

### Option A: Keep Only `ClientT`, Type-Erase Discovery and Informer (Recommended)

**Approach**: Keep `ClientT` as the single generic parameter on `Resourcer`, `ConnectionManager`,
and the controller. Handle `DiscoveryT` and `InformerT` via type-erased wrapper functions that
close over the concrete types at registration time.

**Registration becomes:**
```go
func RegisterResourcePlugin[ClientT any](p *Plugin, opts ResourcePluginOpts[ClientT])
```

**Discovery is captured at registration time:**
```go
type ResourcePluginOpts[ClientT any] struct {
    ClientFactory     ClientFactory[ClientT]
    Resourcers        map[ResourceMeta]Resourcer[ClientT]
    DynamicResourcers map[string]DynamicResourcer[ClientT]

    // Discovery is optional. The function closes over its own client type.
    DiscoveryFunc func(ctx *PluginContext, conn *Connection) ([]ResourceMeta, error)

    // Informer is optional. The factory closes over its own informer type.
    InformerFactory func(ctx *PluginContext, conn *Connection, client *ClientT) (InformerHandle, error)

    // ... other fields
}
```

**How it works for discovery:**

The Kubernetes plugin would wrap its discovery at the call site:
```go
discoveryFactory := clients.NewKubernetesDiscoverClientFactory()

opts := sdk.ResourcePluginOpts[clients.ClientSet]{
    DiscoveryFunc: func(ctx *types.PluginContext, conn *types.Connection) ([]types.ResourceMeta, error) {
        // Closes over discoveryFactory - no generic needed
        client, err := discoveryFactory.CreateClient(ctx)
        if err != nil {
            return nil, err
        }
        return discoverResources(ctx, client)
    },
}
```

**How it works for informers:**

Define a minimal `InformerHandle` interface:
```go
type InformerHandle interface {
    RegisterResource(meta ResourceMeta) error
    Start(stopCh <-chan struct{}) error
    Stop() error
    Events() (<-chan InformerAddPayload, <-chan InformerUpdatePayload, <-chan InformerDeletePayload)
}
```

The Kubernetes plugin wraps its informer factory:
```go
opts := sdk.ResourcePluginOpts[clients.ClientSet]{
    InformerFactory: func(ctx *types.PluginContext, conn *types.Connection, client *clients.ClientSet) (types.InformerHandle, error) {
        informer := client.DynamicInformerFactory // already on the client
        return &kubeInformerHandle{factory: informer}, nil
    },
}
```

**Impact on the cascade:**
| Component | Before | After |
|-----------|--------|-------|
| `ResourcePluginOpts` | `[ClientT, DiscoveryT, InformerT]` | `[ClientT]` |
| `IResourcePluginOpts` | `[CT, DT, IT]` (17 methods) | **Eliminated** (use struct directly) |
| `ResourceController` | `[ClientT, InformerT]` | `[ClientT]` |
| `ConnectionManager` | `[ClientT]` | `[ClientT]` (unchanged) |
| `ResourcerManager` | `[ClientT]` | `[ClientT]` (unchanged) |
| `InformerManager` | `[ClientT, InformerT]` | Non-generic (uses `InformerHandle`) |
| `InformerFactory` | `[ClientT, InformerT]` | **Eliminated** (closure) |
| `DiscoveryClientFactory` | `[DiscoveryT]` | **Eliminated** (closure) |

**Pros:**
- Single generic parameter everywhere
- Discovery and informer complexity hidden behind closures
- Plugin authors write less boilerplate
- No runtime cost (closures are zero-cost in Go)
- `InformerHandle` interface is small and testable

**Cons:**
- Plugin authors lose compile-time type checking on discovery/informer internals (but they
  already owned those types, so there's nothing to misuse)
- Requires defining `InformerHandle` interface

**Migration effort:** Medium - touches opts, controller, informer manager, and plugin registration sites.

---

### Option B: Eliminate All Generics, Use `any` + Type Assertions

**Approach**: Remove all generic parameters. Use `any` for client types and assert at the
boundary.

```go
type Resourcer interface {
    Get(ctx *PluginContext, client any, input GetInput) (*GetResult, error)
    // ...
}

type ConnectionManager interface {
    GetCurrentConnectionClient(ctx *PluginContext) (any, error)
    // ...
}
```

Plugin authors assert in their resourcer:
```go
func (r *PodResourcer) Get(ctx *PluginContext, client any, input GetInput) (*GetResult, error) {
    k8sClient := client.(*clients.ClientSet)
    // ...
}
```

**Pros:**
- No generics anywhere - simplest possible types
- Zero cascade complexity

**Cons:**
- Every resourcer method starts with a type assertion (runtime panic risk)
- Loses the primary value generics provide: `ClientT` on `Resourcer` is genuinely useful
- Plugin authors get no IDE autocomplete on the client
- Regression in developer experience

**Not recommended** - removes generics where they genuinely help.

---

### Option C: Keep `ClientT` and `InformerT`, Erase Only `DiscoveryT`

**Approach**: Remove `DiscoveryT` (the least-used parameter) but keep `InformerT` for the
controller and informer manager.

```go
func RegisterResourcePlugin[ClientT, InformerT any](p *Plugin, opts ResourcePluginOpts[ClientT, InformerT])

type resourceController[ClientT, InformerT any] struct { ... }
```

**Pros:**
- Minimal change - only discovery is affected
- Preserves type safety on informer operations

**Cons:**
- Still two type parameters on controller and opts
- `InformerT` is still only used to create informers, not at call sites
- Doesn't solve the root issue (informer type adds no call-site value)

**Acceptable but doesn't go far enough** - Option A is strictly better.

---

## Recommendation

**Option A** gives the best balance. `ClientT` is the only generic that plugin authors interact
with at call sites (in `Resourcer.Get(ctx, client, input)` etc). Discovery and Informer types
are internal implementation details that can be captured in closures at registration time.
