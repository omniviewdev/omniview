package metric

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

var finiteRangeTestStart = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

func finiteRangeSpec(first, last int) MetricsObservationSpec {
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Shape = "range"
	spec.StartTime = finiteRangeTestStart.Add(time.Duration(first) * time.Second)
	spec.EndTime = finiteRangeTestStart.Add(time.Duration(last) * time.Second)
	spec.StepMs = 1000
	return spec
}

// This synthetic provider evaluates a fixed function of evaluation time, with a
// genuine null gap at t=4. It is demand/coordination evidence, not scan evidence.
func finiteRangeResponse(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
	response := &sdk.ResourceMetricsResponse{Complete: true}
	for _, target := range query.Targets {
		for _, id := range query.MetricIDs {
			result := sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "ok", IdentityScope: "name"}
			for at := query.StartTime; !at.After(query.EndTime); at = at.Add(query.Step) {
				point := sdk.ResourceMetricPoint{Time: at}
				if !at.Equal(finiteRangeTestStart.Add(4 * time.Second)) {
					x := at.Sub(finiteRangeTestStart).Seconds()
					value := x * x
					point.Value = &value
				}
				result.Points = append(result.Points, point)
			}
			response.Results = append(response.Results, result)
		}
	}
	return response
}

func finiteRangeProvider(t *testing.T, allowed bool) (*controller, *finiteTestProvider, context.Context) {
	t.Helper()
	c, provider, ctx := finiteTestController(t)
	provider.catalog = func(_ *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
		return &sdk.ResourceMetricsCatalog{Source: request.Source, MaxTargets: 256, Metrics: []sdk.FiniteMetricDescriptor{
			{ID: "cpu", Name: "CPU", ResourceKey: request.ResourceKey, Unit: "cores", Shapes: []string{"range"}, RangeReuse: allowed},
		}}, nil
	}
	provider.response = finiteRangeResponse
	close(provider.release)
	return c, provider, ctx
}

func TestFiniteRangeReuseClipsDomainOwnsValuesAndPreservesGaps(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	first := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
	require.NoError(t, first.err)
	*first.data.Results[0].Points[2].Value = 999
	spec := finiteRangeSpec(2, 7)
	spec.Targets[0].Token = "sidebar"
	second := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, second.err)
	require.True(t, second.data.Complete)
	require.Equal(t, int32(1), provider.queries.Load())
	result := second.data.Results[0]
	require.Equal(t, "sidebar", result.ResourceToken)
	require.Len(t, result.Points, 6)
	require.Equal(t, spec.StartTime, result.Points[0].Time)
	require.Equal(t, spec.EndTime, result.Points[5].Time)
	require.Equal(t, 4.0, *result.Points[0].Value)
	require.Nil(t, result.Points[2].Value, "a source gap must not become zero")
}

func TestFiniteRangeFetchesHolesAndPublishesImmutableRequestedDomain(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	seed := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(3, 7)))
	require.NoError(t, seed.err)
	finiteTestReceive(t, provider.calls)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		select {
		case <-pc.Context.Done():
			return nil, pc.Context.Err()
		case <-release:
			return finiteRangeResponse(query), nil
		}
	}
	spec := finiteRangeSpec(0, 10)
	events := make(chan MetricsObservationSnapshot, 32)
	_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "range-holes", Spec: spec}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "range-holes"))
	partial := nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && snapshot.Fetching && !snapshot.Data.Complete
	})
	require.Equal(t, spec.StartTime, *partial.DomainStart)
	require.Equal(t, spec.EndTime, *partial.DomainEnd)
	require.Len(t, partial.Data.Results[0].Points, 5)
	require.Equal(t, finiteRangeTestStart.Add(3*time.Second), partial.Data.Results[0].Points[0].Time)
	left, right := finiteTestReceive(t, provider.calls), finiteTestReceive(t, provider.calls)
	require.Equal(t, spec.StartTime, left.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(3*time.Second), left.EndTime)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), right.StartTime)
	require.Equal(t, spec.EndTime, right.EndTime)
	close(release)
	complete := nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && !snapshot.Fetching
	})
	require.Empty(t, complete.Error)
	require.True(t, complete.Data.Complete)
	require.Greater(t, complete.Sequence, partial.Sequence)
	require.Len(t, complete.Data.Results[0].Points, 11)
	require.Nil(t, complete.Data.Results[0].Points[4].Value)
	require.Equal(t, 9.0, *partial.Data.Results[0].Points[0].Value, "later delivery must not mutate a published frame")
	encoded, err := json.Marshal(complete.Data)
	require.NoError(t, err)
	f := c.finiteCoordinator()
	f.mu.Lock()
	bytes := f.snapshotBytes
	f.mu.Unlock()
	require.Equal(t, len(encoded), bytes)
	require.NoError(t, c.CloseMetricsObservation(ctx, "range-holes"))
	f.mu.Lock()
	bytes = f.snapshotBytes
	f.mu.Unlock()
	require.Zero(t, bytes)
}

