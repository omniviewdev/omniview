# 03: Unify Resourcer and DynamicResourcer Interfaces

## Pain Point

The SDK maintains two nearly identical interfaces for resource operations:

### Current Code (`resource/types/resourcer.go`)

```go
type Resourcer[ClientT any] interface {
    Get(ctx *plugin.PluginContext, client *ClientT, input GetInput) (*GetResult, error)
    List(ctx *plugin.PluginContext, client *ClientT, input ListInput) (*ListResult, error)
    Find(ctx *plugin.PluginContext, client *ClientT, input FindInput) (*FindResult, error)
    Create(ctx *plugin.PluginContext, client *ClientT, input CreateInput) (*CreateResult, error)
    Update(ctx *plugin.PluginContext, client *ClientT, input UpdateInput) (*UpdateResult, error)
    Delete(ctx *plugin.PluginContext, client *ClientT, input DeleteInput) (*DeleteResult, error)
}

type DynamicResourcer[ClientT any] interface {
    Get(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input GetInput) (*GetResult, error)
    List(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input ListInput) (*ListResult, error)
    Find(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input FindInput) (*FindResult, error)
    Create(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input CreateInput) (*CreateResult, error)
    Update(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input UpdateInput) (*UpdateResult, error)
    Delete(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input DeleteInput) (*DeleteResult, error)
}
```

The **only difference** is that `DynamicResourcer` accepts a `ResourceMeta` parameter. This
causes a cascade of complexity:

1. **`ResourcerManager`** maintains two separate stores (`store` and `dynamicResourcers`)
2. **`ResourceController`** has two retrieval methods (`retrieveClientResourcer` and
   `retrieveDynamicClientResourcer`) and every CRUD method branches on which one was found
3. **Registration** requires two separate maps in `ResourcePluginOpts`
4. **The controller** has a `useDynamic` bool that controls which code path runs

### How They're Actually Used

**Static resourcers** (Kubernetes plugin, `resourcers/base.go`):
- `KubernetesResourcerBase[T]` - knows its GVR at construction time
- Ignores `ResourceMeta` because it was bound to a specific resource type at registration

**Dynamic resourcers** (Kubernetes plugin, `resourcers/dynamic_resourcer.go`):
- `KubernetesDynamicResourcer` - handles any unknown CRD
- Needs `ResourceMeta` to construct the API path at runtime

The `ResourceMeta` is **always available** to the controller (it's parsed from the `resource`
string). Static resourcers just don't use it.

---

## Options

### Option A: Single Interface with ResourceMeta on Every Method (Recommended)

**Approach**: Merge into one interface. All resourcers receive `ResourceMeta`. Static
resourcers simply ignore it.

```go
type Resourcer[ClientT any] interface {
    Get(ctx *PluginContext, client *ClientT, meta ResourceMeta, input GetInput) (*GetResult, error)
    List(ctx *PluginContext, client *ClientT, meta ResourceMeta, input ListInput) (*ListResult, error)
    Find(ctx *PluginContext, client *ClientT, meta ResourceMeta, input FindInput) (*FindResult, error)
    Create(ctx *PluginContext, client *ClientT, meta ResourceMeta, input CreateInput) (*CreateResult, error)
    Update(ctx *PluginContext, client *ClientT, meta ResourceMeta, input UpdateInput) (*UpdateResult, error)
    Delete(ctx *PluginContext, client *ClientT, meta ResourceMeta, input DeleteInput) (*DeleteResult, error)
}
```

**Impact on static resourcers (Kubernetes `KubernetesResourcerBase`):**

Before:
```go
func (r *KubernetesResourcerBase[T]) Get(
    ctx *plugin.PluginContext, client *clients.ClientSet, input types.GetInput,
) (*types.GetResult, error) {
```

After:
```go
func (r *KubernetesResourcerBase[T]) Get(
    ctx *plugin.PluginContext, client *clients.ClientSet, _ types.ResourceMeta, input types.GetInput,
) (*types.GetResult, error) {
```

One `_` parameter added. The GVR is already stored on the struct.

**Impact on ResourcerManager:**

Before (two stores, two retrieval methods):
```go
type resourcerManager[ClientT any] struct {
    store             map[string]Resourcer[ClientT]
    dynamicResourcers map[string]DynamicResourcer[ClientT]
}
```

After (single store with pattern matching):
```go
type resourcerManager[ClientT any] struct {
    exact   map[string]Resourcer[ClientT]       // exact-match resourcers
    pattern []patternEntry[ClientT]              // wildcard-pattern resourcers
}

type patternEntry[ClientT any] struct {
    pattern  *regexp.Regexp
    handler  Resourcer[ClientT]
}

func (r *resourcerManager[ClientT]) GetResourcer(resourceType string) (Resourcer[ClientT], error) {
    // 1. Try exact match
    if resourcer, ok := r.exact[resourceType]; ok {
        return resourcer, nil
    }
    // 2. Try pattern match
    for _, entry := range r.pattern {
        if entry.pattern.MatchString(resourceType) {
            return entry.handler, nil
        }
    }
    return nil, fmt.Errorf("no resourcer for %s", resourceType)
}
```

