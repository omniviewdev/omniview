# 06: Split ResourceProvider Mega-Interface

## Pain Point

`ResourceProvider` composes 5 sub-interfaces into a single interface with 20+ methods. Every
consumer must accept the full interface even when they only need a subset.

### Current Code (`resource/types/providers.go`)

```go
type ResourceProvider interface {
    ResourceTypeProvider       // 6 methods: GetResourceGroups, GetResourceGroup, GetResourceTypes, GetResourceType, HasResourceType, GetResourceDefinition
    ResourceConnectionProvider // 9 methods: StartConnection, StopConnection, LoadConnections, ListConnections, GetConnection, GetConnectionNamespaces, UpdateConnection, DeleteConnection, WatchConnections
    ResourceInformerProvider   // 4 methods: StartConnectionInformer, StopConnectionInformer, ListenForEvents, HasInformer
    ResourceLayoutProvider     // 3 methods: GetLayout, SetLayout, GetDefaultLayout
    ResourceOperationProvider  // 6 methods: Get, List, Find, Create, Update, Delete
}
```

### Where It's Used

1. **`ResourceController` returns it** (`controller.go:28`):
   ```go
   func NewResourceController[...](...)  types.ResourceProvider {
       // ...
       return controller
   }
   ```

2. **`ResourcePlugin` (gRPC glue) holds it** (`plugin/resource_server.go`):
   ```go
   type ResourcePluginServer struct {
       Impl types.ResourceProvider
   }
   ```

3. **`resource_client.go`** (gRPC client) implements it for the host side.

### The Problem

- The **gRPC server** (`ResourcePluginServer`) genuinely needs the full interface because it
  dispatches all RPCs to the controller.
- But **host-side controllers** (`backend/pkg/plugin/resource/controller.go`) only call specific
  subsets. The resource listing UI doesn't need connection management. The connection UI
  doesn't need CRUD operations.
- **Testing** is harder because mocking `ResourceProvider` means implementing 28 methods.
- **New capability additions** force all implementors to add methods even if irrelevant.

---

## Options

### Option A: Keep Composed Interface, Accept Sub-Interfaces at Call Sites (Recommended)

**Approach**: The sub-interfaces already exist. Don't change `ResourceProvider` (it's correct
for the gRPC boundary), but use sub-interfaces in internal code where only a subset is needed.

The interfaces are already defined and usable:
```go
// These already exist:
type ResourceTypeProvider interface { ... }
type ResourceConnectionProvider interface { ... }
type ResourceInformerProvider interface { ... }
type ResourceLayoutProvider interface { ... }
type ResourceOperationProvider interface { ... }
```

**Change host-side code to accept narrower interfaces:**

Before (in `backend/pkg/plugin/resource/controller.go`):
```go
type controller struct {
    clients map[string]types.ResourceProvider  // full interface
}
```

After:
```go
// The gRPC client still implements ResourceProvider.
// But internal code can use narrower types where appropriate.
func (c *controller) listResources(provider types.ResourceOperationProvider, ...) { ... }
func (c *controller) manageConnections(provider types.ResourceConnectionProvider, ...) { ... }
```

**For testing, mock only what you need:**
```go
type mockOps struct{}
func (m *mockOps) Get(...) (*GetResult, error) { ... }
func (m *mockOps) List(...) (*ListResult, error) { ... }
// Only 6 methods instead of 28
```

**Pros:**
- No breaking changes - `ResourceProvider` still exists
- Sub-interfaces already exist, just need to be used more
- Better test mocking
- Follows Go's "accept interfaces, return structs" principle
- Gradual adoption - change one call site at a time

**Cons:**
- Requires discipline to use narrow interfaces instead of the full one
- May feel inconsistent during transition

---

### Option B: Remove ResourceProvider, Use Only Sub-Interfaces

**Approach**: Delete the composed `ResourceProvider` interface entirely. Every consumer declares
exactly which sub-interfaces it needs.

```go
// Delete this:
// type ResourceProvider interface {
//     ResourceTypeProvider
//     ResourceConnectionProvider
//     ...
// }
```

The gRPC server declares its own composed type:
```go
type ResourcePluginServer struct {
    Types       ResourceTypeProvider
    Connections ResourceConnectionProvider
    Operations  ResourceOperationProvider
    Informers   ResourceInformerProvider
    Layouts     ResourceLayoutProvider
}
```

Or uses an ad-hoc composition:
```go
type fullProvider interface {
    ResourceTypeProvider
    ResourceConnectionProvider
    ResourceInformerProvider
    ResourceLayoutProvider
    ResourceOperationProvider
}

type ResourcePluginServer struct {
    Impl fullProvider
}
```

**Pros:**
- Forces every consumer to declare minimum requirements
- No single mega-interface in the codebase

**Cons:**
- The gRPC server genuinely needs all capabilities, so it just re-declares the same composition
- More churn for minimal benefit over Option A
- Every caller that currently accepts `ResourceProvider` needs to be updated

**Marginal improvement over Option A with more work.**

---

### Option C: Capability-Based Provider with Type Assertions

**Approach**: Define a base provider interface with just the required methods, and let consumers
check for optional capabilities via type assertion.

```go
type ResourceProvider interface {
    ResourceTypeProvider
    ResourceOperationProvider
}

type Connectable interface {
    ResourceConnectionProvider
}

type Informable interface {
    ResourceInformerProvider
}
```

Consumers check:
```go
if connectable, ok := provider.(Informable); ok {
    connectable.StartConnectionInformer(...)
}
```

**Pros:**
- Clear distinction between required and optional capabilities
- Plugins that don't support informers don't need to implement no-op methods

**Cons:**
- Runtime type assertions are fragile
- Plugin authors can't tell at compile time what they need to implement
- gRPC server still needs all methods for the protobuf service
- Adds complexity without much benefit since all current plugins support all capabilities

**Not recommended** - the current plugins are full-capability, and the gRPC proto already
defines all methods.

---

### Option D: Separate gRPC Services per Capability

**Approach**: Instead of one `ResourcePlugin` gRPC service with 28 RPCs, split into separate
gRPC services that can be independently dispensed.

```proto
service ResourceTypeService {
    rpc GetResourceGroups(...) returns (...);
    rpc GetResourceType(...) returns (...);
    // ...
}

service ResourceConnectionService {
    rpc StartConnection(...) returns (...);
    rpc StopConnection(...) returns (...);
    // ...
}

service ResourceOperationService {
    rpc Get(...) returns (...);
    rpc List(...) returns (...);
    // ...
}
```

**Pros:**
- Each service is independently dispensable
- Cleaner separation of concerns
- Plugins can implement only the services they support

**Cons:**
- Significant proto/gRPC refactor
- Multiple gRPC dispensing round-trips
- The current HashiCorp plugin system maps one capability to one plugin
- Over-engineering for the current scale of the system
- Breaks backward compatibility with existing plugins

**Not recommended for now** - too much churn for marginal benefit. Could be revisited if the
plugin ecosystem grows significantly.

---

## Recommendation

**Option A** is the pragmatic choice. The sub-interfaces already exist and are well-defined.
The only change is to prefer them in host-side code instead of always reaching for
`ResourceProvider`. This is a gradual, non-breaking improvement that makes testing easier and
call sites more explicit about their dependencies.

**Low priority** - this is a code quality improvement, not a structural simplification.