func TestFiniteRangeReuseKeepsResolutionGridExpiryAndIncarnationFences(t *testing.T) {
	for _, name := range []string{"no declaration", "resolution", "phase", "expiry", "incarnation"} {
		t.Run(name, func(t *testing.T) {
			c, provider, ctx := finiteRangeProvider(t, name != "no declaration")
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10))).err)
			spec := finiteRangeSpec(2, 8)
			switch name {
			case "resolution":
				spec.StepMs = 2000
			case "phase":
				spec.StartTime = spec.StartTime.Add(500 * time.Millisecond)
				spec.EndTime = spec.EndTime.Add(500 * time.Millisecond)
			case "expiry":
				f := c.finiteCoordinator()
				f.mu.Lock()
				for i := range f.cache {
					f.cache[i].until = time.Now().Add(-time.Second)
				}
				f.mu.Unlock()
			case "incarnation":
				uid := "new-incarnation"
				spec.Targets[0].Reference.Incarnation = &uid
			}
			result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
			require.NoError(t, result.err)
			require.Equal(t, int32(2), provider.queries.Load())
			require.Equal(t, spec.StartTime, result.data.Results[0].Points[0].Time)
		})
	}
}

func TestFiniteRangeInflightOverlapSurvivesOriginalReaderCancellation(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	release := make(chan struct{})
	var cancellations atomic.Int32
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		select {
		case <-pc.Context.Done():
			cancellations.Add(1)
			return nil, pc.Context.Err()
		case <-release:
			return finiteRangeResponse(query), nil
		}
	}
	firstCtx, cancelFirst := context.WithCancel(ctx)
	defer cancelFirst()
	first := finiteTestRead(c, firstCtx, finiteRangeSpec(0, 10))
	finiteTestReceive(t, provider.calls)
	contained := finiteTestRead(c, ctx, finiteRangeSpec(2, 7))
	finiteTestWaiters(t, c.finiteCoordinator(), 2)
	tail := finiteTestRead(c, ctx, finiteRangeSpec(8, 14))
	query := finiteTestReceive(t, provider.calls)
	require.Equal(t, finiteRangeTestStart.Add(10*time.Second), query.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(14*time.Second), query.EndTime)
	cancelFirst()
	require.ErrorIs(t, finiteTestReceive(t, first).err, context.Canceled)
	require.Zero(t, cancellations.Load())
	close(release)
	subset, extended := finiteTestReceive(t, contained), finiteTestReceive(t, tail)
	require.NoError(t, subset.err)
	require.NoError(t, extended.err)
	require.Len(t, subset.data.Results[0].Points, 6)
	require.Len(t, extended.data.Results[0].Points, 7)
	require.Equal(t, 196.0, *extended.data.Results[0].Points[6].Value)
	require.Equal(t, int32(2), provider.queries.Load())
}

func TestFiniteRangeNegativeAndIncompleteCacheEntriesStayExact(t *testing.T) {
	for _, status := range []string{"missing", "failed", "incomplete"} {
		t.Run(status, func(t *testing.T) {
			c, provider, ctx := finiteRangeProvider(t, true)
			provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := finiteRangeResponse(query)
				if provider.queries.Load() == 1 {
					if status == "incomplete" {
						response.Complete = false
					} else {
						response.Results[0].Status = status
						response.Results[0].Points = nil
					}
				}
				return response
			}
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10))).err)
			result := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(2, 7)))
			require.NoError(t, result.err)
			require.True(t, result.data.Complete)
			require.Equal(t, "ok", result.data.Results[0].Status)
			require.Len(t, result.data.Results[0].Points, 6)
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeOffGridDeclarationFailureDoesNotEnterReuse(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := finiteRangeResponse(query)
		if provider.queries.Load() == 1 {
			response.Results[0].Points[0].Time = response.Results[0].Points[0].Time.Add(500 * time.Millisecond)
		}
		return response
	}
	failed := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
	require.Error(t, failed.err)
	second := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
	require.NoError(t, second.err)
	require.Equal(t, finiteRangeTestStart, second.data.Results[0].Points[0].Time)
	require.Equal(t, int32(2), provider.queries.Load())
}

