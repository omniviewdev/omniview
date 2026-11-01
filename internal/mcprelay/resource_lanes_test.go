package mcprelay

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// laneService advertises health and relationships over the real generated
// controller and records the ancillary calls the relay makes.
type laneService struct {
	resource.Controller
	observer    catalogObserver
	gets        int
	healthBody  *resourcev2.Value
	eventLimit  uint32
	eventCalls  int
	healthCalls int
}

func newLaneService(t *testing.T, ctrl resource.Controller) *laneService {
	t.Helper()
	observer, ok := ctrl.(catalogObserver)
	require.True(t, ok)
	return &laneService{Controller: ctrl, observer: observer}
}
func (s *laneService) Features(context.Context, string) (resourcev2.FeatureSet, error) {
	traits := []resourcev2.Feature{resourcev2.FeatureHealth, resourcev2.FeatureRelationships}
	return resourcev2.FeatureSet{Traits: traits}, nil
}
func (s *laneService) ObserveCatalog(
	ctx context.Context, pluginID string, route resourcev2.AccessRoute,
) (resourcev2.Catalog, resource.Observation, error) {
	return s.observer.ObserveCatalog(ctx, pluginID, route)
}
func (s *laneService) ResolveToolTarget(
	ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string,
) (resourcev2.ReadTarget, error) {
	return s.observer.ResolveToolTarget(ctx, pluginID, route, resourceType)
}
func (s *laneService) Get(_ context.Context, _ string, request resource.HostGetRequest) (resource.HostRecord, error) {
	s.gets++
	address := request.Request.Reference.Address
	return resource.HostRecord{Record: generatedRecord(addressTarget(request.Request.Route, address), address.ID)}, nil
}
func (s *laneService) GetHealth(
	_ context.Context, _ string, _ resourcev2.GetRequest, body resourcev2.Value,
) (*resourcev2.ResourceHealth, error) {
	s.healthCalls++
	s.healthBody = &body
	return nil, nil
}
func (s *laneService) GetResourceEvents(
	_ context.Context, _ string, _ resourcev2.GetRequest, limit uint32,
) ([]resourcev2.ResourceEvent, error) {
	s.eventCalls++
	s.eventLimit = limit
	return []resourcev2.ResourceEvent{}, nil
}

type fakeGraphReader struct{ calls int }

func (g *fakeGraphReader) GetRelated(
	context.Context, string, resourcev2.ResourceReference, resourcev2.AccessRoute, string, *string,
) ([]graph.GraphEdge, error) {
	g.calls++
	return []graph.GraphEdge{}, nil
}

type fakeMetricReader struct {
	response *sdkmetric.QueryResponse
	request  *sdkmetric.QueryRequest
}

func (m *fakeMetricReader) ReadResourceMetrics(
	_ context.Context, _ string, request sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	m.request = &request
	return m.response, nil
}
func (m *fakeMetricReader) GetProvidersForResource(resourceType string) []hostmetric.MetricProviderSummary {
	if resourceType != "opaque/items" {
		return nil
	}
	shapes := []sdkmetric.MetricShape{sdkmetric.ShapeCurrent, sdkmetric.ShapeTimeseries, sdkmetric.ShapeAggregate}
	cpu := sdkmetric.MetricDescriptor{ID: "cpu", Name: "CPU", Unit: sdkmetric.UnitCores, SupportedShapes: shapes}
	foreign := sdkmetric.MetricDescriptor{ID: "foreign"}
	return []hostmetric.MetricProviderSummary{
		{PluginID: "other", Handlers: []sdkmetric.Handler{{Resource: resourceType, Metrics: metricList(foreign)}}},
		{PluginID: "fixture", Handlers: []sdkmetric.Handler{{Resource: resourceType, Metrics: metricList(cpu)}}},
	}
}

func laneTools(t *testing.T, service resource.Service, readers ResourceReaders) []ToolInfo {
	t.Helper()
	routes := []ResourceRoute{
		{PluginID: "fixture", Route: resourcev2.AccessRoute{Connection: "route-a"}},
		{PluginID: "fixture", Route: resourcev2.AccessRoute{Connection: "route-b"}},
	}
	tools, err := BuildResourceCatalogWithReaders(invocation.HostContext(context.Background()), service, routes, readers)
	require.NoError(t, err)
	return tools
}

