package metric

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
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

// finiteRangeDispatch starts at most one queued provider call at a chosen
// instant, for coordinators built without their scheduler loop.
func finiteRangeDispatch(f *finiteCoordinator, at time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dispatchAtLocked(at)
}

// finiteRangePausedCoordinator has no scheduler loop: only the test starts
// provider calls, and only registration can attach a reader to running work.
// The range-reuse catalog is already cached. Dispatch at later instants than
// the returned one.
func finiteRangePausedCoordinator(t *testing.T) (*controller, *finiteTestProvider, context.Context, *finiteCoordinator, time.Time) {
	t.Helper()
	c, provider, ctx := finiteRangeProvider(t, true)
	f := &finiteCoordinator{c: c, pending: map[*finiteWaiter]bool{}, jobs: map[*finiteJob]bool{}, epochs: map[metricStreamKey]uint64{}, blocked: map[metricStreamKey]int{}, observations: map[string]*finiteObservation{}, tombstones: map[string]time.Time{}, wake: make(chan struct{}, 1)}
	c.finiteOnce.Do(func() { c.finite.Store(f) })
	catalog := make(chan error, 1)
	go func() {
		_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "core::v1::Pod"})
		catalog <- err
	}()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 1 }, 3*time.Second, time.Millisecond)
	now := time.Now().Add(time.Second)
	finiteRangeDispatch(f, now)
	require.NoError(t, finiteTestReceive(t, catalog))
	return c, provider, ctx, f, now
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

func TestFiniteRangeReaderJoinsRunningWorkBeforeOriginalReaderCancels(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		select {
		case <-pc.Context.Done():
			provider.cancelled <- struct{}{}
			return nil, pc.Context.Err()
		case <-release:
			return finiteRangeResponse(query), nil
		}
	}
	originalCtx, cancelOriginal := context.WithCancel(ctx)
	defer cancelOriginal()
	original := finiteTestRead(c, originalCtx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	// Nothing scans pending readers here, so only registration itself can
	// attach this reader before the original reader cancels.
	joined := finiteTestRead(c, ctx, finiteRangeSpec(2, 7))
	finiteTestWaiters(t, f, 2)
	cancelOriginal()
	require.ErrorIs(t, finiteTestReceive(t, original).err, context.Canceled)
	close(release)
	result := finiteTestReceive(t, joined)
	require.NoError(t, result.err)
	require.True(t, result.data.Complete)
	require.Len(t, result.data.Results[0].Points, 6)
	require.Equal(t, 4.0, *result.data.Results[0].Points[0].Value)
	require.Equal(t, int32(1), provider.queries.Load())
}

func TestFiniteRangeSharedWorkStopsWhenItsLastJoinedReaderCancels(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	provider.query = func(pc *types.PluginContext, _ sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		<-pc.Context.Done()
		provider.cancelled <- struct{}{}
		return nil, pc.Context.Err()
	}
	originalCtx, cancelOriginal := context.WithCancel(ctx)
	defer cancelOriginal()
	joinedCtx, cancelJoined := context.WithCancel(ctx)
	defer cancelJoined()
	original := finiteTestRead(c, originalCtx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	joined := finiteTestRead(c, joinedCtx, finiteRangeSpec(2, 7))
	finiteTestWaiters(t, f, 2)
	cancelOriginal()
	require.ErrorIs(t, finiteTestReceive(t, original).err, context.Canceled)
	cancelJoined()
	require.ErrorIs(t, finiteTestReceive(t, joined).err, context.Canceled)
	finiteTestReceive(t, provider.cancelled)
}

func TestFiniteRangeNegativeAndIncompleteCacheEntriesStayExact(t *testing.T) {
	for _, status := range []string{"missing", "failed", "incomplete"} {
		for _, offGrid := range []bool{false, true} {
			name := status
			if offGrid {
				name += " with off-grid end"
			}
			t.Run(name, func(t *testing.T) {
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
				spec := finiteRangeSpec(0, 10)
				if offGrid {
					spec.EndTime = spec.EndTime.Add(500 * time.Millisecond)
				}
				first := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
				require.NoError(t, first.err)
				wire := finiteTestReceive(t, provider.calls)
				require.Equal(t, spec.StartTime, wire.StartTime)
				require.Equal(t, spec.EndTime, wire.EndTime, "an unfragmented read keeps its original wire bounds")
				again := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
				require.NoError(t, again.err)
				require.Equal(t, first.data.Complete, again.data.Complete)
				require.Equal(t, first.data.Results[0].Status, again.data.Results[0].Status)
				require.Len(t, again.data.Results[0].Points, len(first.data.Results[0].Points))
				require.Equal(t, int32(1), provider.queries.Load(), "the identical read reuses its exact domain")
				result := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(2, 7)))
				require.NoError(t, result.err)
				require.True(t, result.data.Complete)
				require.Equal(t, "ok", result.data.Results[0].Status)
				require.Len(t, result.data.Results[0].Points, 6)
				require.Equal(t, int32(2), provider.queries.Load())
			})
		}
	}
}

