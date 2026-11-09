package metric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

type finiteTestConnections struct{}

func (finiteTestConnections) GetConnection(_ context.Context, _, id string) (types.Connection, error) {
	return types.Connection{ID: id}, nil
}

type finiteTestProvider struct {
	calls     chan sdk.ResourceMetricsQuery
	release   chan struct{}
	cancelled chan struct{}
	queries   atomic.Int32
	shapes    []string
	response  func(sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse
	catalog   func(*types.PluginContext, sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error)
	failure   func(sdk.ResourceMetricsQuery) error
	query     func(*types.PluginContext, sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error)
	maxAge    time.Duration
}

func (*finiteTestProvider) GetSupportedResources(*types.PluginContext) (*sdk.ProviderInfo, []sdk.Handler) {
	return &sdk.ProviderInfo{}, nil
}
func (*finiteTestProvider) Query(*types.PluginContext, sdk.QueryRequest) (*sdk.QueryResponse, error) {
	return nil, errors.New("legacy query must not execute")
}
func (*finiteTestProvider) StreamResourceMetrics(context.Context, chan sdk.StreamInput) (chan sdk.StreamOutput, error) {
	return nil, errors.New("legacy stream must not execute")
}
func (p *finiteTestProvider) GetResourceMetricsCatalog(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	if p.catalog != nil {
		return p.catalog(pc, request)
	}
	shapes := p.shapes
	if len(shapes) == 0 {
		shapes = []string{"current"}
	}
	return &sdk.ResourceMetricsCatalog{Source: request.Source, MaxTargets: 256, MaxSampleAge: p.maxAge, Metrics: []sdk.FiniteMetricDescriptor{{ID: "cpu", Name: "CPU", ResourceKey: request.ResourceKey, Unit: "cores", Shapes: shapes}, {ID: "memory", Name: "Memory", ResourceKey: request.ResourceKey, Unit: "bytes", Shapes: shapes}}}, nil
}
func (p *finiteTestProvider) QueryResources(pc *types.PluginContext, q sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
	p.queries.Add(1)
	p.calls <- q
	if p.query != nil {
		return p.query(pc, q)
	}
	select {
	case <-pc.Context.Done():
		select {
		case p.cancelled <- struct{}{}:
		default:
		}
		return nil, pc.Context.Err()
	case <-p.release:
	}
	if p.failure != nil {
		if err := p.failure(q); err != nil {
			return nil, err
		}
	}
	if p.response != nil {
		return p.response(q), nil
	}
	observed := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	out := &sdk.ResourceMetricsResponse{Complete: true}
	for _, target := range q.Targets {
		for _, id := range q.MetricIDs {
			value := 0.25
			if id == "memory" {
				value = 1048576
			}
			out.Results = append(out.Results, sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "ok", Value: &value, ObservedAt: &observed, Window: 30 * time.Second, IdentityScope: "name"})
		}
	}
	return out, nil
}
func finiteTestController(t *testing.T) (*controller, *finiteTestProvider, context.Context) {
	t.Helper()
	p := &finiteTestProvider{calls: make(chan sdk.ResourceMetricsQuery, 16), release: make(chan struct{}), cancelled: make(chan struct{}, 16)}
	c := NewController(logging.NewNop(), nil, finiteTestConnections{}).(*controller)
	c.clients["kubernetes"] = p
	c.SetResourceIdentityGuard(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error) {
		return func(context.Context) error { return nil }, nil
	})
	c.referenceAdmitter = func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		return invocation.NewBoundary(nil).Admit(ctx, op, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: ref.Address.Type, Object: ref.Address.ID})
	}
	t.Cleanup(func() { c.finiteCoordinator().shutdown() })
	return c, p, invocation.NewScope(invocation.TrustedUI).Context(context.Background())
}
func finiteTestSpec(token, object string, ids ...string) MetricsObservationSpec {
	uid := "uid-" + object
	return MetricsObservationSpec{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "core::v1::Pod", Targets: []sdk.ResourceMetricTarget{{Token: token, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "cluster-authority", Type: "core::v1::Pod", ID: object, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "default"}}}, Incarnation: &uid}, Route: resourcev2.AccessRoute{Connection: "cluster"}}}, MetricIDs: ids, Shape: "current"}
}
func finiteTestRead(c *controller, ctx context.Context, spec MetricsObservationSpec) <-chan finiteReply {
	result := make(chan finiteReply, 1)
	go func() {
		data, err := c.ReadFiniteResourceMetrics(ctx, spec)
		result <- finiteReply{data: data, err: err}
	}()
	return result
}
func finiteTestReceive[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("finite coordinator did not settle")
		var zero T
		return zero
	}
}
func finiteTestWaiters(t *testing.T, f *finiteCoordinator, count int) {
	t.Helper()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return f.waiterCountLocked() == count }, 3*time.Second, time.Millisecond)
}

func TestFiniteSubsetJoinProjectsTokensAndOwnsDeliveredValues(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	table := finiteTestRead(c, ctx, finiteTestSpec("table-row", "pod-a", "cpu", "memory"))
	finiteTestReceive(t, p.calls)
	sidebar := finiteTestRead(c, ctx, finiteTestSpec("sidebar", "pod-a", "cpu"))
	finiteTestWaiters(t, c.finiteCoordinator(), 2)
	close(p.release)
	tableResult, sidebarResult := finiteTestReceive(t, table), finiteTestReceive(t, sidebar)
	require.NoError(t, tableResult.err)
	require.NoError(t, sidebarResult.err)
	require.Equal(t, int32(1), p.queries.Load())
	require.Len(t, tableResult.data.Results, 2)
	require.Len(t, sidebarResult.data.Results, 1)
	require.Equal(t, "sidebar", sidebarResult.data.Results[0].ResourceToken)
	require.Equal(t, "cpu", sidebarResult.data.Results[0].MetricID)
	*sidebarResult.data.Results[0].Value = 999
	cached := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("new-token", "pod-a", "cpu")))
	require.NoError(t, cached.err)
	require.Equal(t, 0.25, *cached.data.Results[0].Value)
	require.Equal(t, "new-token", cached.data.Results[0].ResourceToken)
	require.Equal(t, int32(1), p.queries.Load())
}
func TestFiniteCancellationWaitsForFinalInterestedReader(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	firstCtx, cancelFirst := context.WithCancel(ctx)
	defer cancelFirst()
	secondCtx, cancelSecond := context.WithCancel(ctx)
	defer cancelSecond()
	first := finiteTestRead(c, firstCtx, finiteTestSpec("one", "pod-a", "cpu"))
	finiteTestReceive(t, p.calls)
	second := finiteTestRead(c, secondCtx, finiteTestSpec("two", "pod-a", "cpu"))
	finiteTestWaiters(t, c.finiteCoordinator(), 2)
	cancelFirst()
	require.ErrorIs(t, finiteTestReceive(t, first).err, context.Canceled)
	finiteTestWaiters(t, c.finiteCoordinator(), 1)
	select {
	case <-p.cancelled:
		t.Fatal("one reader cancelled another reader's provider work")
	default:
	}
	cancelSecond()
	require.ErrorIs(t, finiteTestReceive(t, second).err, context.Canceled)
	finiteTestReceive(t, p.cancelled)
}
func TestFiniteRetirementIsConnectionScopedAndFencesLateResults(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	old := finiteTestRead(c, ctx, finiteTestSpec("old", "pod-a", "cpu"))
	finiteTestReceive(t, p.calls)
	releaseOther := c.BeginConnectionChange("kubernetes", "other-cluster")
	releaseOther()
	finiteTestWaiters(t, c.finiteCoordinator(), 1)
	release := c.BeginConnectionChange("kubernetes", "cluster")
	require.Error(t, finiteTestReceive(t, old).err)
	finiteTestReceive(t, p.cancelled)
	release()
	close(p.release)
	fresh := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("fresh", "pod-a", "cpu")))
	require.NoError(t, fresh.err)
	require.Equal(t, int32(2), p.queries.Load())
	require.Equal(t, "fresh", fresh.data.Results[0].ResourceToken)
}
func TestFiniteCacheDeliveryReadmitsEverySubscriber(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("initial", "pod-a", "cpu"))).err)
	original := c.referenceAdmitter
	var admissions atomic.Int32
	c.referenceAdmitter = func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		if admissions.Add(1) >= 2 {
			return ctx, finiteError("DENIED", "Permission revoked before cache delivery.")
		}
		return original(ctx, op, plugin, route, ref)
	}
	denied := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("denied", "pod-a", "cpu")))
	require.Error(t, denied.err)
	require.Nil(t, denied.data)
	require.Equal(t, int32(1), p.queries.Load())
}
func TestFiniteObservationCloseBeforeOpenAndSessionOwnership(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	require.NoError(t, c.CloseMetricsObservation(ctx, "late"))
	_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "late", Spec: finiteTestSpec("row", "pod-a", "cpu")}, nil)
	require.Error(t, err)
	events := make(chan MetricsObservationSnapshot, 8)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "active", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
	require.NoError(t, err)
	require.Nil(t, opened.Data)
	select {
	case <-p.calls:
		t.Fatal("Open started collection before Attach")
	default:
	}
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	require.Error(t, c.AttachMetricsObservation(foreign, "active"))
	require.NoError(t, c.AttachMetricsObservation(ctx, "active"))
	finiteTestReceive(t, p.calls)
	c.RetireMetricsSession(foreign)
	finiteTestWaiters(t, c.finiteCoordinator(), 1)
	c.RetireMetricsSession(ctx)
	finiteTestReceive(t, p.cancelled)
}

