# 04: Factory Pattern Overuse

## Pain Point

The SDK defines three generic factory interfaces for creating clients, discovery clients, and
informers. Each adds a layer of indirection that provides minimal value over simple function types.

### Current Code

**ResourceClientFactory** (`resource/factories/resource_client_factory.go`):
```go
type ResourceClientFactory[ClientT any] interface {
    CreateClient(ctx *types.PluginContext) (*ClientT, error)
    RefreshClient(ctx *types.PluginContext, client *ClientT) error
    StartClient(ctx *types.PluginContext, client *ClientT) error
    StopClient(ctx *types.PluginContext, client *ClientT) error
}
```

**ResourceDiscoveryClientFactory** (`resource/factories/discovery_client_factory.go`):
```go
type ResourceDiscoveryClientFactory[ClientT any] interface {
    CreateClient(ctx *types.PluginContext) (*ClientT, error)
    RefreshClient(ctx *types.PluginContext, client *ClientT) error
    StartClient(ctx *types.PluginContext, client *ClientT) error
    StopClient(ctx *types.PluginContext, client *ClientT) error
}
```

**InformerFactory** (`resource/factories/informer_factory.go`):
```go
type InformerFactory[ClientT, InformerT any] interface {
    CreateInformer(ctx *pkgtypes.PluginContext, connection *pkgtypes.Connection, client *ClientT) (InformerT, error)
}
```

### How They're Actually Used

**Kubernetes ClientFactory** (`plugins/kubernetes/pkg/plugin/resource/clients/clients.go`):
```go
type KubernetesClientFactory struct{}

func (f *KubernetesClientFactory) CreateClient(ctx *types.PluginContext) (*ClientSet, error) {
    return KubeClientsFromContext(ctx)
}

func (f *KubernetesClientFactory) RefreshClient(ctx *types.PluginContext, client *ClientSet) error {
    client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(...)
    return nil
}

func (f *KubernetesClientFactory) StartClient(_ *types.PluginContext, _ *ClientSet) error {
    return nil  // no-op
}

func (f *KubernetesClientFactory) StopClient(_ *types.PluginContext, _ *ClientSet) error {
    return nil  // no-op
}
```

Key observations:
- `StartClient` and `StopClient` are **no-ops** in the Kubernetes plugin
- The factory struct has **no fields** - it's stateless
- `ResourceDiscoveryClientFactory` is **identical** to `ResourceClientFactory` in signature
- `InformerFactory` has a single method

### The Problems

1. **Stateless structs for function behavior**: `KubernetesClientFactory` is an empty struct
   that implements an interface. Plain functions would be simpler.

2. **Two identical factory interfaces**: `ResourceClientFactory` and `ResourceDiscoveryClientFactory`
   have the same method signatures with different names. They exist only because the generic
   parameter differs, but they could be the same interface.

3. **Required no-op methods**: Plugin authors must implement `StartClient` and `StopClient` even
   when they're not needed.

4. **Single-method interface**: `InformerFactory` wraps one function in an interface.

5. **Generic interface adds no value over generic function type**: The factory interfaces are
   generic, but since they're always used with a concrete type at the point of creation, a
   function type works just as well.

---

## Options

### Option A: Replace Factories with Function Fields (Recommended)

**Approach**: Replace factory interfaces with function types directly on `ResourcePluginOpts`.
Make optional lifecycle methods truly optional.

```go
type ResourcePluginOpts[ClientT any] struct {
    // Required: creates a new client for a connection
    CreateClient func(ctx *PluginContext) (*ClientT, error)

    // Optional: refresh an existing client (e.g., rotate credentials)
    // If nil, connections that need refresh will create a new client.
    RefreshClient func(ctx *PluginContext, client *ClientT) error

    // Optional: called when a connection starts. If nil, no-op.
    StartClient func(ctx *PluginContext, client *ClientT) error

    // Optional: called when a connection stops. If nil, no-op.
    StopClient func(ctx *PluginContext, client *ClientT) error

    // ... other fields
}
```

