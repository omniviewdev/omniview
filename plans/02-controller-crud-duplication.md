# 02: Controller CRUD Method Duplication

## Pain Point

All six CRUD methods in `ResourceController` (`Get`, `List`, `Find`, `Create`, `Update`, `Delete`)
contain **identical control flow** for resolving a resourcer and dispatching to it. The controller
itself has a `TODO` comment acknowledging this (`controller.go:144`):

```go
// TODO - combine the common logic for the operations here, lots of repetativeness
```

### Current Code

Every method follows this exact pattern (shown for `Get`, repeated identically for all 6):

```go
func (c *resourceController[ClientT, InformerT]) Get(
    ctx *pkgtypes.PluginContext,
    resource string,
    input types.GetInput,
) (*types.GetResult, error) {
    var (
        useDynamic       bool
        client           *ClientT
        resourcer        types.Resourcer[ClientT]
        dynamicResourcer types.DynamicResourcer[ClientT]
        result           *types.GetResult
        err              error
    )

    hasDynamic := c.resourcerManager.HasDynamicResourcers()

    client, resourcer, err = c.retrieveClientResourcer(ctx, resource)
    if err != nil && !hasDynamic {
        return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
    }

    if err != nil && hasDynamic {
        client, dynamicResourcer, err = c.retrieveDynamicClientResourcer(ctx, resource)
        if err != nil {
            return nil, fmt.Errorf("unable to retrieve dynamic client and resourcer: %w", err)
        }
        useDynamic = true
    }

    if useDynamic {
        result, err = dynamicResourcer.Get(ctx, client, types.ResourceMetaFromString(resource), input)
    } else {
        result, err = resourcer.Get(ctx, client, input)
    }

    if err != nil {
        return nil, err
    }
    return result, nil
}
```

This is **~50 lines repeated 6 times** = ~300 lines of near-identical code. The only differences
between methods are:
1. The input type (`GetInput`, `ListInput`, etc.)
2. The result type (`*GetResult`, `*ListResult`, etc.)
3. The method name called on the resourcer (`.Get()`, `.List()`, etc.)

---

## Options

### Option A: Generic Dispatch Helper Function (Recommended)

**Approach**: Write a single generic dispatch function that captures the resolution and fallback
logic once. Each CRUD method becomes a one-liner that calls the dispatcher with the appropriate
method references.

```go
// dispatchOp resolves the resourcer (static or dynamic) and executes the operation.
func dispatchOp[ClientT, InformerT, Input, Result any](
    c *resourceController[ClientT, InformerT],
    ctx *pkgtypes.PluginContext,
    resource string,
    input Input,
    staticFn func(types.Resourcer[ClientT], *pkgtypes.PluginContext, *ClientT, Input) (Result, error),
    dynamicFn func(types.DynamicResourcer[ClientT], *pkgtypes.PluginContext, *ClientT, types.ResourceMeta, Input) (Result, error),
) (Result, error) {
    var zero Result

    hasDynamic := c.resourcerManager.HasDynamicResourcers()

    client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
    if err != nil && !hasDynamic {
        return zero, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
    }

    if err == nil {
        return staticFn(resourcer, ctx, client, input)
    }

    // Static failed, try dynamic
    client, dynamicResourcer, err := c.retrieveDynamicClientResourcer(ctx, resource)
    if err != nil {
        return zero, fmt.Errorf("unable to retrieve dynamic client and resourcer: %w", err)
    }

    return dynamicFn(dynamicResourcer, ctx, client, types.ResourceMetaFromString(resource), input)
}
```

Each method becomes:
```go
func (c *resourceController[ClientT, InformerT]) Get(
    ctx *pkgtypes.PluginContext,
    resource string,
    input types.GetInput,
) (*types.GetResult, error) {
    return dispatchOp(c, ctx, resource, input,
        func(r types.Resourcer[ClientT], ctx *pkgtypes.PluginContext, client *ClientT, in types.GetInput) (*types.GetResult, error) {
            return r.Get(ctx, client, in)
        },
        func(r types.DynamicResourcer[ClientT], ctx *pkgtypes.PluginContext, client *ClientT, meta types.ResourceMeta, in types.GetInput) (*types.GetResult, error) {
            return r.Get(ctx, client, meta, in)
        },
    )
}
```

**Pros:**
- Resolution and fallback logic written once
- Each method is 10 lines instead of 50
- Easy to add cross-cutting concerns (logging, metrics, tracing) in one place
- Type-safe - Go generics enforce input/result types at compile time

**Cons:**
- The closures for method references add some verbosity
- Slightly harder to set breakpoints on a specific operation's dispatch path

**If [Plan 03] unifies Resourcer/DynamicResourcer first**, this simplifies further because
there's no static/dynamic fork at all - each method just becomes:
```go
func (c *resourceController[ClientT]) Get(
    ctx *pkgtypes.PluginContext, resource string, input types.GetInput,
) (*types.GetResult, error) {
    client, resourcer, err := c.resolveResourcer(ctx, resource)
    if err != nil {
        return nil, err
    }
    return resourcer.Get(ctx, client, types.ResourceMetaFromString(resource), input)
}
```

---

### Option B: Method-Value Table Dispatch

**Approach**: Create a table of operation handlers indexed by `OperationType`, and dispatch
through a single `execute` method.

```go
type operationHandler[ClientT any] struct {
    static  func(types.Resourcer[ClientT], *pkgtypes.PluginContext, *ClientT, any) (any, error)
    dynamic func(types.DynamicResourcer[ClientT], *pkgtypes.PluginContext, *ClientT, types.ResourceMeta, any) (any, error)
}

// execute resolves resourcer and dispatches
func (c *resourceController[ClientT, InformerT]) execute(
    ctx *pkgtypes.PluginContext,
    resource string,
    input any,
    handler operationHandler[ClientT],
) (any, error) { ... }
```

Public methods become:
```go
func (c *resourceController[ClientT, InformerT]) Get(
    ctx *pkgtypes.PluginContext, resource string, input types.GetInput,
) (*types.GetResult, error) {
    result, err := c.execute(ctx, resource, input, c.handlers[OperationTypeGet])
    if err != nil {
        return nil, err
    }
    return result.(*types.GetResult), nil
}
```

**Pros:**
- Single dispatch path for all operations
- Easy to add middleware/hooks per operation type

**Cons:**
- Loses type safety (uses `any` and type assertions)
- Runtime assertion failures are possible
- More complex than Option A with no real benefit

**Not recommended** - trades compile-time safety for marginal reduction in code.

---

### Option C: Code Generation

**Approach**: Generate the 6 methods from a template, similar to how `register_gen.go` is
generated for the Kubernetes plugin.

```go
//go:generate go run ./gen/controller_ops.go
```

**Pros:**
- Zero runtime overhead
- Methods look "normal" in generated code

**Cons:**
- Adds a code generation step to the SDK itself
- Generated code still has duplication (just authored differently)
- Harder to modify logic - need to edit template, regenerate, review
- Overkill for 6 methods

**Not recommended** - the duplication is small enough that a generic helper (Option A) is simpler.

---

## Recommendation

**Option A** is the clear winner. The dispatch helper is straightforward, type-safe, and
eliminates ~250 lines of duplicate code. If combined with Plan 03 (unified resourcer interface),
the dispatch becomes even simpler since there's no static/dynamic fork.

**Implementation order**: Do Plan 03 first, then this becomes trivial.