func TestFinitePendingUnionDoesNotCreateUnrequestedCartesianPairs(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	// Warm discovery, then hold sample admission until all interests queue.
	_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "core::v1::Pod"})
	require.NoError(t, err)
	f := c.finiteCoordinator()
	f.mu.Lock()
	f.nextDispatch = time.Now().Add(time.Hour)
	f.mu.Unlock()
	a := finiteTestRead(c, ctx, finiteTestSpec("table-a", "pod-a", "cpu", "memory"))
	b := finiteTestRead(c, ctx, finiteTestSpec("table-b", "pod-b", "cpu"))
	sidebar := finiteTestRead(c, ctx, finiteTestSpec("sidebar", "pod-a", "cpu"))
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pending) == 3 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	for w := range f.pending {
		w.queued = time.Now().Add(-time.Second)
	}
	f.nextDispatch = time.Time{}
	now := time.Now()
	f.dispatchAtLocked(now)
	f.dispatchAtLocked(now.Add(finiteDispatchInterval))
	f.mu.Unlock()
	queries := []sdk.ResourceMetricsQuery{finiteTestReceive(t, p.calls), finiteTestReceive(t, p.calls)}
	pairs := map[string]bool{}
	for _, query := range queries {
		for _, target := range query.Targets {
			for _, id := range query.MetricIDs {
				pair := target.Reference.Address.ID + "/" + id
				require.False(t, pairs[pair], "pair executed twice")
				pairs[pair] = true
			}
		}
	}
	require.Equal(t, map[string]bool{"pod-a/cpu": true, "pod-a/memory": true, "pod-b/cpu": true}, pairs)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, a).err)
	require.NoError(t, finiteTestReceive(t, b).err)
	projected := finiteTestReceive(t, sidebar)
	require.NoError(t, projected.err)
	require.Len(t, projected.data.Results, 1)
	require.Equal(t, "sidebar", projected.data.Results[0].ResourceToken)
}

func TestFiniteManualRefreshJoinsFlightAndKeepsPollingDeadline(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	events := make(chan MetricsObservationSnapshot, 16)
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.IntervalMs = 60000
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "manual", Spec: spec}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NotNil(t, opened.Catalog)
	require.Equal(t, "cores", opened.Catalog.Metrics[0].Unit)
	require.NoError(t, c.AttachMetricsObservation(ctx, "manual"))
	finiteTestReceive(t, p.calls)
	f := c.finiteCoordinator()
	finiteTestWaiters(t, f, 1)
	owner, err := finiteIdentity(ctx)
	require.NoError(t, err)
	key := finiteObservationKey(owner, "manual")
	f.mu.Lock()
	deadline := f.observations[key].due
	f.mu.Unlock()
	require.NoError(t, c.RefreshMetricsObservation(ctx, "manual"))
	close(p.release)
	for {
		snapshot := finiteTestReceive(t, events)
		if snapshot.Data != nil {
			require.NotNil(t, snapshot.Catalog)
			require.Equal(t, opened.Catalog.Source, snapshot.Catalog.Source)
			break
		}
	}
	f.mu.Lock()
	afterJoin := f.observations[key].due
	f.mu.Unlock()
	require.Equal(t, deadline, afterJoin)
	require.Equal(t, int32(1), p.queries.Load(), "refresh duplicated an active provider flight")
	require.NoError(t, c.RefreshMetricsObservation(ctx, "manual"))
	finiteTestReceive(t, p.calls)
	for {
		snapshot := finiteTestReceive(t, events)
		if snapshot.Data != nil && !snapshot.Fetching {
			break
		}
	}
	f.mu.Lock()
	afterManual := f.observations[key].due
	f.mu.Unlock()
	require.Equal(t, deadline, afterManual)
	require.Equal(t, int32(2), p.queries.Load(), "manual refresh reused completed cache")
}

func TestFiniteManualRefreshUpgradesCachedPairsWithoutRepeatingActivePairs(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("warm", "pod-a", "cpu"))).err)
	finiteTestReceive(t, p.calls)
	p.release = make(chan struct{})
	events := make(chan MetricsObservationSnapshot, 16)
	_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "upgrade", Spec: finiteTestSpec("row", "pod-a", "cpu", "memory")}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "upgrade"))
	memory := finiteTestReceive(t, p.calls)
	require.Equal(t, []string{"memory"}, memory.MetricIDs)
	require.NoError(t, c.RefreshMetricsObservation(ctx, "upgrade"))
	cpu := finiteTestReceive(t, p.calls)
	require.Equal(t, []string{"cpu"}, cpu.MetricIDs)
	close(p.release)
	for {
		snapshot := finiteTestReceive(t, events)
		if snapshot.Data != nil {
			require.Len(t, snapshot.Data.Results, 2)
			require.True(t, snapshot.Data.Complete)
			break
		}
	}
	require.Equal(t, int32(3), p.queries.Load(), "manual refresh repeated a still-active pair")
}

