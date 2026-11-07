package metric

import (
	"context"
	"errors"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func projectionQuery() sdk.ResourceMetricsQuery {
	return sdk.ResourceMetricsQuery{
		Source:    sdk.MetricSourceRef{PluginID: "grafana", ConnectionID: "metrics-production", DatasourceKind: "prometheus", DatasourceUID: "prom"},
		Targets:   []sdk.ResourceMetricTarget{{Token: "pod", Route: resourcev2.AccessRoute{Connection: "cluster"}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "owner-authority", Type: "core::v1::Pod", ID: "pod"}}, PublicData: map[string]string{"forged": "caller-secret", "zone": "caller-zone"}}},
		MetricIDs: []string{"cpu"}, Shape: "current",
		Context: sdk.MetricQueryContext{MappingRevision: "mapping-1", Definitions: []sdk.MetricDefinition{{ID: "cpu", FieldBindings: []sdk.MetricFieldBinding{{Field: "zone", Source: "resource", ResourcePath: "/profile/zone"}}}}},
	}
}

func TestFiniteProjectionUsesOwnerNotSelectedSourceAndScrubsCallerData(t *testing.T) {
	c := &controller{}
	q := projectionQuery()
	guards, reads := 0, 0
	retired := false
	body := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"profile": {Kind: "map", Map: map[string]resourcev2.Value{"zone": {Kind: "string", String: "east"}}},
		"secret":  {Kind: "string", String: "must-not-cross-source-boundary"},
	}}
	c.SetMetricResourceReader(func(_ context.Context, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference, paths []string) (*resourcev2.Value, func(context.Context) error, error) {
		reads++
		require.Equal(t, "kubernetes", plugin)
		require.Equal(t, "cluster", route.Connection)
		require.Equal(t, "owner-authority", reference.Address.Authority)
		require.Equal(t, []string{"/profile/zone"}, paths)
		return &body, func(context.Context) error {
			guards++
			if retired {
				return errors.New("observation retired")
			}
			return nil
		}, nil
	})
	projected, guard, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err)
	require.Equal(t, q.Source, projected.Source, "projection must not replace selected source credentials")
	require.Equal(t, map[string]string{"zone": "east"}, projected.Targets[0].PublicData)
	require.Equal(t, "caller-secret", q.Targets[0].PublicData["forged"], "scrubbing must not mutate caller-owned maps")
	require.Equal(t, "mapping-1", projected.Context.MappingRevision)
	require.NotEmpty(t, projected.Context.ProjectionRevision)
	reprojected, _, err := c.projectFinite(context.Background(), "kubernetes", "cluster", projected)
	require.NoError(t, err)
	require.Equal(t, projected.Context, reprojected.Context, "projection revision must be idempotent")
	require.Equal(t, 2, reads)
	require.Equal(t, 2, guards, "each projection must validate retained observations before return")
	require.NoError(t, guard())
	retired = true
	require.Error(t, guard(), "cache delivery must recheck the retained observation")
}

func TestFiniteIdentityOnlyProjectionIgnoresUnrequestedMappings(t *testing.T) {
	c := &controller{}
	q := projectionQuery()
	q.MetricIDs = []string{"native"}
	identityCalls := 0
	c.SetResourceIdentityGuard(func(_ context.Context, operation, plugin string, route resourcev2.AccessRoute, _ resourcev2.ResourceReference) (func(context.Context) error, error) {
		identityCalls++
		require.Equal(t, "metric.Query", operation)
		require.Equal(t, "kubernetes", plugin)
		require.Equal(t, "cluster", route.Connection)
		return func(context.Context) error { return nil }, nil
	})
	projected, guard, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err, "unrequested body mappings must not require resource.Get or a body reader")
	require.Nil(t, projected.Targets[0].PublicData)
	require.Equal(t, 1, identityCalls)
	require.NoError(t, guard())
}

func TestFiniteProjectionRequiresObservationAndDeliveryGuard(t *testing.T) {
	for _, scenario := range []string{"missing reader", "missing body", "missing guard", "denied reader"} {
		t.Run(scenario, func(t *testing.T) {
			c := &controller{}
			if scenario != "missing reader" {
				c.SetMetricResourceReader(func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference, []string) (*resourcev2.Value, func(context.Context) error, error) {
					body := &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"profile": {Kind: "map", Map: map[string]resourcev2.Value{"zone": {Kind: "string", String: "east"}}}}}
					if scenario == "missing body" {
						return nil, func(context.Context) error { return nil }, nil
					}
					if scenario == "missing guard" {
						return body, nil, nil
					}
					return nil, nil, errors.New("owner read denied")
				})
			}
			projected, guard, err := c.projectFinite(context.Background(), "kubernetes", "cluster", projectionQuery())
			require.Error(t, err)
			require.Nil(t, guard)
			require.NotContains(t, projected.Targets[0].PublicData, "forged")
		})
	}
	q := projectionQuery()
	q.Context.Definitions = nil
	_, guard, err := (&controller{}).projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.Error(t, err, "native identity admission must also fail closed")
	require.Nil(t, guard)
}

