# 07: Plugin Context gRPC Propagation

## Pain Point

The `PluginContext` is serialized to JSON and passed via gRPC metadata using a magic string key.
This approach is fragile, loses type safety, and has edge cases around non-serializable fields.

### Current Code

**Context type** (`types/context.go`):
```go
type PluginContext struct {
    Context        context.Context   // Not serialized (context.Context can't be JSON-marshaled)
    RequestOptions *RequestOptions
    Connection     *Connection
    ResourceContext *ResourceContext
    PluginConfig   settings.Provider // Not serialized (interface)
    GlobalConfig   *config.GlobalConfig
    RequestID      string
    RequesterID    string
}
```

**Serialization** (`types/context.go`):
```go
func SerializePluginContext(ctx *PluginContext) (string, error) {
    // marshals to JSON string
}

func DeserializePluginContext(data string) (*PluginContext, error) {
    // unmarshals from JSON string
}
```

**Client interceptor** (`sdk/grpc.go:59`):
```go
func UseClientPluginContext(ctx context.Context) (context.Context, error) {
    pc := types.PluginContextFromContext(ctx)
    serialized, err := types.SerializePluginContext(pc)
    md := metadata.MD(grpcMetadata.Pairs(PluginContextMDKey, serialized))
    return md.ToOutgoing(ctx), nil
}
```

**Server interceptor** (`sdk/grpc.go:23`):
```go
func UseServerPluginContext(ctx context.Context) (context.Context, error) {
    incoming := metadata.ExtractIncoming(ctx)
    serialized := incoming.Get(PluginContextMDKey)
    deserialized, err := types.DeserializePluginContext(serialized)
    return types.WithPluginContext(ctx, deserialized), nil
}
```

**Magic string** (`sdk/grpc.go:16`):
```go
const PluginContextMDKey = "plugin_context"
```

### The Problems

1. **Non-serializable fields silently dropped**: `PluginConfig` (settings.Provider) and
   `Context` (context.Context) cannot be JSON-marshaled. After deserialization, the plugin-side
   PluginContext has `nil` for these fields. The controller works around this with
   `ctx.SetSettingsProvider(c.settingsProvider)` on every method call.

2. **Magic string key**: `"plugin_context"` is defined in two places (sdk/grpc.go and
   utils/grpc.go) with no compile-time link between them.

3. **JSON overhead**: The entire context (including Connection with all its data/labels maps)
   is serialized on every gRPC call. For high-frequency operations like List, this adds
   latency.

4. **Duplicate interceptor code**: `UseServerPluginContext` and `ServerPluginContextInterceptor`
   exist in both `sdk/grpc.go` and `utils/grpc.go` with slightly different implementations.

5. **Error handling is silent**: Both interceptors log errors but continue execution, meaning
   the server may receive a context without plugin data and fail later with a confusing error.

---

## Options

### Option A: Use Protobuf Message for Context, Pass as Request Field (Recommended)

**Approach**: Define a protobuf message for the plugin context and include it as a field in
every request message. This makes context explicit, type-safe, and visible in the proto
definition.

**Proto definition:**
```proto
message PluginRequestContext {
    string request_id = 1;
    string requester_id = 2;
    string connection_id = 3;
    string resource_key = 4;
    RequestOptions request_options = 5;
    map<string, string> connection_data = 6;
    map<string, string> connection_labels = 7;
}

message GetRequest {
    PluginRequestContext context = 1;
    string id = 2;
    string namespace = 3;
    map<string, string> params = 4;
}
```

**Server side reconstructs PluginContext:**
```go
func (s *ResourcePluginServer) Get(ctx context.Context, req *proto.GetRequest) (*proto.GetResponse, error) {
    pluginCtx := contextFromProto(ctx, req.Context, s.settingsProvider)
    return s.Impl.Get(pluginCtx, req.ResourceKey, convertGetInput(req))
}
```

**Client side populates from PluginContext:**
```go
func (c *ResourcePluginClient) Get(ctx *types.PluginContext, key string, input types.GetInput) (*types.GetResult, error) {
    resp, err := c.client.Get(ctx.Context, &proto.GetRequest{
        Context:   contextToProto(ctx),
        Id:        input.ID,
        Namespace: input.Namespace,
    })
    // ...
}
```