func TestFiniteManualRefreshCompletesPartiallyCoveredRangeWithFreshCachedSpan(t *testing.T) {
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
		}
		response := finiteRangeResponse(query)
		for _, result := range response.Results {
			for _, point := range result.Points {
				if point.Value != nil {
					*point.Value += 1000
				}
			}
		}
		return response, nil
	}
	spec := finiteRangeSpec(0, 10)
	events := make(chan MetricsObservationSnapshot, 32)
	_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "partial-refresh", Spec: spec}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "partial-refresh"))
	nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && snapshot.Fetching && !snapshot.Data.Complete
	})
	left, right := finiteTestReceive(t, provider.calls), finiteTestReceive(t, provider.calls)
	require.Equal(t, spec.StartTime, left.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), right.StartTime)
	require.NoError(t, c.RefreshMetricsObservation(ctx, "partial-refresh"))
	require.NoError(t, c.RefreshMetricsObservation(ctx, "partial-refresh"))
	cachedSpan := finiteTestReceive(t, provider.calls)
	require.Equal(t, finiteRangeTestStart.Add(3*time.Second), cachedSpan.StartTime)
	require.Equal(t, finiteRangeTestStart.Add(7*time.Second), cachedSpan.EndTime)
	close(release)
	complete := nextFiniteSnapshot(t, events, func(snapshot MetricsObservationSnapshot) bool {
		return snapshot.Data != nil && !snapshot.Fetching
	})
	require.Empty(t, complete.Error)
	require.True(t, complete.Data.Complete)
	points := complete.Data.Results[0].Points
	require.Len(t, points, 11)
	for i, point := range points {
		if i == 4 {
			require.Nil(t, point.Value, "a source gap must not become zero")
			continue
		}
		require.NotNil(t, point.Value)
		require.Equal(t, float64(i*i)+1000, *point.Value, "point %d kept stale cached coverage", i)
	}
	require.Equal(t, int32(4), provider.queries.Load(), "refresh duplicated provider work")
}

func TestFiniteCloseCancelsOpenBeforeAcknowledgement(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	entered := make(chan struct{})
	c.referenceAdmitter = func(work context.Context, _, _ string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
		close(entered)
		<-work.Done()
		return work, work.Err()
	}
	opened := make(chan error, 1)
	go func() {
		_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "pending", Spec: finiteTestSpec("row", "pod-a", "cpu")}, nil)
		opened <- err
	}()
	finiteTestReceive(t, entered)
	require.Error(t, c.AttachMetricsObservation(ctx, "pending"), "Attach crossed an unfinished Open barrier")
	require.NoError(t, c.CloseMetricsObservation(ctx, "pending"))
	require.ErrorIs(t, finiteTestReceive(t, opened), context.Canceled)
	require.Zero(t, p.queries.Load(), "pending Open collected samples")
	f := c.finiteCoordinator()
	f.mu.Lock()
	remaining := len(f.observations)
	tombstones := len(f.tombstones)
	f.mu.Unlock()
	require.Zero(t, remaining)
	require.Equal(t, 1, tombstones)
}

func TestFiniteAssembledResponseEnforcesAggregateLimits(t *testing.T) {
	for _, test := range []struct {
		name      string
		points    int
		message   int
		wantLimit bool
	}{
		{name: "point boundary", points: sdk.MaxFinitePoints / 2},
		{name: "point overflow", points: sdk.MaxFinitePoints/2 + 1, wantLimit: true},
		{name: "byte boundary", message: finiteMaxBytes/2 - 1024},
		{name: "byte overflow", message: finiteMaxBytes / 2, wantLimit: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, p, ctx := finiteTestController(t)
			spec := finiteTestSpec("aggregate", "pod-a", "cpu", "memory")
			if test.points > 0 {
				p.shapes = []string{"range"}
				spec.Shape = "range"
				spec.StartTime = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
				spec.EndTime = spec.StartTime.Add(time.Duration(test.points-1) * time.Second)
				spec.StepMs = 1000
			}
			p.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
				response := &sdk.ResourceMetricsResponse{Complete: true}
				for _, target := range q.Targets {
					for _, id := range q.MetricIDs {
						result := sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "missing", Message: strings.Repeat("x", test.message)}
						if test.points > 0 {
							result.Status = "ok"
							result.Points = make([]sdk.ResourceMetricPoint, test.points)
							for i := range result.Points {
								value := float64(i)
								result.Points[i] = sdk.ResourceMetricPoint{Time: q.StartTime.Add(time.Duration(i) * time.Second), Value: &value}
							}
						}
						response.Results = append(response.Results, result)
					}
				}
				return response
			}
			close(p.release)
			cpu := spec
			cpu.MetricIDs = []string{"cpu"}
			require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, cpu)).err, "first contributor must fit individually")
			finiteTestReceive(t, p.calls)
			p.release = make(chan struct{})
			memory := spec
			memory.MetricIDs = []string{"memory"}
			active := finiteTestRead(c, ctx, memory)
			finiteTestReceive(t, p.calls)
			aggregate := finiteTestRead(c, ctx, spec)
			finiteTestWaiters(t, c.finiteCoordinator(), 2)
			close(p.release)
			require.NoError(t, finiteTestReceive(t, active).err, "second contributor must fit individually")
			for _, reply := range []finiteReply{
				finiteTestReceive(t, aggregate),
				finiteTestReceive(t, finiteTestRead(c, ctx, spec)),
			} {
				if test.wantLimit {
					require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(reply.err))
					require.Nil(t, reply.data, "overflow must fail, not publish a truncated response")
				} else {
					require.NoError(t, reply.err)
					require.True(t, reply.data.Complete)
					require.Len(t, reply.data.Results, 2)
					if test.points > 0 {
						require.Equal(t, sdk.MaxFinitePoints, len(reply.data.Results[0].Points)+len(reply.data.Results[1].Points))
					}
				}
			}
			require.Equal(t, int32(2), p.queries.Load(), "assembly must reuse cached and active contributors")
		})
	}
}

func TestFiniteProjectedResponseEnforcesCallerTokenByteBudget(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	p.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := &sdk.ResourceMetricsResponse{Complete: true, Results: []sdk.ResourceMetricResult{{
			ResourceToken: q.Targets[0].Token, MetricID: "cpu", Status: "missing",
		}}}
		encoded, err := json.Marshal(response)
		require.NoError(t, err)
		response.Results[0].Message = strings.Repeat("x", finiteMaxBytes-len(encoded))
		return response
	}
	close(p.release)
	// Quotes grow under JSON escaping, unlike the canonical hexadecimal token.
	spec := finiteTestSpec(strings.Repeat("\"", 128), "pod-a", "cpu")
	reply := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(reply.err))
	require.Nil(t, reply.data)
	// A short subscriber can still use the same cached source response.
	spec.Targets[0].Token = "row"
	reply = finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, reply.err)
	require.Equal(t, "row", reply.data.Results[0].ResourceToken)
	require.Equal(t, int32(1), p.queries.Load())
}

