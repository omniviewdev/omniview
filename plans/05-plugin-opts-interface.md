# 05: Replace IResourcePluginOpts Interface with Struct

## Pain Point

`IResourcePluginOpts` is a 17-method interface with 3 generic type parameters that exists solely
to abstract over `ResourcePluginOpts` (the only implementation). It's a "getter interface" -
every method is a `GetX()` that returns a field value.

### Current Code (`sdk/resource_opts.go`)

```go
type IResourcePluginOpts[CT, DT, IT any] interface {
    HasDiscovery() (bool, error)
    GetClientFactory() factories.ResourceClientFactory[CT]
    GetResourcers() map[types.ResourceMeta]types.Resourcer[CT]
    GetDynamicResourcers() map[string]types.DynamicResourcer[CT]
    HasDynamicResourcers() bool
    GetDiscoveryClientFactory() factories.ResourceDiscoveryClientFactory[DT]
    GetDiscoveryFunc() func(*pkgtypes.PluginContext, *DT) ([]types.ResourceMeta, error)
    HasInformer() bool
    GetInformerOpts() *types.InformerOptions[CT, IT]
    GetLayoutOpts() *types.LayoutOpts
    GetLoadConnectionFunc() func(*pkgtypes.PluginContext) ([]pkgtypes.Connection, error)
    GetLoadConnectionNamespacesFunc() func(*pkgtypes.PluginContext, *CT) ([]string, error)
    GetWatchConnectionsFunc() func(*pkgtypes.PluginContext) (chan []pkgtypes.Connection, error)
    GetCheckConnectionFunc() func(*pkgtypes.PluginContext, *pkgtypes.Connection, *CT) (pkgtypes.ConnectionStatus, error)
    GetResourceDefinitions() map[string]types.ResourceDefinition
    GetDefaultResourceDefinition() types.ResourceDefinition
    GetResourceGroups() []types.ResourceGroup
}
```

The struct `ResourcePluginOpts[ClientT, DiscoveryClientT, InformerT]` then has 17 methods that
each return a field:

```go
func (opts ResourcePluginOpts[CT, DT, IT]) GetClientFactory() factories.ResourceClientFactory[CT] {
    return opts.ClientFactory
}
// ... 16 more like this
```

### The Problem

1. **Interface with one implementation** - `IResourcePluginOpts` is only implemented by
   `ResourcePluginOpts`. There's no polymorphism.

2. **Getter methods for public fields** - Each method returns a struct field. The caller could
   just read the field directly.

3. **17 methods * 3 type params** - Every method signature carries `[CT, DT, IT]` for no reason.

4. **`RegisterResourcePlugin` takes the interface, not the struct** - But since there's only one
   implementation, this just adds a layer of indirection.

5. **Validation mixed with accessors** - `HasDiscovery()` does validation (checks that factory
   and func are both set or both nil). This is better as an explicit `Validate()` method.

---

## Options

### Option A: Use Struct Directly, Add Validate Method (Recommended)

**Approach**: Delete the interface entirely. Pass the struct directly to `RegisterResourcePlugin`.
Add a `Validate()` method for configuration validation.

Assuming Plan 01 reduces to single generic and Plan 04 replaces factories with functions:

```go
type ResourcePluginOpts[ClientT any] struct {
    // Client lifecycle
    CreateClient  func(ctx *PluginContext) (*ClientT, error)                    // required
    RefreshClient func(ctx *PluginContext, client *ClientT) error               // optional
    StartClient   func(ctx *PluginContext, client *ClientT) error               // optional
    StopClient    func(ctx *PluginContext, client *ClientT) error               // optional

    // Resource handlers
    Resourcers        map[ResourceMeta]Resourcer[ClientT]    // exact-match handlers
    PatternResourcers map[string]Resourcer[ClientT]          // wildcard fallback handlers

    // Resource metadata
    ResourceGroups             []ResourceGroup
    ResourceDefinitions        map[string]ResourceDefinition
    DefaultResourceDefinition  ResourceDefinition

    // Discovery (optional)
    DiscoveryFunc func(ctx *PluginContext, conn *Connection) ([]ResourceMeta, error)

    // Informer (optional)
    InformerFactory func(ctx *PluginContext, conn *Connection, client *ClientT) (InformerHandle, error)

    // Connections
    LoadConnections           func(ctx *PluginContext) ([]Connection, error)
    LoadConnectionNamespaces  func(ctx *PluginContext, client *ClientT) ([]string, error)
    WatchConnections          func(ctx *PluginContext) (chan []Connection, error)
    CheckConnection           func(ctx *PluginContext, conn *Connection, client *ClientT) (ConnectionStatus, error)

    // Layout (optional)
    LayoutOpts *LayoutOpts
}

func (opts *ResourcePluginOpts[ClientT]) Validate() error {
    if opts.CreateClient == nil {
        return errors.New("CreateClient is required")
    }
    if opts.Resourcers == nil && opts.PatternResourcers == nil {
        return errors.New("at least one Resourcer or PatternResourcer is required")
    }
    return nil
}

func RegisterResourcePlugin[ClientT any](p *Plugin, opts ResourcePluginOpts[ClientT]) {
    if err := opts.Validate(); err != nil {
        panic(fmt.Sprintf("invalid resource plugin options: %v", err))
    }
    // ... setup managers and controller
}
```

