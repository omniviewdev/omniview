package metric

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func TestProjectionUsesAuthoritativeScalarLeavesAndSharedWork(t *testing.T) {
	c, p := setFixtureController(t)
	var reads atomic.Int32
	c.SetMetricResourceReader(func(_ context.Context, owner string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (*resourcev2.Value, func(context.Context) error, error) {
		reads.Add(1)
		require.Equal(t, "owner", owner)
		require.Equal(t, "cluster-a", route.Connection)
		require.Equal(t, "pod", ref.Address.ID)
		return &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"metadata": {Kind: "map", Map: map[string]resourcev2.Value{"labels": {Kind: "map", Map: map[string]resourcev2.Value{"monitor/cluster": {Kind: "string", String: "trusted-cluster"}}}}}, "private": {Kind: "string", String: "must-not-cross"}}}, func(context.Context) error { return nil }, nil
	})
	_, err := c.SaveMetricDefinition(sdk.MetricDefinition{ID: "cpu", Name: "CPU", ResourceKeys: []string{"pods"}, SupportedShapes: []sdk.MetricShape{sdk.ShapeCurrent}, Query: "safe-expression", FieldBindings: []sdk.MetricFieldBinding{{Field: "selected", Source: "resource", ResourcePath: "/metadata/labels/monitor~1cluster"}}})
	require.NoError(t, err)
	_, err = c.QueryResources(context.Background(), setRequest(setResource("table", "one", "pod")))
	require.NoError(t, err)
	_, err = c.QueryResources(context.Background(), setRequest(setResource("sidebar", "one", "pod")))
	require.NoError(t, err)
	require.Equal(t, int32(1), reads.Load())
	require.Equal(t, int32(1), p.calls.Load())
	p.mu.Lock()
	defer p.mu.Unlock()
	projection := p.requests[0].Resources[0].PublicData
	require.NotNil(t, projection)
	require.Len(t, projection.Map, 1)
	require.Equal(t, "trusted-cluster", projection.Map["selected"].String)
}
func TestProjectionDefaultIdentityMappingsReadNoObjects(t *testing.T) {
	c, _ := setFixtureController(t)
	c.SetMetricResourceReader(func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (*resourcev2.Value, func(context.Context) error, error) {
		t.Fatal("default identity mapping must not read source objects")
		return nil, nil, nil
	})
	_, err := c.QueryResources(context.Background(), setRequest(setResource("table", "one", "pod")))
	require.NoError(t, err)
}
func TestProjectionRejectsSensitiveContainersMissingAndOversizeLeaves(t *testing.T) {
	body := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"metadata": {Kind: "map", Map: map[string]resourcev2.Value{"labels": {Kind: "map", Map: map[string]resourcev2.Value{"safe": {Kind: "string", String: "ok"}, "long": {Kind: "string", String: strings.Repeat("x", 2049)}}}}},
		"data":     {Kind: "map", Map: map[string]resourcev2.Value{"auth": {Kind: "string", String: "private"}}},
		"spec":     {Kind: "map", Map: map[string]resourcev2.Value{"password": {Kind: "string", String: "private"}, "items": {Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "item"}}}}},
	}}
	for _, path := range []string{"", "/metadata/labels", "/metadata/labels/missing", "/metadata/labels/long", "/data/auth", "/spec/password", "/spec/items/0", "/metadata/labels/bad~2escape"} {
		t.Run(path, func(t *testing.T) { _, err := extractPublicResourceLeaf(body, path); require.Error(t, err) })
	}
	leaf, err := extractPublicResourceLeaf(body, "/metadata/labels/safe")
	require.NoError(t, err)
	require.Equal(t, "ok", leaf.String)
}