func TestFiniteAssembledResponsePreservesDeduplicatedCacheAndJobWarnings(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	p.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		response := &sdk.ResourceMetricsResponse{Complete: true, Warnings: []string{"shared"}}
		for _, target := range q.Targets {
			for _, id := range q.MetricIDs {
				response.Results = append(response.Results, sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "missing"})
				response.Warnings = append(response.Warnings, target.Reference.Address.ID+"/"+id, "shared")
			}
		}
		return response
	}
	close(p.release)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("warm", "pod-a", "cpu"))).err)
	finiteTestReceive(t, p.calls)
	p.release = make(chan struct{})
	memoryA := finiteTestRead(c, ctx, finiteTestSpec("memory-a", "pod-a", "memory"))
	finiteTestReceive(t, p.calls)
	cpuB := finiteTestRead(c, ctx, finiteTestSpec("cpu-b", "pod-b", "cpu"))
	finiteTestReceive(t, p.calls)
	spec := finiteTestSpec("row-a", "pod-a", "cpu", "memory")
	spec.Targets = append(spec.Targets, finiteTestSpec("row-b", "pod-b", "cpu").Targets[0])
	aggregate := finiteTestRead(c, ctx, spec)
	last := finiteTestReceive(t, p.calls)
	require.Equal(t, []string{"memory"}, last.MetricIDs)
	require.Equal(t, "pod-b", last.Targets[0].Reference.Address.ID)
	finiteTestWaiters(t, c.finiteCoordinator(), 3)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, memoryA).err)
	require.NoError(t, finiteTestReceive(t, cpuB).err)
	for _, reply := range []finiteReply{
		finiteTestReceive(t, aggregate),
		finiteTestReceive(t, finiteTestRead(c, ctx, spec)),
	} {
		require.NoError(t, reply.err)
		require.True(t, reply.data.Complete)
		require.Len(t, reply.data.Results, 4)
		require.ElementsMatch(t, []string{"shared", "pod-a/cpu", "pod-a/memory", "pod-b/cpu", "pod-b/memory"}, reply.data.Warnings)
	}
	require.Equal(t, int32(4), p.queries.Load(), "cached delivery must retain every contributor warning without recollection")
}

func TestFiniteDiscoveryCatalogRemainsFullAfterSubsetCollection(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	events := make(chan MetricsObservationSnapshot, 16)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "discovery", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.Len(t, opened.Catalog.Metrics, 2)
	require.NoError(t, c.AttachMetricsObservation(ctx, "discovery"))
	query := finiteTestReceive(t, p.calls)
	require.Equal(t, []string{"cpu"}, query.MetricIDs)
	collected := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Len(t, collected.Catalog.Metrics, 1)
	require.Equal(t, "cores", collected.Catalog.Metrics[0].Unit)
	require.Len(t, collected.Data.Results, 1)
	require.Equal(t, "cpu", collected.Data.Results[0].MetricID)
	discovery, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(finiteTestSpec("row", "pod-a", "cpu")))
	require.NoError(t, err)
	require.Equal(t, opened.Catalog, discovery)
}

func TestFiniteObservationRetainsOperationalFailureButClearsAuthorityFailure(t *testing.T) {
	for _, code := range []string{"RESOURCE_LIMIT", "TIMEOUT", "UNAVAILABLE", "PROVIDER_ERROR", "INTERNAL", "DENIED", "FORBIDDEN", "RESET_REQUIRED", "INVALID_REQUEST"} {
		t.Run(code, func(t *testing.T) {
			c, p, ctx := finiteTestController(t)
			close(p.release)
			var fail atomic.Bool
			p.failure = func(sdk.ResourceMetricsQuery) error {
				if !fail.Load() {
					return nil
				}
				if code == "INTERNAL" {
					return errors.New("provider transport failed")
				}
				return finiteError(code, "provider failure")
			}
			events := make(chan MetricsObservationSnapshot, 16)
			_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "failure", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
			require.NoError(t, err)
			require.NoError(t, c.AttachMetricsObservation(ctx, "failure"))
			initial := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
			f := c.finiteCoordinator()
			f.mu.Lock()
			beforeBytes := f.snapshotBytes
			f.mu.Unlock()
			fail.Store(true)
			require.NoError(t, c.RefreshMetricsObservation(ctx, "failure"))
			failed := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Error != "" && !s.Fetching })
			require.NotEmpty(t, failed.Error)
			operational := code == "RESOURCE_LIMIT" || code == "TIMEOUT" || code == "UNAVAILABLE" || code == "PROVIDER_ERROR" || code == "INTERNAL"
			if operational {
				require.False(t, failed.Invalidated)
				require.Equal(t, initial.Data, failed.Data)
				require.Equal(t, initial.Catalog, failed.Catalog)
			} else {
				require.True(t, failed.Invalidated)
				require.Nil(t, failed.Data)
				require.Nil(t, failed.Catalog)
			}
			f.mu.Lock()
			afterBytes := f.snapshotBytes
			f.mu.Unlock()
			if operational {
				require.Equal(t, beforeBytes, afterBytes)
			} else {
				require.Zero(t, afterBytes)
			}
		})
	}
}

func TestFiniteMixedRangeRefreshRetainsCompleteSnapshotThroughLaterSourceFailure(t *testing.T) {
	for _, code := range []string{"UNAVAILABLE", "DENIED"} {
		t.Run(code, func(t *testing.T) { testFiniteMixedRangeRefresh(t, code) })
	}
}

// The default source answers CPU and a second source answers memory, so every
// collection reads its two lanes in order and the second lane fails on demand.
func testFiniteMixedRangeRefresh(t *testing.T, code string) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	external.response = finiteRangeResponse
	var fail atomic.Bool
	external.failure = func(q sdk.ResourceMetricsQuery) error {
		if fail.Load() && q.Source.ConnectionID == "two" {
			return finiteError(code, "later source failure")
		}
		return nil
	}
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	// Every collection resolves a newer window, which retained history must not adopt.
	spec.Shape, spec.DurationMs, spec.StepMs = "range", 1000, 100
	events := make(chan MetricsObservationSnapshot, 32)
	_, err = c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "mixed-refresh", Spec: spec}, func(s MetricsObservationSnapshot) { events <- s })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "mixed-refresh"))
	// With nothing retained, the first source still reports honest progress.
	progress := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && s.Fetching })
	require.False(t, progress.Data.Complete)
	require.Len(t, progress.Data.Results, 1)
	require.Equal(t, "cpu", progress.Data.Results[0].MetricID)
	initial := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Empty(t, initial.Error)
	require.True(t, initial.Data.Complete)
	require.Len(t, initial.Data.Results, 2)
	require.Len(t, initial.Catalog.Metrics, 2)
	require.NotNil(t, initial.DomainStart)
	require.NotNil(t, initial.DomainEnd)
	f := c.finiteCoordinator()
	f.mu.Lock()
	beforeBytes := f.snapshotBytes
	f.mu.Unlock()
	require.Positive(t, beforeBytes)
	for range 2 {
		finiteTestReceive(t, external.calls)
	}
	fail.Store(true)
	require.NoError(t, c.RefreshMetricsObservation(ctx, "mixed-refresh"))
	var refreshing []MetricsObservationSnapshot
	failed := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool {
		refreshing = append(refreshing, s)
		return s.Error != "" && !s.Fetching
	})
	// The first source answered for a newer window, then the later source failed.
	refreshed := finiteTestReceive(t, external.calls)
	require.Equal(t, one, refreshed.Source)
	require.True(t, refreshed.StartTime.After(*initial.DomainStart))
	require.Equal(t, two, finiteTestReceive(t, external.calls).Source)
	// No frame before the outcome may replace retained history with a fragment.
	for _, frame := range refreshing[:len(refreshing)-1] {
		require.Equal(t, initial.Data, frame.Data, "the first source must not replace the retained snapshot")
		require.Equal(t, initial.Catalog, frame.Catalog)
		require.Equal(t, initial.DomainStart, frame.DomainStart)
		require.Equal(t, initial.DomainEnd, frame.DomainEnd)
		require.False(t, frame.Invalidated)
	}
	require.Contains(t, failed.Error, "later source failure")
	f.mu.Lock()
	afterBytes := f.snapshotBytes
	f.mu.Unlock()
	if code == "UNAVAILABLE" {
		require.False(t, failed.Invalidated)
		require.Equal(t, initial.Data, failed.Data)
		require.Equal(t, initial.Catalog, failed.Catalog)
		require.Equal(t, initial.DomainStart, failed.DomainStart)
		require.Equal(t, initial.DomainEnd, failed.DomainEnd)
		require.Equal(t, beforeBytes, afterBytes)
	} else {
		require.True(t, failed.Invalidated)
		require.Nil(t, failed.Data)
		require.Nil(t, failed.Catalog)
		require.Nil(t, failed.DomainStart)
		require.Nil(t, failed.DomainEnd)
		require.Zero(t, afterBytes)
	}
	// Only a refresh in which every source succeeds replaces the snapshot.
	fail.Store(false)
	require.NoError(t, c.RefreshMetricsObservation(ctx, "mixed-refresh"))
	recovered := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && s.Data.Complete && !s.Fetching })
	require.Empty(t, recovered.Error)
	require.False(t, recovered.Invalidated)
	require.True(t, recovered.DomainStart.After(*initial.DomainStart))
}