func TestFiniteRangeOffGridEndEvaluatesWholeStepsAndSharesItsGridDomain(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	spec := finiteRangeSpec(0, 10)
	spec.EndTime = spec.EndTime.Add(900 * time.Millisecond)
	first := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, first.err)
	require.True(t, first.data.Complete)
	require.Len(t, first.data.Results[0].Points, 11)
	require.Equal(t, finiteRangeTestStart.Add(10*time.Second), first.data.Results[0].Points[10].Time)
	spec.EndTime = finiteRangeTestStart.Add(10*time.Second + 100*time.Millisecond)
	again := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, again.err)
	require.True(t, again.data.Complete)
	require.Len(t, again.data.Results[0].Points, 11)
	require.Equal(t, int32(1), provider.queries.Load(), "another off-grid end evaluates the same grid points")
}

func TestFiniteRangeFragmentsStayOnGridWhileWholeDomainsKeepWireBounds(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(3, 7))).err)
	seed := finiteTestReceive(t, provider.calls)
	require.Equal(t, finiteRangeTestStart.Add(3*time.Second), seed.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), seed.EndTime)
	spec := finiteRangeSpec(0, 10)
	spec.EndTime = spec.EndTime.Add(500 * time.Millisecond)
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.True(t, result.data.Complete)
	require.Len(t, result.data.Results[0].Points, 11)
	left, right := finiteTestReceive(t, provider.calls), finiteTestReceive(t, provider.calls)
	require.Equal(t, spec.StartTime, left.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(3*time.Second), left.EndTime)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), right.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(10*time.Second), right.EndTime, "a fragment is never widened to the off-grid end")
	require.Equal(t, int32(3), provider.queries.Load())
}

func TestFiniteRangeOmittedPointInRefreshedCoverageIsNotRestoredFromOlderEntries(t *testing.T) {
	c, provider, ctx := finiteRangeProvider(t, true)
	omitted := finiteRangeTestStart.Add(5 * time.Second)
	provider.response = func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := finiteRangeResponse(query)
		if query.StartTime.Equal(omitted) {
			// The fresh boundary fetch no longer has a sample at the omitted time.
			response.Results[0].Points = response.Results[0].Points[1:]
		}
		return response
	}
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 5))).err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(7, 10))).err)
	fresh := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
	require.Equal(t, int32(3), provider.queries.Load())
	cached := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
	require.Equal(t, int32(3), provider.queries.Load(), "the identical read is served from completed entries")
	for _, tc := range []struct {
		name string
		got  finiteReply
	}{{"assembled from running work", fresh}, {"assembled from cache", cached}} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, tc.got.err)
			require.True(t, tc.got.data.Complete)
			points := tc.got.data.Results[0].Points
			require.Len(t, points, 10)
			for _, point := range points {
				require.False(t, point.Time.Equal(omitted), "an omitted point must not return from an older entry")
			}
			require.Equal(t, finiteRangeTestStart.Add(4*time.Second), points[4].Time)
			require.Nil(t, points[4].Value, "an explicit source gap stays a gap")
			require.Equal(t, 36.0, *points[5].Value)
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

