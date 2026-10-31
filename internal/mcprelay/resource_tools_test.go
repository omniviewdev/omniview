package mcprelay

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

type generatedNativeSource struct {
	epoch, revision           string
	pages, mutations, queries int
	pageSize                  uint32
	scopeDiscovery            bool
	scopeCalls                int
	integerInputs             bool
	actions                   bool
	actionCalls               int
	expectedAction            *resourcev2.ActionDescriptor
}

func (source *generatedNativeSource) Catalog(_ context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
	revision, err := resourcev2.BindCatalogRevision(source.epoch, source.revision)
	if err != nil {
		return resourcev2.Catalog{}, err
	}
	capabilities := []resourcev2.Capability{{Operation: resourcev2.OperationDelete, Scope: resourcev2.QueryScope{}}}
	if request.Route.Connection == "route-a" {
		capabilities = append(capabilities, resourcev2.Capability{Operation: resourcev2.OperationEnumerate, Scope: resourcev2.QueryScope{}}, resourcev2.Capability{Operation: resourcev2.OperationNativeQuery, Scope: resourcev2.QueryScope{}})
	}
	descriptor := resourcev2.ResourceType{Type: "opaque/items", DisplayName: "Items", IdentityDimensions: []resourcev2.Dimension{}, QueryDimensions: []resourcev2.Dimension{}, Representations: []resourcev2.Representation{generatedRepresentation()}, DefaultRepresentation: "native", ModelRepresentation: "native", Capabilities: capabilities}
	if request.Route.Connection == "route-a" {
		descriptor.NativeQueries = []resourcev2.NativeQueryDescriptor{{Language: "fixture.filter.v1", InputSchema: resourcev2.Schema{Properties: map[string]resourcev2.SchemaProperty{"selector": {Type: resourcev2.SchemaString}}, Required: []string{"selector"}}}}
	}
	if request.Route.Connection == "route-b" {
		descriptor.DefaultRepresentation = ""
		descriptor.ModelRepresentation = ""
	}
	if source.scopeDiscovery {
		descriptor.QueryDimensions = []resourcev2.Dimension{{Name: "namespace"}, {Name: "unsupported"}}
		for index := range descriptor.Capabilities {
			descriptor.Capabilities[index].Scope = resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, {Dimension: "unsupported", Match: resourcev2.ScopeAny}}
		}
	}
	if source.integerInputs && len(descriptor.NativeQueries) > 0 {
		descriptor.NativeQueries[0].InputSchema.Properties["selector"] = resourcev2.SchemaProperty{Type: resourcev2.SchemaInteger}
	}
	if source.actions {
		descriptor.Capabilities = append(descriptor.Capabilities, resourcev2.Capability{Operation: resourcev2.OperationAction, Scope: resourcev2.QueryScope{}})
	}
	return resourcev2.Catalog{Provider: "fixture-native", Revision: revision, Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}, Types: []resourcev2.ResourceType{descriptor}}, nil
}
func generatedRepresentation() resourcev2.Representation {
	return resourcev2.Representation{ID: "native", Revision: "one", Schema: resourcev2.SchemaBinding{State: "absent", Validation: "none", Unvalidated: []string{}}}
}
func generatedRecord(target resourcev2.ReadTarget, id string) resourcev2.Record {
	return resourcev2.Record{Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: id, Scope: []resourcev2.ScopeEntry{}}}, Body: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"uint": {Kind: "uint64", Uint: "18446744073709551615"}, "int": {Kind: "int64", Int: "-9223372036854775808"}, "time": {Kind: "timestamp", Timestamp: "2026-10-30T12:00:00.123456789Z"}, "zero": {Kind: "double", Double: math.Copysign(0, -1)}}}, Representation: generatedRepresentation(), Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}}
}
func (source *generatedNativeSource) Enumerate(ctx context.Context, request resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
	source.pages++
	source.pageSize = request.PageSize
	catalog, err := source.Catalog(ctx, resourcev2.CatalogRequest{Route: request.Target.Route})
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	if err := resourcev2.CheckCatalogRevision(ctx, catalog); err != nil {
		return resourcev2.SourcePage{}, err
	}
	start := 0
	if request.Cursor != nil {
		start, err = strconv.Atoi(*request.Cursor)
		if err != nil {
			return resourcev2.SourcePage{}, err
		}
	}
	end := start + int(request.PageSize)
	if end > 700 {
		end = 700
	}
	records := make([]resourcev2.Record, 0, end-start)
	for index := start; index < end; index++ {
		records = append(records, generatedRecord(request.Target, fmt.Sprint(index)))
	}
	var next *string
	if end < 700 {
		value := strconv.Itoa(end)
		next = &value
	}
	revision := "content-one"
	return resourcev2.SourcePage{Records: records, NextCursor: next, Count: resourcev2.Count{Kind: "unknown"}, Coverage: resourcev2.Coverage{Kind: "partial", Paths: []string{}, Reason: "Native source page only."}, Consistency: "bestEffort", SourceRevision: &revision}, nil
}
func (source *generatedNativeSource) NativeQuery(ctx context.Context, request resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
	source.queries++
	return source.Enumerate(ctx, resourcev2.EnumerateRequest{Target: request.Target, PageSize: request.PageSize, Cursor: request.Cursor})
}
func (source *generatedNativeSource) Mutate(_ context.Context, request resourcev2.MutationRequest) (resourcev2.Record, error) {
	source.mutations++
	return generatedRecord(resourcev2.ReadTarget{Route: request.Route, Provider: request.Reference.Address.Provider, Authority: request.Reference.Address.Authority, Type: request.Reference.Address.Type}, request.Reference.Address.ID), nil
}
func generatedController(t *testing.T) (resource.Controller, *generatedNativeSource) {
	t.Helper()
	state := appstate.NewTestService(t)
	epoch, err := resourcev2.NewCatalogBindingEpoch()
	require.NoError(t, err)
	source := &generatedNativeSource{epoch: epoch, revision: "one"}
	ctrl := resource.NewController(logging.NewNop(), nil, state.PluginStore, invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error { return nil })))
	ctrl.Run(context.Background())
	require.NoError(t, ctrl.OnPluginStart("fixture", config.PluginMeta{}, plugintypes.NewInProcessBackend(map[string]interface{}{"resource": source})))
	t.Cleanup(func() {
		require.NoError(t, ctrl.OnPluginStop("fixture", config.PluginMeta{}))
		require.NoError(t, ctrl.(interface{ ServiceShutdown() error }).ServiceShutdown())
	})
	return ctrl, source
}
func generatedTools(t *testing.T, ctrl resource.Service) []ToolInfo {
	t.Helper()
	tools, err := BuildResourceCatalog(invocation.HostContext(context.Background()), ctrl, []ResourceRoute{{PluginID: "fixture", Route: resourcev2.AccessRoute{Connection: "route-a"}}, {PluginID: "fixture", Route: resourcev2.AccessRoute{Connection: "route-b"}}})
	require.NoError(t, err)
	return tools
}
func findGenerated(t *testing.T, tools []ToolInfo, route, operation string) ToolInfo {
	t.Helper()
	for _, tool := range tools {
		if tool.Resource.Route.Connection == route && tool.Resource.Operation == operation {
			return tool
		}
	}
	t.Fatalf("missing %s on %s", operation, route)
	return ToolInfo{}
}