func TestFiniteProjectionRevisionPreservesSubsetSharingAndFencesMappings(t *testing.T) {
	c := &controller{}
	zone := "east"
	c.SetMetricResourceReader(func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference, []string) (*resourcev2.Value, func(context.Context) error, error) {
		return &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"profile": {Kind: "map", Map: map[string]resourcev2.Value{"zone": {Kind: "string", String: zone}, "region": {Kind: "string", String: zone}}}}}, func(context.Context) error { return nil }, nil
	})
	q := projectionQuery()
	first, _, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err)
	q.Targets = append(q.Targets, q.Targets[0])
	q.Targets[1].Token = "other-pod"
	q.Targets[1].Reference.Address.ID = "other-pod"
	superset, _, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err)
	require.Equal(t, first.Context.ProjectionRevision, superset.Context.ProjectionRevision, "target subsets must share the projection partition")
	zone = "west"
	changedValue, _, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err)
	require.Equal(t, first.Context.ProjectionRevision, changedValue.Context.ProjectionRevision)
	require.NotEqual(t, first.Targets[0].PublicData, changedValue.Targets[0].PublicData, "changed scalars must change target cache identity")
	q.Context.Definitions[0].FieldBindings[0].ResourcePath = "/profile/region"
	changedMapping, _, err := c.projectFinite(context.Background(), "kubernetes", "cluster", q)
	require.NoError(t, err)
	require.NotEqual(t, first.Context.ProjectionRevision, changedMapping.Context.ProjectionRevision)
}

func TestPublicResourceScalarExtractionBoundaries(t *testing.T) {
	body := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"a/b":    {Kind: "map", Map: map[string]resourcev2.Value{"til~de": {Kind: "string", String: "escaped"}}},
		"bool":   {Kind: "bool", Bool: true},
		"int":    {Kind: "int64", Int: "-9223372036854775808"},
		"uint":   {Kind: "uint64", Uint: "18446744073709551615"},
		"double": {Kind: "double", Double: 0.25},
		"time":   {Kind: "timestamp", Timestamp: "2026-11-05T00:00:00Z"},
		"null":   {Kind: "null"},
		"list":   {Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "element"}}},
		"huge":   {Kind: "string", String: strings.Repeat("x", 1025)},
		"secret": {Kind: "string", String: "never"},
	}}
	for path, expected := range map[string]string{"/a~1b/til~0de": "escaped", "/bool": "true", "/int": "-9223372036854775808", "/uint": "18446744073709551615", "/double": "0.25", "/time": "2026-11-05T00:00:00Z"} {
		leaf, err := extractPublicResourceLeaf(body, path)
		require.NoError(t, err, path)
		require.Equal(t, expected, publicResourceScalar(leaf), path)
	}
	for _, path := range []string{"", "no-slash", "/a~2b", "/missing", "/bool/child", "/list/0", "/list", "/a~1b", "/null", "/huge", "/secret", "/credential/value", "/data/item"} {
		_, err := extractPublicResourceLeaf(body, path)
		require.Error(t, err, path)
	}
}

func TestProjectionBindingsRejectConflictingPathsAndSensitivePointers(t *testing.T) {
	definition := sdk.MetricDefinition{FieldBindings: []sdk.MetricFieldBinding{{Field: "zone", Source: "resource", ResourcePath: "/profile/zone"}, {Field: "zone", Source: "resource", ResourcePath: "/profile/other"}}}
	require.Error(t, validateProjectionBindings(definition))
	for _, binding := range []sdk.MetricFieldBinding{{Field: "zone", Source: "scope", ResourcePath: "/profile/zone"}, {Source: "resource", ResourcePath: "/name"}, {Field: "zone", Source: "resource", ResourcePath: "/client_key"}} {
		require.Error(t, validateProjectionBindings(sdk.MetricDefinition{FieldBindings: []sdk.MetricFieldBinding{binding}}))
	}
}

func TestFiniteProjectionClonesSourceProvenance(t *testing.T) {
	source := sdk.MetricSourceRef{PluginID: "grafana", ConnectionID: "production", DatasourceKind: "prometheus", DatasourceUID: "prom"}
	result := sdk.ResourceMetricResult{Source: &source}
	clonedResult := cloneFiniteResult(result)
	clonedResult.Source.ConnectionID = "caller-mutation"
	require.Equal(t, "production", result.Source.ConnectionID)
	catalog := &sdk.ResourceMetricsCatalog{Metrics: []sdk.FiniteMetricDescriptor{{ID: "cpu", Source: &source}}}
	clonedCatalog := cloneFiniteCatalog(catalog)
	clonedCatalog.Metrics[0].Source.DatasourceUID = "caller-mutation"
	require.Equal(t, "prom", catalog.Metrics[0].Source.DatasourceUID)
}