func TestFiniteObservationAdmissionFailureClearsRetainedSamples(t *testing.T) {
	for _, code := range []string{"DENIED", "TIMEOUT", "UNAVAILABLE"} {
		t.Run(code, func(t *testing.T) {
			c, p, ctx := finiteTestController(t)
			close(p.release)
			var denied atomic.Bool
			original := c.referenceAdmitter
			c.referenceAdmitter = func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
				if denied.Load() {
					return ctx, finiteError(code, "admission failed")
				}
				return original(ctx, op, plugin, route, ref)
			}
			events := make(chan MetricsObservationSnapshot, 16)
			_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "admission", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
			require.NoError(t, err)
			require.NoError(t, c.AttachMetricsObservation(ctx, "admission"))
			nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
			denied.Store(true)
			require.NoError(t, c.RefreshMetricsObservation(ctx, "admission"))
			failed := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Error != "" && !s.Fetching })
			require.True(t, failed.Invalidated)
			require.Nil(t, failed.Data)
			require.Nil(t, failed.Catalog)
			require.Equal(t, int32(1), p.queries.Load())
		})
	}
}

func TestFiniteViewportDemandReusesCompletedPairsAcrossTwentyThousandTargetInventory(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	inventory := make([]sdk.ResourceMetricTarget, 20000)
	for i := range inventory {
		inventory[i] = finiteTestSpec(fmt.Sprintf("row-%d", i), fmt.Sprintf("pod-%d", i), "cpu").Targets[0]
	}
	viewport := func(start int) MetricsObservationSpec {
		spec := finiteTestSpec("unused", "unused", "cpu")
		spec.Targets = append([]sdk.ResourceMetricTarget(nil), inventory[start:start+32]...)
		return spec
	}
	first := finiteTestReceive(t, finiteTestRead(c, ctx, viewport(0)))
	require.NoError(t, first.err)
	initialQuery := finiteTestReceive(t, p.calls)
	require.Len(t, initialQuery.Targets, 32)
	require.Equal(t, []string{"cpu"}, initialQuery.MetricIDs)
	second := finiteTestReceive(t, finiteTestRead(c, ctx, viewport(10000)))
	require.NoError(t, second.err)
	secondQuery := finiteTestReceive(t, p.calls)
	require.Len(t, secondQuery.Targets, 32)
	expected := map[string]bool{}
	for _, target := range inventory[10000:10032] {
		expected[target.Reference.Address.ID] = true
	}
	for _, target := range secondQuery.Targets {
		require.True(t, expected[target.Reference.Address.ID], "provider must see only viewport demand")
	}
	// Advance retention age without sleeping. The former two-second cache
	// would expire; the new subscriber must retain samples, not redate them.
	f := c.finiteCoordinator()
	f.mu.Lock()
	for i := range f.cache {
		f.cache[i].until = f.cache[i].until.Add(-3 * time.Second)
	}
	f.mu.Unlock()
	reentered := viewport(0)
	for i := range reentered.Targets {
		reentered.Targets[i].Token = fmt.Sprintf("reentered-%d", i)
	}
	reused := finiteTestReceive(t, finiteTestRead(c, ctx, reentered))
	require.NoError(t, reused.err)
	require.Equal(t, int32(2), p.queries.Load(), "returning viewport must reuse completed exact pairs")
	require.Len(t, reused.data.Results, 32)
	for _, result := range reused.data.Results {
		require.True(t, strings.HasPrefix(result.ResourceToken, "reentered-"))
		require.Equal(t, first.data.Results[0].ObservedAt, result.ObservedAt)
		require.Equal(t, first.data.Results[0].Window, result.Window)
		require.Equal(t, first.data.Results[0].IdentityScope, result.IdentityScope)
	}
}

func TestFiniteCompletedReuseHonorsKnownSampleAgeAndRetentionExpiry(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	p.maxAge = time.Second
	observed := time.Now().Add(-2 * time.Second)
	p.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		value := 1.0
		return &sdk.ResourceMetricsResponse{Complete: true, Results: []sdk.ResourceMetricResult{{ResourceToken: q.Targets[0].Token, MetricID: "cpu", Status: "ok", Value: &value, ObservedAt: &observed}}}
	}
	spec := finiteTestSpec("row", "pod-a", "cpu")
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(2), p.queries.Load(), "known stale sample cannot satisfy new demand")
	f := c.finiteCoordinator()
	f.mu.Lock()
	for i := range f.cache {
		f.cache[i].until = time.Now().Add(-time.Second)
	}
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(3), p.queries.Load())
}

func finiteTestPausedCoordinator(t *testing.T) (*controller, *finiteTestProvider, context.Context, *finiteCoordinator, time.Time) {
	t.Helper()
	c, p, ctx := finiteTestController(t)
	f := &finiteCoordinator{c: c, pending: map[*finiteWaiter]bool{}, jobs: map[*finiteJob]bool{}, epochs: map[metricStreamKey]uint64{}, blocked: map[metricStreamKey]int{}, observations: map[string]*finiteObservation{}, tombstones: map[string]time.Time{}, wake: make(chan struct{}, 1)}
	c.finiteOnce.Do(func() { c.finite.Store(f) })
	catalog := make(chan error, 1)
	go func() {
		_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "core::v1::Pod"})
		catalog <- err
	}()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 1 }, 3*time.Second, time.Millisecond)
	now := time.Now().Add(time.Second)
	f.mu.Lock()
	f.dispatchAtLocked(now)
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, catalog))
	return c, p, ctx, f, now
}

func TestFiniteDispatchCoalescesChurnAndOldestCPUAndCatalogMakeProgress(t *testing.T) {
	c, p, ctx, f, now := finiteTestPausedCoordinator(t)
	old := finiteTestRead(c, ctx, finiteTestSpec("old", "old-cpu", "cpu"))
	finiteTestWaiters(t, f, 1)
	f.mu.Lock()
	for w := range f.pending {
		w.queued = now.Add(-3 * time.Second)
	}
	f.mu.Unlock()
	memory := finiteTestRead(c, ctx, finiteTestSpec("memory", "memory", "memory"))
	finiteTestWaiters(t, f, 2)
	catalog := make(chan error, 1)
	go func() {
		_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "other", ResourceKey: "core::v1::Pod"})
		catalog <- err
	}()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 2 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	for _, read := range f.catalogs {
		if !read.finished {
			read.queued = now.Add(-2 * time.Second)
		}
	}
	f.dispatchAtLocked(now.Add(finiteDispatchInterval))
	f.mu.Unlock()
	require.Equal(t, "old-cpu", finiteTestReceive(t, p.calls).Targets[0].Reference.Address.ID)
	// Repeated wake-ups and replacements within one interval cannot create
	// starts. They also cannot displace the older queued catalog or memory.
	for i := range 40 {
		churnCtx, cancel := context.WithCancel(ctx)
		churn := finiteTestRead(c, churnCtx, finiteTestSpec("churn", fmt.Sprintf("churn-%d", i), "cpu"))
		finiteTestWaiters(t, f, 3)
		f.mu.Lock()
		f.dispatchAtLocked(now.Add(finiteDispatchInterval + time.Duration(i+1)*time.Millisecond))
		f.mu.Unlock()
		cancel()
		require.ErrorIs(t, finiteTestReceive(t, churn).err, context.Canceled)
	}
	require.Equal(t, int32(1), p.queries.Load())
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(2 * finiteDispatchInterval))
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, catalog))
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(3 * finiteDispatchInterval))
	f.mu.Unlock()
	require.Equal(t, "memory", finiteTestReceive(t, p.calls).Targets[0].Reference.Address.ID)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, old).err)
	require.NoError(t, finiteTestReceive(t, memory).err)
}