**What gets deleted:**
- `IResourcePluginOpts` interface (entire definition)
- 17 getter methods on `ResourcePluginOpts`
- `HasDiscovery()`, `HasInformer()`, `HasDynamicResourcers()` methods (replaced by nil checks)

**Kubernetes plugin registration becomes:**
```go
sdk.RegisterResourcePlugin(plugin, sdk.ResourcePluginOpts[clients.ClientSet]{
    CreateClient:  clients.KubeClientsFromContext,
    RefreshClient: clients.RefreshKubeClient,

    Resourcers: map[types.ResourceMeta]types.Resourcer[clients.ClientSet]{
        // ... resource registrations
    },
    PatternResourcers: map[string]types.Resourcer[clients.ClientSet]{
        "*": resourcers.NewKubernetesDynamicResourcer(logger),
    },

    DiscoveryFunc:            connections.DiscoveryFunc,
    LoadConnections:          connections.LoadConnectionsFunc,
    WatchConnections:         connections.WatchConnectionsFunc,
    LoadConnectionNamespaces: connections.LoadConnectionNamespacesFunc,
    CheckConnection:          connections.CheckConnectionFunc,

    ResourceGroups:      groups.ResourceGroups,
    ResourceDefinitions: resourcers.ResourceDefs,
    // ...
})
```

**Pros:**
- ~100 lines of interface + getter boilerplate deleted
- Fields are directly readable (no `.GetX()` calls)
- Nil checks replace `HasX()` methods (idiomatic Go)
- Validation is explicit, not spread across accessor methods
- One type parameter instead of three
- Plugin authors see the struct fields in their IDE - better discoverability

**Cons:**
- None significant. The interface provided no polymorphism.

---

### Option B: Builder Pattern

**Approach**: Replace both the interface and struct with a fluent builder.

```go
type ResourcePluginBuilder[ClientT any] struct {
    opts ResourcePluginOpts[ClientT]
}

func NewResourcePlugin[ClientT any]() *ResourcePluginBuilder[ClientT] {
    return &ResourcePluginBuilder[ClientT]{}
}

func (b *ResourcePluginBuilder[ClientT]) WithCreateClient(
    fn func(*PluginContext) (*ClientT, error),
) *ResourcePluginBuilder[ClientT] {
    b.opts.CreateClient = fn
    return b
}

func (b *ResourcePluginBuilder[ClientT]) WithResourcer(
    meta ResourceMeta, r Resourcer[ClientT],
) *ResourcePluginBuilder[ClientT] {
    if b.opts.Resourcers == nil {
        b.opts.Resourcers = make(map[ResourceMeta]Resourcer[ClientT])
    }
    b.opts.Resourcers[meta] = r
    return b
}

func (b *ResourcePluginBuilder[ClientT]) Register(p *Plugin) {
    RegisterResourcePlugin(p, b.opts)
}
```

Usage:
```go
sdk.NewResourcePlugin[clients.ClientSet]().
    WithCreateClient(clients.KubeClientsFromContext).
    WithResourcer(podMeta, podResourcer).
    WithResourcer(deployMeta, deployResourcer).
    WithDiscovery(discoveryFunc).
    Register(plugin)
```

**Pros:**
- Fluent API can be pleasant for incremental construction
- Can validate at `.Register()` time

**Cons:**
- More code than just using a struct literal
- Harder to see all configuration at once
- Builder pattern is uncommon in Go (not idiomatic)
- Adds methods where fields suffice
- The Kubernetes plugin registers 150+ resourcers - a builder chain would be very long

**Not recommended** - a struct literal is more readable and more Go-idiomatic.

---

### Option C: Functional Options Pattern

**Approach**: Use the common Go functional options pattern.

```go
type ResourcePluginOption[ClientT any] func(*ResourcePluginOpts[ClientT])

func WithCreateClient[ClientT any](fn func(*PluginContext) (*ClientT, error)) ResourcePluginOption[ClientT] {
    return func(opts *ResourcePluginOpts[ClientT]) {
        opts.CreateClient = fn
    }
}

func RegisterResourcePlugin[ClientT any](p *Plugin, options ...ResourcePluginOption[ClientT]) {
    opts := &ResourcePluginOpts[ClientT]{}
    for _, opt := range options {
        opt(opts)
    }
    // ...
}
```

**Pros:**
- Familiar Go pattern (common in libraries like gRPC, HTTP servers)
- Easy to make options optional

**Cons:**
- Significant boilerplate: one `WithX` function per option
- Hard to see all configuration at a glance
- With 15+ options, the option function list is long
- Generics on functional options are awkward (`WithCreateClient[clients.ClientSet](...)`)
- Over-engineering for a struct that's constructed once at startup

**Not recommended** - functional options shine for APIs with many optional knobs and frequent
construction. Plugin opts are configured once.

---

## Recommendation

**Option A** is the clear choice. The interface adds no value (single implementation, no
polymorphism, all methods are trivial getters). A plain struct with a `Validate()` method is
simpler, more readable, and more idiomatic Go.

**Depends on**: Plan 01 (reducing to single generic) and Plan 04 (replacing factories with funcs)
for the cleanest result, but can be done independently.