func laneReference(tool ToolInfo, resourceType string) map[string]any {
	target := tool.Resource.Target
	if tool.Resource.Types != nil {
		target = tool.Resource.Types["opaque/items"].Target
	}
	address := map[string]any{
		"provider": target.Provider, "authority": target.Authority, "type": resourceType, "scope": []any{}, "id": "item",
	}
	return map[string]any{"address": address}
}

func laneCall(t *testing.T, service resource.Service, tool ToolInfo, args map[string]any) (any, error) {
	t.Helper()
	return DispatchResource(invocation.HostContext(context.Background()), service, tool, mustJSON(t, args))
}

// schemaAt walks nested JSON-schema maps with checked assertions.
func schemaAt(t *testing.T, schema map[string]any, keys ...string) any {
	t.Helper()
	var current any = schema
	for _, key := range keys {
		node, ok := current.(map[string]any)
		require.True(t, ok, key)
		current = node[key]
	}
	return current
}

func TestRouteLanesAreOnePerRouteAndBindAdvertisedTypes(t *testing.T) {
	ctrl, source := generatedController(t)
	source.gets = true
	service := newLaneService(t, ctrl)
	graphReader := &fakeGraphReader{}
	tools := laneTools(t, service, ResourceReaders{Logs: nil, Metrics: nil, Graph: graphReader})
	for _, operation := range []string{opGetResourceEvents, opGetHealth, opGraphRelated} {
		count := 0
		for _, tool := range tools {
			if tool.Resource.Route.Connection == "route-a" && tool.Resource.Operation == operation {
				count++
				require.True(t, tool.ReadOnly)
				require.False(t, tool.Destructive)
				require.Empty(t, tool.Resource.Type)
			}
		}
		require.Equal(t, 1, count, operation)
	}
	events := findGenerated(t, tools, "route-a", opGetResourceEvents)
	path := []string{"properties", "reference", "properties", "address", "properties", "type", "enum"}
	require.Equal(t, []string{"opaque/items"}, schemaAt(t, events.InputSchema, path...))

	_, err := laneCall(t, service, events, map[string]any{"reference": laneReference(events, "opaque/other")})
	require.ErrorContains(t, err, "reference type is not advertised")
	require.Zero(t, service.eventCalls)
	_, err = laneCall(t, service, events, map[string]any{"reference": laneReference(events, "opaque/items"), "limit": 257})
	require.Error(t, err)
	require.Zero(t, service.eventCalls)
	result, err := laneCall(t, service, events, map[string]any{"reference": laneReference(events, "opaque/items")})
	require.NoError(t, err)
	require.Equal(t, uint32(50), service.eventLimit)
	eventsResult, ok := result.(ResourceEventsResult)
	require.True(t, ok)
	require.Equal(t, "item", eventsResult.Reference.Address.ID)

	reference := map[string]any{"reference": laneReference(events, "opaque/items")}
	target, err := events.Resource.InvocationTarget(mustJSON(t, reference))
	require.NoError(t, err)
	require.Equal(t, "opaque/items", target.ResourceType)
	require.Empty(t, target.Action)

	health := findGenerated(t, tools, "route-a", opGetHealth)
	result, err = laneCall(t, service, health, map[string]any{"reference": laneReference(health, "opaque/items")})
	require.NoError(t, err)
	require.Equal(t, 1, service.gets)
	require.Equal(t, "18446744073709551615", service.healthBody.Map["uint"].Uint)
	require.Contains(t, string(mustJSON(t, result)), `"health":null`)

	related := findGenerated(t, tools, "route-a", opGraphRelated)
	args := map[string]any{"reference": laneReference(related, "opaque/items"), "direction": "both"}
	_, err = laneCall(t, service, related, args)
	require.NoError(t, err)
	require.Equal(t, 1, graphReader.calls)
}