func TestFiniteRangeSubStepDomainNeverReadsOutsideDemand(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	spec := finiteRangeSpec(3, 4)
	spec.EndTime = spec.StartTime.Add(500 * time.Millisecond)
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	query := finiteTestReceive(t, provider.calls)
	require.Equal(t, spec.StartTime, query.StartTime)
	require.Equal(t, spec.EndTime, query.EndTime)
	require.Len(t, result.data.Results[0].Points, 1)
	require.Equal(t, 9.0, *result.data.Results[0].Points[0].Value)
}

type finiteRangeOwner struct{ *finiteTestProvider }

func (p finiteRangeOwner) GetMetricOwnerCatalog(pc *types.PluginContext) (*sdk.MetricOwnerCatalog, error) {
	catalog, err := p.finiteTestProvider.GetMetricOwnerCatalog(pc)
	for i := range catalog.Definitions {
		catalog.Definitions[i].RangeReuse = true
	}
	return catalog, err
}

func TestFiniteRangeOwnerDeclarationDoesNotSurviveBoundSensitiveOverride(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	c.clients["kubernetes"] = finiteRangeOwner{owner}
	provider := addFinitePrivateProvider(t, c)
	close(provider.release)
	provider.catalog = func(_ *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
		catalog := &sdk.ResourceMetricsCatalog{Source: request.Source, MaxTargets: 256}
		for _, definition := range request.Context.Definitions {
			catalog.Metrics = append(catalog.Metrics, sdk.FiniteMetricDescriptor{
				ID: definition.ID, Name: definition.Name, ResourceKey: request.ResourceKey,
				Unit: definition.Unit, Shapes: definition.SupportedShapes, RangeReuse: definition.RangeReuse,
			})
		}
		return catalog, nil
	}
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := finiteRangeResponse(query)
		for _, definition := range query.Context.Definitions {
			if definition.ID != "cpu" || definition.Query != "bounds-sensitive" {
				continue
			}
			for _, result := range response.Results {
				for _, point := range result.Points {
					if point.Value != nil {
						*point.Value = query.EndTime.Sub(finiteRangeTestStart).Seconds()
					}
				}
			}
		}
		return response
	}
	source := finitePrivateSource("one")
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &source})
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10))).err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(2, 7))).err)
	require.Equal(t, int32(1), provider.queries.Load())
	query := "bounds-sensitive"
	_, err = c.SaveMetricBinding(ctx, sdk.MetricBinding{
		Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster",
		Overrides: []sdk.MetricDefinitionOverride{{MetricID: "cpu", Query: &query}},
	})
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10))).err)
	result := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(2, 7)))
	require.NoError(t, result.err)
	require.Equal(t, 7.0, *result.data.Results[0].Points[0].Value)
	require.Equal(t, int32(3), provider.queries.Load(), "an edited definition must not inherit the owner's range promise")
}

func TestFiniteFinishedRangeReaderDoesNotKeepRemainderAlive(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	leftRelease, rightRelease := make(chan struct{}), make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		release := rightRelease
		if query.StartTime.Equal(finiteRangeTestStart) {
			release = leftRelease
		}
		select {
		case <-pc.Context.Done():
			provider.cancelled <- struct{}{}
			return nil, pc.Context.Err()
		case <-release:
			return finiteRangeResponse(query), nil
		}
	}
	left := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
	finiteTestReceive(t, provider.calls)
	tailCtx, cancelTail := context.WithCancel(ctx)
	defer cancelTail()
	tail := finiteTestRead(c, tailCtx, finiteRangeSpec(8, 14))
	finiteTestReceive(t, provider.calls)
	subset := finiteTestRead(c, ctx, finiteRangeSpec(8, 10))
	finiteTestWaiters(t, c.finiteCoordinator(), 3)
	close(leftRelease)
	require.NoError(t, finiteTestReceive(t, left).err)
	require.NoError(t, finiteTestReceive(t, subset).err)
	require.Equal(t, int32(2), provider.queries.Load())
	select {
	case <-provider.cancelled:
		t.Fatal("the remainder still has a live reader")
	default:
	}
	cancelTail()
	require.ErrorIs(t, finiteTestReceive(t, tail).err, context.Canceled)
	finiteTestReceive(t, provider.cancelled)
}