**What gets deleted:**
- JSON serialization/deserialization of PluginContext
- gRPC metadata interceptors for context propagation
- Magic string constants
- Duplicate interceptor implementations

**Pros:**
- Type-safe: proto compiler validates context structure
- No magic strings
- No silent field dropping (non-serializable fields are explicitly excluded)
- No JSON overhead (protobuf binary encoding is faster)
- Context fields visible in proto definition (self-documenting)
- No interceptor needed - context is a regular request field
- Each request carries only the fields it needs

**Cons:**
- Requires updating all proto request messages to include context field
- More explicit wiring in server/client implementations
- Proto changes require regeneration

---

### Option B: Keep Metadata Approach but Use Protobuf Binary

**Approach**: Still pass context via gRPC metadata, but use protobuf binary encoding instead
of JSON, and define the context as a proto message.

```proto
message PluginRequestContext {
    string request_id = 1;
    string requester_id = 2;
    string connection_id = 3;
    // ...
}
```

```go
func UseClientPluginContext(ctx context.Context) (context.Context, error) {
    pc := types.PluginContextFromContext(ctx)
    data, err := proto.Marshal(contextToProto(pc))
    encoded := base64.StdEncoding.EncodeToString(data)
    md := grpcMetadata.Pairs(PluginContextMDKey, encoded)
    return grpcMetadata.NewOutgoingContext(ctx, md), nil
}
```

**Pros:**
- Smaller serialization overhead
- Type-safe via proto definition
- Less invasive than Option A (metadata approach preserved)

**Cons:**
- Still uses metadata (hidden channel, not visible in request)
- Still needs interceptors
- Base64 encoding adds overhead
- gRPC metadata has size limits
- Doesn't fix the silent error handling issue

**Marginal improvement over current approach.**

---

### Option C: Pass Only Connection ID, Resolve Server-Side

**Approach**: Instead of passing the full context, pass just the `connection_id` and
`resource_key` as individual gRPC metadata entries or request fields. The plugin server
resolves the full context from its own state.

```go
// Client sends minimal context
md := grpcMetadata.Pairs(
    "connection_id", ctx.Connection.ID,
    "resource_key", ctx.ResourceContext.Key,
    "request_id", ctx.RequestID,
)
```

Server resolves:
```go
func (s *ResourcePluginServer) Get(ctx context.Context, req *proto.GetRequest) (*proto.GetResponse, error) {
    connID := metadata.ExtractIncoming(ctx).Get("connection_id")
    pluginCtx := s.buildContext(ctx, connID, req.ResourceKey)
    return s.Impl.Get(pluginCtx, req.ResourceKey, ...)
}
```

**Pros:**
- Minimal data over the wire
- No serialization of complex objects
- Connection data stays server-side (no sync issues)

**Cons:**
- Server must maintain state that maps connection IDs to connections
  (it already does this via ConnectionManager)
- Subtle: host-side connection updates won't be visible to plugin
  until next sync
- Requires refactoring how Connection data flows

**Good for performance, but changes the data flow model.**

---

### Option D: Typed Context Fields in gRPC Metadata

**Approach**: Instead of one serialized blob, pass each context field as a separate metadata
entry with typed keys.

```go
var (
    MDKeyConnectionID = "x-omniview-connection-id"
    MDKeyResourceKey  = "x-omniview-resource-key"
    MDKeyRequestID    = "x-omniview-request-id"
    MDKeyRequesterID  = "x-omniview-requester-id"
)
```

**Pros:**
- No serialization needed for simple string fields
- Each field independently accessible
- Grep-able metadata keys

**Cons:**
- Complex fields (Connection.Data map) still need serialization
- Proliferation of metadata keys
- Still uses the hidden metadata channel
- Doesn't solve the core issue of non-serializable fields

**Not recommended** - doesn't address the fundamental problems.

---

## Recommendation

**Option A** is the most principled solution. Making the context a proto field on each request
is explicit, type-safe, and eliminates the entire interceptor + serialization machinery.

However, this is a **larger refactor** that touches every proto message and both client/server
implementations. If doing all plans, this should be done **last** since it's the lowest priority
and highest effort. Options C (minimal context) is a good middle ground if full proto refactoring
isn't feasible.

**Priority: Low-Medium** - the current approach works, it's just not ideal.