func TestRouteLanesNeedGraphReaderAndGetCapability(t *testing.T) {
	ctrl, source := generatedController(t)
	service := newLaneService(t, ctrl)
	for _, tool := range laneTools(t, service, ResourceReaders{Logs: nil, Metrics: nil, Graph: &fakeGraphReader{}}) {
		require.Nil(t, tool.Resource.Types, "no type declares Get")
	}
	source.gets = true
	for _, tool := range laneTools(t, service, ResourceReaders{}) {
		require.NotEqual(t, opGraphRelated, tool.Resource.Operation)
	}
}

func TestMetricToolsOnlyForHandledTypesAndHideProviderErrors(t *testing.T) {
	ctrl, _ := generatedController(t)
	metrics := &fakeMetricReader{response: &sdkmetric.QueryResponse{Success: false, Error: "secret plugin text"}}
	tools := laneTools(t, ctrl, ResourceReaders{Logs: nil, Metrics: metrics, Graph: nil})
	tool := findGenerated(t, tools, "route-a", opMetricQuery)
	require.True(t, tool.ReadOnly)
	require.Equal(t, "Metrics for one Items. Available: cpu (CPU, cores).", tool.Description)
	require.Equal(t, []string{"current", "timeseries"}, schemaAt(t, tool.InputSchema, "properties", "shape", "enum"))

	reference := laneReference(tool, "opaque/items")
	query := func(args map[string]any) error {
		args["reference"] = reference
		_, err := laneCall(t, ctrl, tool, args)
		return err
	}
	require.Error(t, query(map[string]any{"metricIDs": []string{"foreign"}, "shape": "current"}))
	require.Nil(t, metrics.request)
	err := query(map[string]any{"metricIDs": []string{"cpu"}, "shape": "current"})
	require.Equal(t, "PROVIDER_ERROR", resourcev2.ErrorCode(err))
	require.NotContains(t, err.Error(), "secret")
	require.Equal(t, "opaque/items", metrics.request.ResourceKey)

	metrics.response = &sdkmetric.QueryResponse{Success: true, Results: []sdkmetric.MetricResult{}}
	window := map[string]any{
		"metricIDs": []string{"cpu"}, "shape": "timeseries",
		"startTime": "2026-10-30T12:00:00Z", "endTime": "2026-10-30T12:10:00Z",
	}
	require.NoError(t, query(window))
	require.Equal(t, sdkmetric.ShapeTimeseries, metrics.request.Shape)
	require.Equal(t, "6s", metrics.request.Step.String())
	window["startTime"], window["endTime"] = window["endTime"], window["startTime"]
	require.Error(t, query(window))
}

func TestActionMetadataReachesTitleAndDescription(t *testing.T) {
	route := ResourceRoute{PluginID: "fixture", Route: resourcev2.AccessRoute{Connection: "route-a"}}
	binding := ResourceBinding{
		Type: "opaque/items", Operation: "resource.Action", Action: "restart",
		Descriptor: resourcev2.ResourceType{DisplayName: "Items"},
		ActionDescriptor: &resourcev2.ActionDescriptor{
			ID: "restart", Label: "Rollout Restart", Description: " Restart all pods. ", Dangerous: true,
		},
	}
	info := actionToolInfo(route, binding, "action_restart")
	require.Equal(t, "Items: Rollout Restart", info.Title)
	require.Equal(t, "Restart all pods. (action restart on opaque/items through route route-a.) "+
		"The provider marks this action dangerous: it can disrupt workloads or lose data. "+
		"Values use canonical tagged resource Value encoding.", info.Description)
	require.False(t, info.ReadOnly)
	require.True(t, info.Destructive)

	binding.ActionDescriptor = &resourcev2.ActionDescriptor{ID: "restart", Description: "Restart."}
	info = actionToolInfo(route, binding, "action_restart")
	require.Equal(t, "Items action_restart", info.Title)
	require.NotContains(t, info.Description, "dangerous")
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	return encoded
}

func metricList(metrics ...sdkmetric.MetricDescriptor) []sdkmetric.MetricDescriptor { return metrics }
