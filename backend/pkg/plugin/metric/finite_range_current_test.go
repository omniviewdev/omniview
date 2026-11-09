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

// A complete answer settles every grid point of its domain. A source gap or an
// omitted terminal point at a later evaluation means there is no current sample
// then, and an older numeric terminal point must not stand in for it.
func TestFiniteRangeToCurrentLaterGapOrOmissionBlocksOlderNumericSample(t *testing.T) {
	// A window's bounds are offsets from the base window's end; terminal says what
	// the source returned at its last grid point.
	type windowRead struct {
		start, end time.Duration
		terminal   string
	}
	for _, tc := range []struct {
		name     string
		reads    []windowRead
		promoted bool
	}{
		{name: "newer terminal gap", reads: []windowRead{{-10 * time.Second, 0, "numeric"}, {-9 * time.Second, time.Second, "gap"}}},
		{name: "newer omitted terminal point", reads: []windowRead{{-10 * time.Second, 0, "numeric"}, {-9 * time.Second, time.Second, "omitted"}}},
		{name: "newer answer without points", reads: []windowRead{{-10 * time.Second, 0, "numeric"}, {-9 * time.Second, time.Second, "empty"}}},
		{name: "same evaluation fetched later as a gap", reads: []windowRead{{-10 * time.Second, 0, "numeric"}, {-20 * time.Second, 0, "gap"}}},
		{name: "older terminal gap", promoted: true, reads: []windowRead{{-15 * time.Second, -5 * time.Second, "gap"}, {-10 * time.Second, 0, "numeric"}}},
		{name: "same evaluation fetched later as a sample", promoted: true, reads: []windowRead{{-20 * time.Second, 0, "gap"}, {-10 * time.Second, 0, "numeric"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
			original := provider.response
			provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := original(query)
				if query.Shape != "range" {
					return response
				}
				for _, window := range tc.reads {
					if !query.StartTime.Equal(spec.EndTime.Add(window.start)) {
						continue
					}
					points := response.Results[0].Points
					switch window.terminal {
					case "gap":
						points[len(points)-1].Value = nil
					case "omitted":
						response.Results[0].Points = points[:len(points)-1]
					case "empty":
						response.Results[0].Points = nil
					}
				}
				return response
			}
			for _, window := range tc.reads {
				read := spec
				read.StartTime, read.EndTime = spec.EndTime.Add(window.start), spec.EndTime.Add(window.end)
				require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, read)).err)
			}
			got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu")))
			require.NoError(t, got.err)
			if tc.promoted {
				require.Equal(t, 0.25, *got.data.Results[0].Value)
				require.Equal(t, int32(len(tc.reads)), provider.queries.Load(), "the newest evaluation answers current without another read")
				return
			}
			require.Equal(t, 0.75, *got.data.Results[0].Value, "current must come from its own provider evaluation")
			require.Equal(t, int32(len(tc.reads)+1), provider.queries.Load())
		})
	}
}

func TestFiniteRangeToCurrentWindowEndingInTheFutureKeepsItsLastEvaluatedSample(t *testing.T) {
	c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
	original := provider.response
	evaluated := spec.EndTime
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := original(query)
		if query.Shape == "range" {
			// A source can only have evaluated up to the present.
			points := response.Results[0].Points
			for len(points) > 0 && points[len(points)-1].Time.After(evaluated) {
				points = points[:len(points)-1]
			}
			observed := evaluated.Add(-time.Second)
			response.Results[0].Points, response.Results[0].ObservedAt = points, &observed
		}
		return response
	}
	spec.StartTime, spec.EndTime = evaluated.Add(-5*time.Second), evaluated.Add(time.Hour)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu")))
	require.NoError(t, got.err)
	require.Equal(t, 0.25, *got.data.Results[0].Value)
	require.Equal(t, evaluated.Add(-time.Second), *got.data.Results[0].ObservedAt)
	require.Equal(t, int32(1), provider.queries.Load(), "the evaluated sample answers current without another read")
}