func TestGeneratedResourcesActualAdmissionAndContinuation(t *testing.T) {
	ctrl, source := generatedController(t)
	tools := generatedTools(t, ctrl)
	list := findGenerated(t, tools, "route-a", "resource.Enumerate")
	value, err := DispatchResource(invocation.HostContext(context.Background()), ctrl, list, json.RawMessage(`{"limit":500}`))
	require.NoError(t, err)
	first := value.(ResourceCollection)
	require.Len(t, first.Records, 500)
	require.True(t, first.Truncated)
	require.NotNil(t, first.Continuation)
	require.Equal(t, 2, source.pages)
	require.Equal(t, uint32(256), source.pageSize)
	require.Equal(t, "unknown", first.SourcePages[0].Count.Kind)
	require.Equal(t, "partial", first.SourcePages[0].Coverage.Kind)
	encoded, err := json.Marshal(first.Records[0])
	require.NoError(t, err)
	var record resource.HostRecord
	require.NoError(t, json.Unmarshal(encoded, &record))
	require.Equal(t, "18446744073709551615", record.Record.Body.Map["uint"].Uint)
	require.Equal(t, "-9223372036854775808", record.Record.Body.Map["int"].Int)
	require.True(t, math.Signbit(record.Record.Body.Map["zero"].Double))
	require.Equal(t, "2026-10-30T12:00:00.123456789Z", record.Record.Body.Map["time"].Timestamp)
	arguments, err := json.Marshal(map[string]any{"limit": 500, "cursor": *first.Continuation})
	require.NoError(t, err)
	value, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, list, arguments)
	require.NoError(t, err)
	second := value.(ResourceCollection)
	require.Len(t, second.Records, 200)
	require.False(t, second.Truncated)
	require.Nil(t, second.Continuation)
	require.Equal(t, "500", second.Records[0].Record.Reference.Address.ID)
	require.Equal(t, 3, source.pages)
}
func TestGeneratedDeleteOnlyRouteAndStaleAdvertisement(t *testing.T) {
	ctrl, source := generatedController(t)
	tools := generatedTools(t, ctrl)
	deleteTool := findGenerated(t, tools, "route-b", "resource.Mutate")
	for _, tool := range tools {
		if tool.Resource.Route.Connection == "route-b" {
			require.Equal(t, "resource.Mutate", tool.Resource.Operation)
		}
	}
	other := findGenerated(t, tools, "route-a", "resource.Mutate")
	require.NotEqual(t, other.MCPName, deleteTool.MCPName)
	require.NotEqual(t, other.InputSchema, deleteTool.InputSchema)
	reference := generatedRecord(deleteTool.Resource.Target, "real-native-id").Reference
	arguments, err := json.Marshal(map[string]any{"reference": reference, "input": resourcev2.Value{Kind: "null"}})
	require.NoError(t, err)
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, deleteTool, arguments)
	require.NoError(t, err)
	require.Equal(t, 1, source.mutations)
	require.Zero(t, source.pages)
	source.revision = "two"
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, deleteTool, arguments)
	require.Error(t, err)
	require.Equal(t, 1, source.mutations)
}
func TestGeneratedCursorRejectsChangedTargetQueryAndObservation(t *testing.T) {
	ctrl, source := generatedController(t)
	tools := generatedTools(t, ctrl)
	query := findGenerated(t, tools, "route-a", "resource.NativeQuery")
	value, err := DispatchResource(invocation.HostContext(context.Background()), ctrl, query, json.RawMessage(`{"limit":1,"query":{"kind":"map","value":{"selector":{"kind":"string","value":"first"}}}}`))
	require.NoError(t, err)
	first := value.(ResourceCollection)
	require.NotNil(t, first.Continuation)
	changed, err := json.Marshal(map[string]any{"cursor": *first.Continuation, "query": resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"selector": {Kind: "string", String: "second"}}}})
	require.NoError(t, err)
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, query, changed)
	require.Error(t, err)
	require.Equal(t, 1, source.queries)
	original, err := json.Marshal(map[string]any{"cursor": *first.Continuation, "query": resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"selector": {Kind: "string", String: "first"}}}})
	require.NoError(t, err)
	source.revision = "changed"
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, query, original)
	require.Error(t, err)
	require.Equal(t, 1, source.queries)
}
func TestResourceTupleNamesBoundedAndUnambiguous(t *testing.T) {
	first := resourceToolName("a_b", "c", "d", "get")
	second := resourceToolName("a", "b_c", "d", "get")
	require.NotEqual(t, first, second)
	require.LessOrEqual(t, len(first), 128)
	require.True(t, mcpToolNamePattern.MatchString(first))
}