**ConnectionManager uses them directly:**
```go
type connectionManager[ClientT any] struct {
    createClient  func(*PluginContext) (*ClientT, error)
    refreshClient func(*PluginContext, *ClientT) error  // may be nil
    startClient   func(*PluginContext, *ClientT) error   // may be nil
    stopClient    func(*PluginContext, *ClientT) error    // may be nil
    // ...
}

func (r *connectionManager[ClientT]) StartConnection(...) {
    // ...
    if r.startClient != nil {
        if err := r.startClient(ctx, client); err != nil {
            return ..., err
        }
    }
}
```

**Kubernetes plugin registration becomes:**
```go
opts := sdk.ResourcePluginOpts[clients.ClientSet]{
    CreateClient: func(ctx *types.PluginContext) (*clients.ClientSet, error) {
        return clients.KubeClientsFromContext(ctx)
    },
    RefreshClient: func(ctx *types.PluginContext, client *clients.ClientSet) error {
        client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(...)
        return nil
    },
    // StartClient and StopClient omitted - they're nil (no-op)
}
```

**What gets deleted:**
- `factories/resource_client_factory.go` (entire file)
- `factories/discovery_client_factory.go` (entire file)
- `factories/informer_factory.go` (entire file)
- `KubernetesClientFactory` struct in the K8s plugin
- `KubernetesDiscoverClientFactory` struct in the K8s plugin

**Pros:**
- Eliminates 3 interface files and their implementations
- No-op methods don't need to be written
- Optional lifecycle hooks are naturally `nil`-checked
- Plugin code is more concise (inline functions or direct references)
- No empty structs implementing interfaces
- One fewer package (`factories/` can be removed entirely)

**Cons:**
- Loses the ability to use interface type assertions (rarely needed)
- Function fields are slightly less discoverable than interface methods in docs
  (mitigated by good field documentation)

---

### Option B: Consolidate to One Factory Interface, Make Methods Optional

**Approach**: Keep one factory interface but make `Start`/`Stop` optional via a separate
optional interface.

```go
type ClientFactory[ClientT any] interface {
    CreateClient(ctx *PluginContext) (*ClientT, error)
    RefreshClient(ctx *PluginContext, client *ClientT) error
}

// Optional - implement if your client needs explicit start/stop lifecycle
type ClientLifecycle[ClientT any] interface {
    StartClient(ctx *PluginContext, client *ClientT) error
    StopClient(ctx *PluginContext, client *ClientT) error
}
```

Connection manager checks with type assertion:
```go
if lifecycle, ok := r.factory.(ClientLifecycle[ClientT]); ok {
    lifecycle.StartClient(ctx, client)
}
```

**Pros:**
- Required methods are clear
- Optional methods don't need no-op implementations

**Cons:**
- Still uses interfaces where functions would suffice
- Type assertion at runtime is less clean
- Still need discovery factory as a separate interface or duplicate

**Acceptable but doesn't go far enough.**

---

### Option C: Keep Factories but Provide Default No-Op Base

**Approach**: Provide an embeddable base struct with default no-op implementations.

```go
type BaseClientFactory[ClientT any] struct{}

func (BaseClientFactory[ClientT]) StartClient(_ *PluginContext, _ *ClientT) error  { return nil }
func (BaseClientFactory[ClientT]) StopClient(_ *PluginContext, _ *ClientT) error   { return nil }
func (BaseClientFactory[ClientT]) RefreshClient(_ *PluginContext, _ *ClientT) error { return nil }
```

Plugin authors embed it:
```go
type KubernetesClientFactory struct {
    factories.BaseClientFactory[clients.ClientSet]
}

func (f *KubernetesClientFactory) CreateClient(ctx *types.PluginContext) (*clients.ClientSet, error) {
    return KubeClientsFromContext(ctx)
}
```

**Pros:**
- Minimal change to existing code
- Plugin authors only override what they need

**Cons:**
- Doesn't reduce the number of interfaces
- Doesn't remove the factory abstraction layer
- Embedding pattern can be confusing for Go newcomers
- Band-aid over the real issue

**Not recommended** - doesn't address the root problem.

---

## Recommendation

**Option A** is the clear winner. Factory interfaces are justified when:
- You need runtime polymorphism over multiple implementations simultaneously
- You need to mock in tests (but function types are equally mockable)
- The interface has complex state management

None of these apply here. The factories are stateless, single-implementation, and used exactly
once during registration. Function types are simpler, more idiomatic Go, and eliminate an entire
package.