// An answer with no point settles, as absent, only the points of its own grid
// that its source had reached when it landed. Its window ends in the future, but
// a later lookup does not find more of it in the past, and a window that began
// after the answer landed settled nothing. Only older numeric terminal samples
// are blocked: a later evaluation stays eligible, however coarse its grid.
func TestFiniteRangeToCurrentEmptyWindowEndingInTheFutureSettlesOnlyGridPointsAlreadyReached(t *testing.T) {
	// Offsets are from the numeric window's end, the evaluation it settles.
	type windowRead struct {
		start, end, step time.Duration
	}
	numeric := windowRead{-10 * time.Second, 0, time.Second}
	for _, tc := range []struct {
		name     string
		reads    []windowRead
		promoted bool
	}{
		{name: "grid point reached after the numeric evaluation", reads: []windowRead{numeric, {-5 * time.Second, time.Hour, time.Second}}},
		{name: "same answer fetched before the numeric window", reads: []windowRead{{-5 * time.Second, time.Hour, time.Second}, numeric}},
		{name: "coarser grid last reached before the numeric evaluation", promoted: true, reads: []windowRead{numeric, {-30 * time.Second, time.Hour, time.Minute}}},
		{name: "grid point at the numeric evaluation fetched later", reads: []windowRead{numeric, {-time.Minute, time.Hour, time.Minute}}},
		{name: "grid point at the numeric evaluation fetched earlier", promoted: true, reads: []windowRead{{-time.Minute, time.Hour, time.Minute}, numeric}},
		{name: "window beginning after the answer landed", promoted: true, reads: []windowRead{numeric, {time.Minute, time.Hour, time.Second}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, provider, ctx, spec := finiteCurrentRangeProvider(t, true, 2*time.Minute)
			original := provider.response
			provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := original(query)
				if query.Shape == "range" && query.EndTime.After(spec.EndTime) {
					// The source reports nothing, and no observation time, for it.
					response.Results[0].Points, response.Results[0].ObservedAt = nil, nil
				}
				return response
			}
			for _, window := range tc.reads {
				read := spec
				read.StartTime, read.EndTime = spec.EndTime.Add(window.start), spec.EndTime.Add(window.end)
				read.StepMs = int(window.step / time.Millisecond)
				require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, read)).err)
			}
			got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("current", "pod-a", "cpu")))
			require.NoError(t, got.err)
			if tc.promoted {
				require.Equal(t, 0.25, *got.data.Results[0].Value)
				require.Equal(t, int32(len(tc.reads)), provider.queries.Load(), "the numeric evaluation answers current without another read")
				return
			}
			require.Equal(t, 0.75, *got.data.Results[0].Value, "current must come from its own provider evaluation")
			require.Equal(t, int32(len(tc.reads)+1), provider.queries.Load())
		})
	}
}

func TestFiniteRangeToCurrentLaterLookupDoesNotAdvanceEmptyAnswerFence(t *testing.T) {
	base := time.Date(2026, time.November, 1, 12, 0, 0, 0, time.UTC)
	pair := finitePair{"target", "cpu"}
	value, observed := 0.25, base.Add(4*time.Second)
	catalog := &sdk.ResourceMetricsCatalog{
		Metrics: []sdk.FiniteMetricDescriptor{{ID: "cpu", RangeToCurrent: true}},
	}
	query := sdk.ResourceMetricsQuery{
		StartTime: base.Add(-20 * time.Second), EndTime: base.Add(time.Minute),
		Step: 10 * time.Second,
	}
	cache := []finiteCacheEntry{
		{
			rangeToCurrentKey: "same-authority", complete: true,
			until: base.Add(30 * time.Second), evaluated: query.EndTime,
			reached: finiteReachedPoint(query, base),
			pairs: map[finitePair]sdk.ResourceMetricResult{
				pair: {ResourceToken: pair.target, MetricID: pair.metric, Status: "ok"},
			},
		},
		{
			rangeToCurrentKey: "same-authority", complete: true,
			until: base.Add(30 * time.Second), evaluated: base.Add(5 * time.Second),
			pairs: map[finitePair]sdk.ResourceMetricResult{
				pair: {
					ResourceToken: pair.target, MetricID: pair.metric, Status: "ok",
					ObservedAt: &observed,
					Points:     []sdk.ResourceMetricPoint{{Time: base.Add(5 * time.Second), Value: &value}},
				},
			},
		},
	}
	for _, offset := range []time.Duration{6 * time.Second, 11 * time.Second} {
		t.Run(offset.String(), func(t *testing.T) {
			w := &finiteWaiter{
				rangeToCurrentKey: "same-authority", maxSampleAge: time.Minute,
				workTargets: map[string]sdk.ResourceMetricTarget{pair.target: {Token: pair.target}},
				pairs:       map[finitePair]bool{pair: true}, done: map[finitePair]bool{},
				results: map[finitePair]sdk.ResourceMetricResult{}, missing: 1,
			}
			f := &finiteCoordinator{cache: cache}
			// Both entries remain valid, including after the next empty-range
			// grid point at +10s. Lookup time must not turn it into new absence.
			f.applyCurrentRangeCacheLocked(w, catalog, base.Add(offset))
			require.True(t, w.done[pair], "the numeric answer must still satisfy current")
			require.Zero(t, w.missing)
			require.NotNil(t, w.results[pair].Value)
			require.Equal(t, value, *w.results[pair].Value)
		})
	}
}