func TestCanonicalResourceScalarsThroughRealMCPClient(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctrl, _ := generatedController(t)
	tool := findGenerated(t, generatedTools(t, ctrl), "route-a", "resource.Enumerate")
	server := mcp.NewServer(&mcp.Implementation{Name: "resource-regression", Version: "test"}, nil)
	server.AddTool(mcpTool(tool), func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var arguments map[string]json.RawMessage
		if err := json.Unmarshal(request.Params.Arguments, &arguments); err != nil {
			return nil, err
		}
		delete(arguments, "connection_id")
		raw, err := json.Marshal(arguments)
		if err != nil {
			return nil, err
		}
		value, err := DispatchResource(invocation.HostContext(ctx), ctrl, tool, raw)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{StructuredContent: json.RawMessage(encoded)}, nil
	})
	endpoint := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil))
	t.Cleanup(endpoint.Close)
	client := mcp.NewClient(&mcp.Implementation{Name: "scalar-consumer", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: endpoint.URL}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool.MCPName, Arguments: map[string]any{"connection_id": "route-a", "limit": 1}})
	require.NoError(t, err)
	require.False(t, result.IsError)
	root := result.StructuredContent.(map[string]any)
	records := root["records"].([]any)
	record := records[0].(map[string]any)["record"].(map[string]any)
	body := record["body"].(map[string]any)["value"].(map[string]any)
	require.Equal(t, "18446744073709551615", body["uint"].(map[string]any)["value"])
	require.Equal(t, "-9223372036854775808", body["int"].(map[string]any)["value"])
	require.Equal(t, "2026-10-30T12:00:00.123456789Z", body["time"].(map[string]any)["value"])
	require.True(t, math.Signbit(body["zero"].(map[string]any)["value"].(float64)))
}