func TestFiniteRangeBorrowedNonReusableAnswerDoesNotFinishContainedReader(t *testing.T) {
	for _, variant := range []string{"failed", "missing", "incomplete", "absent"} {
		t.Run(variant, func(t *testing.T) {
			c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
			release := make(chan struct{})
			provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
				response := finiteRangeResponse(query)
				if provider.queries.Load() > 1 {
					return response, nil
				}
				select {
				case <-pc.Context.Done():
					return nil, pc.Context.Err()
				case <-release:
				}
				switch variant {
				case "failed", "missing":
					response.Results[0].Status, response.Results[0].Points = variant, nil
				case "incomplete":
					response.Complete = false
				case "absent":
					response.Complete, response.Results = false, nil
				}
				return response, nil
			}
			wide := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
			finiteTestWaiters(t, f, 1)
			finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
			finiteTestReceive(t, provider.calls)
			contained := finiteTestRead(c, ctx, finiteRangeSpec(2, 7))
			finiteTestWaiters(t, f, 2)
			close(release)
			owner := finiteTestReceive(t, wide)
			require.NoError(t, owner.err)
			switch variant {
			case "failed", "missing":
				require.Equal(t, variant, owner.data.Results[0].Status)
			case "incomplete":
				require.False(t, owner.data.Complete)
				require.Len(t, owner.data.Results[0].Points, 11)
			case "absent":
				require.False(t, owner.data.Complete)
				require.Empty(t, owner.data.Results)
			}
			// The contained reader never asked for the wide domain, so that
			// answer cannot finish it. Its own domain is fetched next.
			finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
			own := finiteTestReceive(t, provider.calls)
			require.Equal(t, finiteRangeTestStart.Add(2*time.Second), own.StartTime)
			require.Equal(t, finiteRangeTestStart.Add(7*time.Second), own.EndTime)
			got := finiteTestReceive(t, contained)
			require.NoError(t, got.err)
			require.True(t, got.data.Complete)
			require.Equal(t, "ok", got.data.Results[0].Status)
			require.Len(t, got.data.Results[0].Points, 6)
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeBorrowedFailureWithSameGridButDifferentWireBoundsRetries(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	firstSpec, secondSpec := finiteRangeSpec(0, 10), finiteRangeSpec(0, 10)
	firstSpec.EndTime = firstSpec.EndTime.Add(250 * time.Millisecond)
	secondSpec.EndTime = secondSpec.EndTime.Add(750 * time.Millisecond)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		response := finiteRangeResponse(query)
		if provider.queries.Load() == 1 {
			select {
			case <-pc.Context.Done():
				return nil, pc.Context.Err()
			case <-release:
			}
			response.Results[0].Status, response.Results[0].Points = "failed", nil
		}
		return response, nil
	}
	first := finiteTestRead(c, ctx, firstSpec)
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	second := finiteTestRead(c, ctx, secondSpec)
	finiteTestWaiters(t, f, 2)
	close(release)
	got := finiteTestReceive(t, first)
	require.NoError(t, got.err)
	require.Equal(t, "failed", got.data.Results[0].Status)
	// Wait for the finishing job to release the coordinator before checking
	// whether it incorrectly finalized the different wire-domain borrower.
	f.mu.Lock()
	f.mu.Unlock()
	select {
	case <-second:
		t.Fatal("a shared grid must not transfer failure across different wire bounds")
	default:
	}
	finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
	own := finiteTestReceive(t, provider.calls)
	require.Equal(t, secondSpec.StartTime, own.StartTime)
	require.Equal(t, secondSpec.EndTime, own.EndTime)
	got = finiteTestReceive(t, second)
	require.NoError(t, got.err)
	require.True(t, got.data.Complete)
	require.Equal(t, "ok", got.data.Results[0].Status)
	require.Len(t, got.data.Results[0].Points, 11)
	require.Equal(t, int32(2), provider.queries.Load())
}

func TestFiniteRangeReaderOfTheSameDomainSharesItsFailure(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		select {
		case <-pc.Context.Done():
			return nil, pc.Context.Err()
		case <-release:
		}
		response := finiteRangeResponse(query)
		response.Results[0].Status, response.Results[0].Points = "failed", nil
		return response, nil
	}
	first := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	second := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 2)
	close(release)
	for _, read := range []<-chan finiteReply{first, second} {
		got := finiteTestReceive(t, read)
		require.NoError(t, got.err)
		require.Equal(t, "failed", got.data.Results[0].Status)
	}
	finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
	require.Equal(t, int32(1), provider.queries.Load())
	select {
	case <-provider.calls:
		t.Fatal("a reader of the failed domain must not fetch it again")
	default:
	}
}

func TestFiniteRangeContainedReaderFinishesOnFailureOfItsOwnDomain(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		if provider.queries.Load() == 1 {
			select {
			case <-pc.Context.Done():
				return nil, pc.Context.Err()
			case <-release:
			}
		}
		response := finiteRangeResponse(query)
		response.Results[0].Status, response.Results[0].Points = "failed", nil
		return response, nil
	}
	wide := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	contained := finiteTestRead(c, ctx, finiteRangeSpec(2, 7))
	finiteTestWaiters(t, f, 2)
	close(release)
	owner := finiteTestReceive(t, wide)
	require.NoError(t, owner.err)
	require.Equal(t, "failed", owner.data.Results[0].Status)
	finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
	finiteTestReceive(t, provider.calls)
	got := finiteTestReceive(t, contained)
	require.NoError(t, got.err)
	require.Equal(t, "failed", got.data.Results[0].Status, "the failure of its own domain is final")
	finiteRangeDispatch(f, now.Add(3*finiteDispatchInterval))
	finiteTestWaiters(t, f, 0)
	require.Equal(t, int32(2), provider.queries.Load())
	select {
	case <-provider.calls:
		t.Fatal("a failure of the reader's own domain must not be retried")
	default:
	}
}

