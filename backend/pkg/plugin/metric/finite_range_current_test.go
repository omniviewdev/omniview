package metric

import (
	"context"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

// Synthetic source semantics, not provider scan or real-cluster performance evidence.
func finiteCurrentRangeProvider(t *testing.T, allowed bool, age time.Duration) (*controller, *finiteTestProvider, context.Context, MetricsObservationSpec) {
	t.Helper()
	c, provider, ctx := finiteTestController(t)
	provider.catalog = func(_ *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
		return &sdk.ResourceMetricsCatalog{Source: request.Source, MaxTargets: 256, MaxSampleAge: age, Metrics: []sdk.FiniteMetricDescriptor{
			{ID: "cpu", Name: "CPU", ResourceKey: request.ResourceKey, Unit: "cores", Shapes: []string{"current", "range"}, RangeToCurrent: allowed},
			{ID: "memory", Name: "Memory", ResourceKey: request.ResourceKey, Unit: "bytes", Shapes: []string{"current", "range"}},
		}}, nil
	}
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := &sdk.ResourceMetricsResponse{Complete: true}
		for _, target := range query.Targets {
			for _, id := range query.MetricIDs {
				observed := time.Now().UTC().Add(-time.Second)
				value := 0.75
				if id == "memory" {
					value = 2 << 20
				}
				result := sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "ok", IdentityScope: "name", Window: 15 * time.Second}
				if query.Shape == "range" {
					observed = query.EndTime.Add(-time.Second)
					value /= 3
					for at := query.StartTime; !at.After(query.EndTime); at = at.Add(query.Step) {
						result.Points = append(result.Points, sdk.ResourceMetricPoint{Time: at, Value: &value})
					}
				} else {
					result.Value = &value
				}
				result.ObservedAt = &observed
				response.Results = append(response.Results, result)
			}
		}
		return response
	}
	close(provider.release)
	spec := finiteRangeSpec(0, 10)
	spec.EndTime = time.Now().UTC().Truncate(time.Second).Add(-2 * time.Second)
	spec.StartTime = spec.EndTime.Add(-10 * time.Second)
	return c, provider, ctx, spec
}

func TestFiniteRangeToCurrentPreservesPhysicalMetadataAndCacheOwnership(t *testing.T) {
	c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
	seed := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, seed.err)
	current := finiteTestSpec("sidebar", "pod-a", "cpu")
	got := finiteTestReceive(t, finiteTestRead(c, ctx, current))
	require.NoError(t, got.err)
	require.True(t, got.data.Complete)
	result := got.data.Results[0]
	require.Equal(t, "sidebar", result.ResourceToken)
	require.Equal(t, 0.25, *result.Value)
	require.Empty(t, result.Points)
	require.Equal(t, spec.EndTime.Add(-time.Second), *result.ObservedAt)
	require.Equal(t, 15*time.Second, result.Window)
	require.Equal(t, "name", result.IdentityScope)
	require.Equal(t, int32(1), provider.queries.Load())
	*result.Value = 99
	again := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, again.err)
	require.Equal(t, 0.25, *again.data.Results[0].Points[10].Value)
}