func (source *generatedNativeSource) ScopeValues(ctx context.Context, route resourcev2.AccessRoute, dimension string) ([]string, error) {
	source.scopeCalls++
	catalog, err := source.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return nil, err
	}
	if err := resourcev2.CheckCatalogRevision(ctx, catalog); err != nil {
		return nil, err
	}
	if dimension != "namespace" {
		return nil, resourcev2.NewError("UNSUPPORTED", "Scope suggestions are unavailable for this dimension.")
	}
	return []string{"default"}, nil
}
func (source *generatedNativeSource) GetActions(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.ActionDescriptor, error) {
	return []resourcev2.ActionDescriptor{{ID: "calculate", Label: "Calculate", Scope: resourcev2.ActionScopeType, ParamsSchema: &resourcev2.Schema{Properties: map[string]resourcev2.SchemaProperty{"amount": {Type: resourcev2.SchemaInteger}}, Required: []string{"amount"}}}}, nil
}
func (source *generatedNativeSource) Action(_ context.Context, request resourcev2.ActionRequest) (resourcev2.Value, error) {
	source.actionCalls++
	source.expectedAction = request.ExpectedDescriptor
	return request.Input, nil
}

func TestScopeDiscoveryIsOneNegotiatedLaneNotPerDimensionPromise(t *testing.T) {
	ctrl, source := generatedController(t)
	source.scopeDiscovery = true
	tools := generatedTools(t, ctrl)
	count := 0
	for _, tool := range tools {
		if tool.Resource.Route.Connection == "route-a" && tool.Resource.Operation == "resource.ScopeValues" {
			count++
		}
	}
	require.Equal(t, 1, count)
	tool := findGenerated(t, tools, "route-a", "resource.ScopeValues")
	require.Contains(t, tool.Description, "does not promise suggestions")
	result, err := DispatchResource(invocation.HostContext(context.Background()), ctrl, tool, json.RawMessage(`{"dimension":"namespace"}`))
	require.NoError(t, err)
	require.Equal(t, []string{"default"}, result.(ResourceScopeValuesResult).Values)
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, tool, json.RawMessage(`{"dimension":"unsupported"}`))
	require.Error(t, err)
	require.Equal(t, 2, source.scopeCalls)
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, tool, json.RawMessage(`{"dimension":"undeclared"}`))
	require.Error(t, err)
	require.Equal(t, 2, source.scopeCalls)
}

func TestIntegralTaggedDoubleRemainsValidForQueryAndActionIntegerSchema(t *testing.T) {
	ctrl, source := generatedController(t)
	source.integerInputs = true
	source.actions = true
	tools := generatedTools(t, ctrl)
	query := findGenerated(t, tools, "route-a", "resource.NativeQuery")
	input := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"selector": {Kind: "double", Double: 1e20}}}
	arguments, err := json.Marshal(map[string]any{"query": input, "limit": 1})
	require.NoError(t, err)
	_, err = DispatchResource(invocation.HostContext(context.Background()), ctrl, query, arguments)
	require.NoError(t, err)
	require.Equal(t, 1, source.queries)
	action := findGenerated(t, tools, "route-a", "resource.Action")
	input.Map = map[string]resourcev2.Value{"amount": {Kind: "double", Double: 1e20}}
	arguments, err = json.Marshal(map[string]any{"input": input})
	require.NoError(t, err)
	result, err := DispatchResource(invocation.HostContext(context.Background()), ctrl, action, arguments)
	require.NoError(t, err)
	require.Equal(t, 1, source.actionCalls)
	require.Equal(t, 1e20, result.(ResourceOperationResult).Value.Map["amount"].Double)
	require.NotNil(t, source.expectedAction)
	branches := taggedProperty(resourcev2.SchemaProperty{Type: resourcev2.SchemaInteger})["oneOf"].([]any)
	require.Equal(t, "integer", branches[2].(map[string]any)["properties"].(map[string]any)["value"].(map[string]any)["type"])
}