func TestFiniteCatalogWaitsForCapacityAndQueuedCancellationDoesNotStartProvider(t *testing.T) {
	c, p, ctx, f, now := finiteTestPausedCoordinator(t)
	reads := make([]<-chan finiteReply, finiteMaxJobs)
	cancels := make([]context.CancelFunc, finiteMaxJobs)
	for i := range reads {
		var readCtx context.Context
		readCtx, cancels[i] = context.WithCancel(ctx)
		defer cancels[i]()
		reads[i] = finiteTestRead(c, readCtx, finiteTestSpec("row", fmt.Sprintf("pod-%d", i), "cpu"))
		finiteTestWaiters(t, f, i+1)
		f.mu.Lock()
		f.dispatchAtLocked(now.Add(time.Duration(i+1) * finiteDispatchInterval))
		f.mu.Unlock()
		finiteTestReceive(t, p.calls)
	}
	var catalogCalls atomic.Int32
	defaultCatalog := &finiteTestProvider{}
	p.catalog = func(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
		catalogCalls.Add(1)
		return defaultCatalog.GetResourceMetricsCatalog(pc, request)
	}
	readCatalog := func(readCtx context.Context, connection string) <-chan error {
		result := make(chan error, 1)
		go func() {
			_, err := c.GetResourceMetricsCatalog(readCtx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: connection, ResourceKey: "core::v1::Pod"})
			result <- err
		}()
		return result
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	canceled := readCatalog(cancelCtx, "canceled")
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 2 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(5 * finiteDispatchInterval))
	f.mu.Unlock()
	require.Zero(t, catalogCalls.Load())
	cancel()
	require.ErrorIs(t, finiteTestReceive(t, canceled), context.Canceled)
	waiting := readCatalog(ctx, "waiting")
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 2 }, 3*time.Second, time.Millisecond)
	cancels[0]()
	require.ErrorIs(t, finiteTestReceive(t, reads[0]).err, context.Canceled)
	finiteTestReceive(t, p.cancelled)
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.jobs) == 3 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(6 * finiteDispatchInterval))
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, waiting))
	require.Equal(t, int32(1), catalogCalls.Load())
	close(p.release)
	for _, read := range reads[1:] {
		require.NoError(t, finiteTestReceive(t, read).err)
	}
}

func TestFiniteObservationCloseReopenReusesSamplesWithoutExtendingExpiry(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	close(p.release)
	open := func(token string) <-chan MetricsObservationSnapshot {
		events := make(chan MetricsObservationSnapshot, 8)
		_, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: token, Spec: finiteTestSpec(token, "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
		require.NoError(t, err)
		require.NoError(t, c.AttachMetricsObservation(ctx, token))
		return events
	}
	first := nextFiniteSnapshot(t, open("first-tab"), func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.NoError(t, c.CloseMetricsObservation(ctx, "first-tab"))
	f := c.finiteCoordinator()
	f.mu.Lock()
	cacheCount := len(f.cache)
	if cacheCount != 1 {
		f.mu.Unlock()
		require.Equal(t, 1, cacheCount)
		return
	}
	expiry := f.cache[0].until.Add(-3 * time.Second)
	f.cache[0].until = expiry
	f.mu.Unlock()
	reopened := nextFiniteSnapshot(t, open("returned-tab"), func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, int32(1), p.queries.Load())
	require.Equal(t, first.Data.Results[0].ObservedAt, reopened.Data.Results[0].ObservedAt)
	require.Equal(t, "returned-tab", reopened.Data.Results[0].ResourceToken)
	f.mu.Lock()
	afterExpiry := f.cache[0].until
	f.cache[0].until = time.Now().Add(-time.Second)
	f.mu.Unlock()
	require.Equal(t, expiry, afterExpiry, "reuse must never renew retention")
	require.NoError(t, c.CloseMetricsObservation(ctx, "returned-tab"))
	nextFiniteSnapshot(t, open("expired-tab"), func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, int32(2), p.queries.Load(), "expired retention must start fresh work")
}

func TestFiniteCanceledProvidersKeepSlotsAndCannotPopulateCompletedReuse(t *testing.T) {
	c, p, ctx, f, now := finiteTestPausedCoordinator(t)
	returnProvider := make(chan struct{})
	p.query = func(_ *types.PluginContext, q sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		// Deliberately ignore cancellation, like a slow non-cooperative peer.
		<-returnProvider
		return &sdk.ResourceMetricsResponse{Complete: true, Results: []sdk.ResourceMetricResult{{ResourceToken: q.Targets[0].Token, MetricID: "cpu", Status: "missing"}}}, nil
	}
	reads := make([]<-chan finiteReply, finiteMaxJobs)
	cancels := make([]context.CancelFunc, finiteMaxJobs)
	for i := range reads {
		var readCtx context.Context
		readCtx, cancels[i] = context.WithCancel(ctx)
		defer cancels[i]()
		reads[i] = finiteTestRead(c, readCtx, finiteTestSpec("row", fmt.Sprintf("retired-%d", i), "cpu"))
		finiteTestWaiters(t, f, i+1)
		f.mu.Lock()
		f.dispatchAtLocked(now.Add(time.Duration(i+1) * finiteDispatchInterval))
		f.mu.Unlock()
		finiteTestReceive(t, p.calls)
	}
	for i, cancel := range cancels {
		cancel()
		require.ErrorIs(t, finiteTestReceive(t, reads[i]).err, context.Canceled)
	}
	waiting := make(chan error, 1)
	go func() {
		_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "waiting", ResourceKey: "core::v1::Pod"})
		waiting <- err
	}()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 2 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(5 * finiteDispatchInterval))
	jobCount, catalogsRunning := len(f.jobs), f.activeCatalogs
	f.mu.Unlock()
	require.Equal(t, finiteMaxJobs, jobCount)
	require.Zero(t, catalogsRunning, "canceling provider must not release its occupied slot")
	close(returnProvider)
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.jobs) == 0 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	cacheCount := len(f.cache)
	f.dispatchAtLocked(now.Add(6 * finiteDispatchInterval))
	f.mu.Unlock()
	require.Zero(t, cacheCount, "abandoned provider results must never be reused")
	require.NoError(t, finiteTestReceive(t, waiting))
	fresh := finiteTestRead(c, ctx, finiteTestSpec("new-reader", "retired-0", "cpu"))
	finiteTestWaiters(t, f, 1)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(7 * finiteDispatchInterval))
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, fresh).err)
	require.Equal(t, int32(5), p.queries.Load())
}