**Impact on ResourceController CRUD methods:**

Before (~50 lines per method with static/dynamic branching):
```go
func (c *resourceController[...]) Get(...) {
    // ... 20 lines of static/dynamic resolution
    if useDynamic {
        result, err = dynamicResourcer.Get(ctx, client, meta, input)
    } else {
        result, err = resourcer.Get(ctx, client, input)
    }
}
```

After (~10 lines per method):
```go
func (c *resourceController[ClientT]) Get(
    ctx *pkgtypes.PluginContext, resource string, input types.GetInput,
) (*types.GetResult, error) {
    client, resourcer, err := c.resolve(ctx, resource)
    if err != nil {
        return nil, err
    }
    return resourcer.Get(ctx, client, types.ResourceMetaFromString(resource), input)
}
```

**Impact on registration (`ResourcePluginOpts`):**

Before (two maps):
```go
Resourcers:        map[types.ResourceMeta]types.Resourcer[ClientT]{...},
DynamicResourcers: map[string]types.DynamicResourcer[ClientT]{"*": ...},
```

After (single map with pattern keys):
```go
Resourcers: map[string]types.Resourcer[ClientT]{
    "core::v1::Pod":        resourcers.NewKubernetesResourcerBase[...](...),
    "apps::v1::Deployment": resourcers.NewKubernetesResourcerBase[...](...),
    // ...
    "*":                    resourcers.NewKubernetesDynamicResourcer(logger),
},
```

Or keep the `ResourceMeta`-keyed map for explicit types and a separate `PatternResourcers` field:
```go
Resourcers:        map[ResourceMeta]Resourcer[ClientT]{...},    // exact match
PatternResourcers: map[string]Resourcer[ClientT]{"*": dynResourcer}, // wildcard fallback
```

**Pros:**
- One interface instead of two
- One store instead of two
- No branching in controller CRUD methods
- `ResourceMeta` is always available - no information is lost
- Static resourcers add a single `_` parameter

**Cons:**
- Static resourcers have an unused `meta` parameter (minor)
- Existing plugin code needs a signature update (mechanical change)

---

### Option B: Adapter Pattern - Wrap Static into Dynamic

**Approach**: Keep both interfaces internally but expose only `DynamicResourcer` at the
controller level. Provide an adapter that wraps `Resourcer` into `DynamicResourcer`.

```go
// staticAdapter wraps a Resourcer to satisfy DynamicResourcer by ignoring meta.
type staticAdapter[ClientT any] struct {
    inner Resourcer[ClientT]
}

func (a *staticAdapter[ClientT]) Get(
    ctx *PluginContext, client *ClientT, _ ResourceMeta, input GetInput,
) (*GetResult, error) {
    return a.inner.Get(ctx, client, input)
}
// ... same for List, Find, Create, Update, Delete
```

**Registration wraps automatically:**
```go
for meta, resourcer := range opts.GetResourcers() {
    manager.Register(meta.String(), &staticAdapter[ClientT]{inner: resourcer})
}
```

**Pros:**
- Existing `Resourcer` implementations don't change signature
- Controller only deals with one type

**Cons:**
- Still two interfaces in the SDK (more surface area to maintain)
- Extra allocation per resourcer (one wrapper struct each)
- Plugin authors may be confused about which interface to implement
- The adapter just adds a layer to avoid changing a parameter list

**Acceptable but less clean than Option A.**

---

### Option C: ResourceMeta on the PluginContext

**Approach**: Instead of passing `ResourceMeta` as a parameter, attach it to the `PluginContext`
(which already has a `ResourceContext` field). Then both interfaces become identical.

```go
type Resourcer[ClientT any] interface {
    Get(ctx *PluginContext, client *ClientT, input GetInput) (*GetResult, error)
    // ...
}
```

The controller sets `ctx.ResourceContext` before calling the resourcer, and dynamic
resourcers read it from the context.

**Pros:**
- No signature change to existing `Resourcer` implementations
- Dynamic resourcers read from context instead of parameter

**Cons:**
- Makes `ResourceMeta` implicit (hidden in context) instead of explicit (in signature)
- Harder to reason about what data a resourcer receives
- Easy to forget to set it, causing nil-pointer bugs
- Violates "explicit is better than implicit" principle

**Not recommended** - hides information that should be visible.

---

## Recommendation

**Option A** is the cleanest solution. Adding a `_ ResourceMeta` parameter to static resourcers
is a trivial mechanical change (the code generator already handles the Kubernetes plugin's 150+
resourcers). The payoff is eliminating the entire dual-interface, dual-store, dual-dispatch
architecture.

**This should be done before Plan 02** (controller CRUD deduplication), as it makes the
controller methods trivially simple.