func TestFiniteRangeFailureOfAnyFragmentTheReaderStillNeedsIsItsOwn(t *testing.T) {
	c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
	seed := finiteTestRead(c, ctx, finiteRangeSpec(3, 7))
	finiteTestWaiters(t, f, 1)
	finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
	require.NoError(t, finiteTestReceive(t, seed).err)
	finiteTestReceive(t, provider.calls)
	release := make(chan struct{})
	provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		select {
		case <-pc.Context.Done():
			return nil, pc.Context.Err()
		case <-release:
		}
		response := finiteRangeResponse(query)
		response.Results[0].Status, response.Results[0].Points = "failed", nil
		return response, nil
	}
	// The tail's whole remaining domain is [7,10]. The wide reader holds [3,7],
	// so [7,10] is the second of its two fragments, not its first.
	tail := finiteTestRead(c, ctx, finiteRangeSpec(7, 10))
	finiteTestWaiters(t, f, 1)
	wide := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
	finiteTestWaiters(t, f, 2)
	finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
	fetch := finiteTestReceive(t, provider.calls)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), fetch.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(10*time.Second), fetch.EndTime)
	close(release)
	for _, read := range []<-chan finiteReply{tail, wide} {
		got := finiteTestReceive(t, read)
		require.NoError(t, got.err)
		require.Equal(t, "failed", got.data.Results[0].Status)
	}
	finiteRangeDispatch(f, now.Add(3*finiteDispatchInterval))
	require.Equal(t, int32(2), provider.queries.Load())
	select {
	case <-provider.calls:
		t.Fatal("the failed fragment must not be fetched again for a reader that needs exactly it")
	default:
	}
}

func TestFiniteRangeBorrowedProviderFailureRetriesOnlyOperationalFailures(t *testing.T) {
	for _, tc := range []struct {
		name    string
		respond func(sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error)
		retried bool
	}{
		{name: "operational", retried: true, respond: func(sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
			return nil, errors.New("range exceeds the source limit")
		}},
		{name: "contract violation", retried: false, respond: func(query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
			response := finiteRangeResponse(query)
			response.Results[0].Points[0].Time = response.Results[0].Points[0].Time.Add(500 * time.Millisecond)
			return response, nil
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, provider, ctx, f, now := finiteRangePausedCoordinator(t)
			release := make(chan struct{})
			provider.query = func(pc *types.PluginContext, query sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
				if provider.queries.Load() > 1 {
					return finiteRangeResponse(query), nil
				}
				select {
				case <-pc.Context.Done():
					return nil, pc.Context.Err()
				case <-release:
				}
				return tc.respond(query)
			}
			wide := finiteTestRead(c, ctx, finiteRangeSpec(0, 10))
			finiteTestWaiters(t, f, 1)
			finiteRangeDispatch(f, now.Add(finiteDispatchInterval))
			finiteTestReceive(t, provider.calls)
			contained := finiteTestRead(c, ctx, finiteRangeSpec(2, 7))
			finiteTestWaiters(t, f, 2)
			close(release)
			require.Error(t, finiteTestReceive(t, wide).err)
			finiteRangeDispatch(f, now.Add(2*finiteDispatchInterval))
			if !tc.retried {
				// A response that breaks the provider's declared contract fails
				// closed for every reader. It is not a domain-specific failure.
				got := finiteTestReceive(t, contained)
				require.Error(t, got.err)
				require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(got.err))
				require.Equal(t, int32(1), provider.queries.Load())
				return
			}
			finiteTestReceive(t, provider.calls)
			got := finiteTestReceive(t, contained)
			require.NoError(t, got.err)
			require.Len(t, got.data.Results[0].Points, 6)
			require.Equal(t, int32(2), provider.queries.Load())
		})
	}
}

func TestFiniteRangeMetadataBearingResultsNeedNoReuseDeclaration(t *testing.T) {
	observed := finiteRangeTestStart.Add(9 * time.Second)
	withMetadata := func(query sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := finiteRangeResponse(query)
		response.Results[0].ObservedAt = &observed
		response.Results[0].Window = 15 * time.Second
		return response
	}
	t.Run("declared pure series reject range-wide metadata", func(t *testing.T) {
		c, provider, ctx := finiteRangeProvider(t, true)
		provider.response = withMetadata
		got := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
		require.Error(t, got.err)
		require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(got.err))
	})
	t.Run("undeclared results keep their metadata for their exact domain only", func(t *testing.T) {
		c, provider, ctx := finiteRangeProvider(t, false)
		provider.response = withMetadata
		first := finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10)))
		require.NoError(t, first.err)
		require.Equal(t, observed, *first.data.Results[0].ObservedAt)
		require.Equal(t, 15*time.Second, first.data.Results[0].Window)
		require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(0, 10))).err)
		require.Equal(t, int32(1), provider.queries.Load())
		require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteRangeSpec(2, 7))).err)
		require.Equal(t, int32(2), provider.queries.Load(), "metadata-bearing results are never reused across bounds")
	})
}