func TestFiniteCatalogFloodHasBoundedQueueAndCancellationFreesAdmission(t *testing.T) {
	c, _, ctx, f, now := finiteTestPausedCoordinator(t)
	type reader struct {
		reply  <-chan error
		cancel context.CancelFunc
	}
	readCatalog := func(connection string) reader {
		readCtx, cancel := context.WithCancel(ctx)
		reply := make(chan error, 1)
		go func() {
			_, err := c.GetResourceMetricsCatalog(readCtx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: connection, ResourceKey: "core::v1::Pod"})
			reply <- err
		}()
		return reader{reply, cancel}
	}
	readers := make([]reader, 63) // One completed catalog already occupies cache.
	for i := range readers {
		readers[i] = readCatalog(fmt.Sprintf("flood-%d", i))
		defer readers[i].cancel()
		require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == i+2 }, 3*time.Second, time.Millisecond)
	}
	overflow := readCatalog("overflow")
	defer overflow.cancel()
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(finiteTestReceive(t, overflow.reply)))
	readers[0].cancel()
	require.ErrorIs(t, finiteTestReceive(t, readers[0].reply), context.Canceled)
	replacement := readCatalog("replacement")
	defer replacement.cancel()
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.catalogs) == 64 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(finiteDispatchInterval))
	f.mu.Unlock()
	require.NoError(t, finiteTestReceive(t, readers[1].reply), "oldest queued catalog must beat replacement")
	for _, read := range readers[2:] {
		read.cancel()
		require.ErrorIs(t, finiteTestReceive(t, read.reply), context.Canceled)
	}
	replacement.cancel()
	require.ErrorIs(t, finiteTestReceive(t, replacement.reply), context.Canceled)
	f.mu.Lock()
	callerCount, entryCount := f.catalogWaiters, len(f.catalogs)
	f.mu.Unlock()
	require.Zero(t, callerCount)
	require.Equal(t, 2, entryCount, "only the two completed catalogs may remain")
}

func TestFiniteMixedDiscoveryRemainsFullAfterParticipatingLaneCollection(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	events := make(chan MetricsObservationSnapshot, 8)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "mixed-discovery", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
	require.NoError(t, err)
	require.Len(t, opened.Catalog.Metrics, 2)
	require.NoError(t, c.AttachMetricsObservation(ctx, "mixed-discovery"))
	query := finiteTestReceive(t, external.calls)
	require.Equal(t, one, query.Source)
	require.Equal(t, []string{"cpu"}, query.MetricIDs)
	collected := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Len(t, collected.Catalog.Metrics, 1)
	require.Equal(t, "cpu", collected.Catalog.Metrics[0].ID)
	require.Len(t, collected.Data.Results, 1)
	require.Equal(t, int32(1), external.queries.Load(), "discovery must never query the unrequested lane")
	discovery, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(finiteTestSpec("row", "pod-a", "cpu")))
	require.NoError(t, err)
	require.Equal(t, opened.Catalog, discovery)
}

func TestFinitePartiallyAbandonedJobCachesOnlyStillRequestedPairs(t *testing.T) {
	c, p, ctx := finiteTestController(t)
	broadCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	broadSpec := finiteTestSpec("broad-a", "pod-a", "cpu")
	broadSpec.Targets = append(broadSpec.Targets, finiteTestSpec("broad-b", "pod-b", "cpu").Targets[0])
	broad := finiteTestRead(c, broadCtx, broadSpec)
	require.Len(t, finiteTestReceive(t, p.calls).Targets, 2)
	survivor := finiteTestRead(c, ctx, finiteTestSpec("survivor", "pod-a", "cpu"))
	finiteTestWaiters(t, c.finiteCoordinator(), 2)
	cancel()
	require.ErrorIs(t, finiteTestReceive(t, broad).err, context.Canceled)
	close(p.release)
	require.NoError(t, finiteTestReceive(t, survivor).err)
	cached := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("returned-a", "pod-a", "cpu")))
	require.NoError(t, cached.err)
	require.Equal(t, int32(1), p.queries.Load())
	abandoned := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("returned-b", "pod-b", "cpu")))
	require.NoError(t, abandoned.err)
	require.Equal(t, int32(2), p.queries.Load(), "abandoned pairs cannot seed later subscribers")
	query := finiteTestReceive(t, p.calls)
	require.Len(t, query.Targets, 1)
	require.Equal(t, "pod-b", query.Targets[0].Reference.Address.ID)
}

func TestFiniteCoalescingDeadlineProducesOneExactViewportJob(t *testing.T) {
	c, p, ctx, f, now := finiteTestPausedCoordinator(t)
	reads := make([]<-chan finiteReply, 8)
	for i := range reads {
		reads[i] = finiteTestRead(c, ctx, finiteTestSpec("row", fmt.Sprintf("visible-%d", i), "cpu", "memory"))
	}
	finiteTestWaiters(t, f, len(reads))
	queued := now.Add(finiteDispatchInterval)
	ready := queued.Add(finiteCoalesceDelay)
	f.mu.Lock()
	for w := range f.pending {
		w.queued = queued
	}
	f.dispatchAtLocked(ready.Add(-time.Nanosecond))
	earlyJobs := len(f.jobs)
	next := f.nextDeadlineLocked(queued)
	f.dispatchAtLocked(ready)
	coalescedJobs := len(f.jobs)
	f.mu.Unlock()
	require.Zero(t, earlyJobs, "viewport churn must settle before starting provider work")
	require.Equal(t, ready, next)
	require.Equal(t, 1, coalescedJobs)
	query := finiteTestReceive(t, p.calls)
	require.Len(t, query.Targets, len(reads))
	require.Equal(t, []string{"cpu", "memory"}, query.MetricIDs)
	close(p.release)
	for _, read := range reads {
		reply := finiteTestReceive(t, read)
		require.NoError(t, reply.err)
		require.Len(t, reply.data.Results, 2)
	}
	require.Equal(t, int32(1), p.queries.Load())
}

func TestFiniteConfigurationInvalidationReleasesQueuedCatalogReadersImmediately(t *testing.T) {
	c, _, ctx, f, _ := finiteTestPausedCoordinator(t)
	result := make(chan error, 1)
	go func() {
		_, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "queued", ResourceKey: "core::v1::Pod"})
		result <- err
	}()
	require.Eventually(t, func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return len(f.catalogs) == 2
	}, 3*time.Second, time.Millisecond)
	c.invalidateMetricConfiguration()
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(finiteTestReceive(t, result)))
	f.mu.Lock()
	readers, running, entries := f.catalogWaiters, f.activeCatalogs, len(f.catalogs)
	f.mu.Unlock()
	require.Zero(t, readers)
	require.Zero(t, running)
	require.Zero(t, entries)
}

type finiteAvailabilityProvider struct {
	*finitePrivateProvider
	unavailable    atomic.Bool
	unrelatedReads atomic.Int32
}

func (p *finiteAvailabilityProvider) GetDataSources(pc *types.PluginContext, source sdk.MetricSourceRef) ([]sdk.MetricDataSource, error) {
	if source.ConnectionID == "two" {
		p.unrelatedReads.Add(1)
		if p.unavailable.Load() {
			return nil, finiteError("UNAVAILABLE", "Unrequested source is unavailable.")
		}
	}
	return p.finitePrivateProvider.GetDataSources(pc, source)
}