func TestFiniteRangeToCurrentRefusesUnknownStaleFutureAndGapSamples(t *testing.T) {
	for _, tc := range []struct {
		name    string
		allowed bool
		age     time.Duration
		change  func(*sdk.ResourceMetricsResponse)
	}{
		{name: "opted out", age: 2 * time.Minute},
		{name: "unknown source age", allowed: true},
		{name: "unknown source time", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) { r.Results[0].ObservedAt = nil }},
		{name: "stale source time", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) {
			at := time.Now().UTC().Add(-3 * time.Minute)
			r.Results[0].ObservedAt = &at
		}},
		{name: "future source time", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) {
			at := time.Now().UTC().Add(time.Minute)
			r.Results[0].ObservedAt = &at
		}},
		{name: "source time after evaluation", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) {
			at := r.Results[0].Points[10].Time.Add(time.Second)
			r.Results[0].ObservedAt = &at
		}},
		{name: "terminal gap", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) { r.Results[0].Points[10].Value = nil }},
		{name: "incomplete range", allowed: true, age: 2 * time.Minute, change: func(r *sdk.ResourceMetricsResponse) { r.Complete = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, provider, ctx, spec := finiteCurrentRangeProvider(t, tc.allowed, tc.age)
			original := provider.response
			provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := original(query)
				if query.Shape == "range" && tc.change != nil {
					tc.change(response)
				}
				return response
			}
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
			got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu")))
			require.NoError(t, got.err)
			require.Equal(t, 0.75, *got.data.Results[0].Value, "current must come from its own provider evaluation")
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeToCurrentKeepsExpiryIncarnationAndGenerationFences(t *testing.T) {
	for _, kind := range []string{"expiry", "incarnation", "generation", "future evaluation"} {
		t.Run(kind, func(t *testing.T) {
			c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
			if kind == "future evaluation" {
				spec.StartTime = time.Now().UTC().Truncate(time.Second).Add(time.Minute)
				spec.EndTime = spec.StartTime.Add(10 * time.Second)
			}
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
			current := finiteTestSpec("current", "pod-a", "cpu")
			switch kind {
			case "expiry":
				f := c.finiteCoordinator()
				f.mu.Lock()
				f.cache[0].until = time.Now().Add(-time.Second)
				f.mu.Unlock()
			case "incarnation":
				uid := "replacement"
				current.Targets[0].Reference.Incarnation = &uid
			case "generation":
				c.finiteCoordinator().retire("kubernetes", "cluster", false)
			}
			got := finiteTestReceive(t, finiteTestRead(c, ctx, current))
			require.NoError(t, got.err)
			require.Equal(t, 0.75, *got.data.Results[0].Value)
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeToCurrentDoesNotOverrideExactCurrentOrAbsence(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(map[bool]string{false: "value", true: "absence"}[missing], func(t *testing.T) {
			c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
			original := provider.response
			provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := original(query)
				if missing && query.Shape == "current" {
					response.Results[0] = sdk.ResourceMetricResult{ResourceToken: query.Targets[0].Token, MetricID: "cpu", Status: "missing"}
				}
				return response
			}
			current := finiteTestSpec("current", "pod-a", "cpu")
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, current)).err)
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
			got := finiteTestReceive(t, finiteTestRead(c, ctx, current))
			require.NoError(t, got.err)
			if missing {
				require.Equal(t, "missing", got.data.Results[0].Status)
				require.Nil(t, got.data.Results[0].Value)
			} else {
				require.Equal(t, 0.75, *got.data.Results[0].Value)
			}
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeToCurrentPrefersNewestPhysicalSampleNotLatestFetch(t *testing.T) {
	c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
	original := provider.response
	freshEnd := spec.EndTime
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := original(query)
		if query.Shape == "range" && query.EndTime.Before(freshEnd) {
			value := 0.125
			for index := range response.Results[0].Points {
				response.Results[0].Points[index].Value = &value
			}
		}
		return response
	}
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	spec.StartTime, spec.EndTime = spec.StartTime.Add(-30*time.Second), spec.EndTime.Add(-30*time.Second)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu")))
	require.NoError(t, got.err)
	require.Equal(t, 0.25, *got.data.Results[0].Value)
	require.Equal(t, freshEnd.Add(-time.Second), *got.data.Results[0].ObservedAt)
	require.Equal(t, int32(2), provider.queries.Load())
}

func TestFiniteRangeToCurrentOptInAppliesPerMetric(t *testing.T) {
	c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
	spec.MetricIDs = []string{"cpu", "memory"}
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	finiteTestReceive(t, provider.calls)
	got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu", "memory")))
	require.NoError(t, got.err)
	values := map[string]float64{}
	for _, result := range got.data.Results {
		values[result.MetricID] = *result.Value
	}
	require.Equal(t, map[string]float64{"cpu": 0.25, "memory": 2 << 20}, values)
	require.Equal(t, []string{"memory"}, finiteTestReceive(t, provider.calls).MetricIDs)
	require.Equal(t, int32(2), provider.queries.Load())
}

func TestFiniteRangeToCurrentManualRefreshFetchesCurrentSample(t *testing.T) {
	c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	events := make(chan MetricsObservationSnapshot, 32)
	_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{
		ClientToken: "current-from-range", Spec: finiteTestSpec("current", "pod-a", "cpu"),
	}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "current-from-range"))
	cached := nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && !snapshot.Fetching
	})
	require.Equal(t, 0.25, *cached.Data.Results[0].Value)
	require.Equal(t, int32(1), provider.queries.Load())
	require.NoError(t, c.RefreshMetricsObservation(ctx, "current-from-range"))
	fresh := nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && !snapshot.Fetching && snapshot.Sequence > cached.Sequence
	})
	require.Equal(t, 0.75, *fresh.Data.Results[0].Value)
	require.Equal(t, int32(2), provider.queries.Load())
	require.NoError(t, c.CloseMetricsObservation(ctx, "current-from-range"))
}