func (p *finiteAvailabilityProvider) GetResourceMetricsCatalog(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	if request.Source.ConnectionID == "two" {
		p.unrelatedReads.Add(1)
		if p.unavailable.Load() {
			return nil, finiteError("UNAVAILABLE", "Unrequested catalog is unavailable.")
		}
	}
	return p.finitePrivateProvider.GetResourceMetricsCatalog(pc, request)
}

func TestFiniteCollectionMetadataDoesNotDependOnUnrequestedSourceHealth(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	close(private.release)
	provider := &finiteAvailabilityProvider{finitePrivateProvider: private}
	c.clients["external"] = provider
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	events := make(chan MetricsObservationSnapshot, 8)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "isolated-discovery", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
	require.NoError(t, err)
	require.Len(t, opened.Catalog.Metrics, 2)
	provider.unavailable.Store(true)
	provider.unrelatedReads.Store(0)
	// Cached discovery must not hide an accidental unrelated provider read.
	f := c.finiteCoordinator()
	f.mu.Lock()
	for _, read := range f.catalogs {
		if read.sourceKey.connection == "two" {
			read.until = time.Now().Add(-time.Second)
		}
	}
	f.mu.Unlock()
	require.NoError(t, c.AttachMetricsObservation(ctx, "isolated-discovery"))
	collected := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Empty(t, collected.Error)
	require.Len(t, collected.Catalog.Metrics, 1)
	require.Equal(t, "cores", collected.Catalog.Metrics[0].Unit)
	require.Equal(t, int32(0), provider.unrelatedReads.Load())
	require.Equal(t, int32(1), private.queries.Load())
	// Presentation choices never authorize execution. Selecting the unavailable
	// descriptor must perform its own current source admission and fail.
	unavailable := finiteTestReceive(t, finiteTestRead(c, ctx, finiteTestSpec("memory", "pod-a", "memory")))
	require.Error(t, unavailable.err)
	require.Nil(t, unavailable.data)
	require.Positive(t, provider.unrelatedReads.Load())
	require.Equal(t, int32(1), private.queries.Load())
}

func TestFiniteCanceledReplyDetachesWaiterFromAllProviderJobs(t *testing.T) {
	c, p, ctx, f, now := finiteTestPausedCoordinator(t)
	returnCPU := make(chan struct{})
	returnMemory := make(chan struct{})
	memoryCanceled := make(chan struct{}, 1)
	p.query = func(pc *types.PluginContext, q sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
		if q.MetricIDs[0] == "cpu" {
			<-returnCPU
		} else {
			<-pc.Context.Done()
			memoryCanceled <- struct{}{}
			// Cancellation must retain the slot until the provider returns.
			<-returnMemory
		}
		return &sdk.ResourceMetricsResponse{Complete: true, Results: []sdk.ResourceMetricResult{{ResourceToken: q.Targets[0].Token, MetricID: q.MetricIDs[0], Status: "missing"}}}, nil
	}
	cpuCtx, cancelCPU := context.WithCancel(ctx)
	defer cancelCPU()
	cpu := finiteTestRead(c, cpuCtx, finiteTestSpec("cpu", "pod-a", "cpu"))
	finiteTestWaiters(t, f, 1)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(finiteDispatchInterval))
	f.mu.Unlock()
	finiteTestReceive(t, p.calls)
	memoryCtx, cancelMemory := context.WithCancel(ctx)
	defer cancelMemory()
	memory := finiteTestRead(c, memoryCtx, finiteTestSpec("memory", "pod-a", "memory"))
	finiteTestWaiters(t, f, 2)
	f.mu.Lock()
	f.dispatchAtLocked(now.Add(2 * finiteDispatchInterval))
	f.mu.Unlock()
	finiteTestReceive(t, p.calls)
	joined := finiteTestRead(c, ctx, finiteTestSpec("joined", "pod-a", "cpu", "memory"))
	finiteTestWaiters(t, f, 3)
	cancelCPU()
	require.ErrorIs(t, finiteTestReceive(t, cpu).err, context.Canceled)
	cancelMemory()
	require.ErrorIs(t, finiteTestReceive(t, memory).err, context.Canceled)
	finiteTestWaiters(t, f, 1)
	// Cancel admitted waiter lifetime before its transport observes cancellation.
	// Completion must return the error without depending on reader-side detach.
	f.mu.Lock()
	var cancelWaiter context.CancelFunc
	for w := range f.pending {
		w.ctx, cancelWaiter = context.WithCancel(w.ctx)
		cancelWaiter()
	}
	f.mu.Unlock()
	require.NotNil(t, cancelWaiter)
	close(returnCPU)
	require.ErrorIs(t, finiteTestReceive(t, joined).err, context.Canceled)
	finiteTestReceive(t, memoryCanceled)
	f.mu.Lock()
	waiters, jobs := f.waiterCountLocked(), len(f.jobs)
	f.mu.Unlock()
	require.Zero(t, waiters, "reply delivery must release interests in every job")
	require.Equal(t, 1, jobs, "canceled provider must retain its occupied slot")
	close(returnMemory)
	require.Eventually(t, func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return len(f.jobs) == 0 && len(f.cache) == 0
	}, 3*time.Second, time.Millisecond)
}

func TestFiniteNativeMetadataReadmitsAfterInvalidationWithoutUnrelatedProviderIO(t *testing.T) {
	c, native, ctx := finiteTestController(t)
	native.maxAge = 45 * time.Second
	close(native.release)
	private := addFinitePrivateProvider(t, c)
	provider := &finiteAvailabilityProvider{finitePrivateProvider: private}
	c.clients["external"] = provider
	two := finitePrivateSource("two")
	_, err := c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	events := make(chan MetricsObservationSnapshot, 32)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "native-metadata", Spec: finiteTestSpec("row", "pod-a", "cpu")}, func(s MetricsObservationSnapshot) { events <- s })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "native-metadata"))
	first := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	provider.unavailable.Store(true)
	provider.unrelatedReads.Store(0)
	finishChange := c.beginScopedMetricConfigurationChange([]finiteConfigurationKey{{kind: "source", plugin: "kubernetes", connection: "cluster"}})
	finishChange()
	nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Invalidated })
	delivered := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool {
		return s.Data != nil && !s.Fetching && !s.Invalidated
	})
	require.NotNil(t, delivered.Catalog)
	require.Len(t, delivered.Catalog.Metrics, 1)
	require.Equal(t, "cpu", delivered.Catalog.Metrics[0].ID)
	require.Equal(t, "cores", delivered.Catalog.Metrics[0].Unit)
	require.Equal(t, 45*time.Second, delivered.Catalog.MaxSampleAge)
	nativeSource := sdk.MetricSourceRef{PluginID: "kubernetes", ConnectionID: "cluster", Native: true}
	require.Equal(t, nativeSource, delivered.Catalog.Source)
	require.Equal(t, &nativeSource, delivered.Catalog.Metrics[0].Source)
	require.Nil(t, delivered.Data.Results[0].Source, "owner-native results use admitted catalog provenance")
	require.Equal(t, first.Data.Results[0].ObservedAt, delivered.Data.Results[0].ObservedAt)
	require.Equal(t, first.Data.Results[0].Window, delivered.Data.Results[0].Window)
	require.Empty(t, delivered.Error)
	require.Zero(t, provider.unrelatedReads.Load())
	provider.unavailable.Store(false)
	discovery, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(finiteTestSpec("row", "pod-a", "cpu")))
	require.NoError(t, err)
	require.Equal(t, opened.Catalog, discovery, "sample metadata must never narrow independent discovery")
}
