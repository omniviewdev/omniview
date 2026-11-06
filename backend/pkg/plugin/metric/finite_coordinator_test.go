package metric

import (
	"context"
	"encoding/json"
	"errors"
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
func (p *finiteTestProvider) GetResourceMetricsCatalog(pc *types.PluginContext, key string) (*sdk.ResourceMetricsCatalog, error) {
	shapes := p.shapes
	if len(shapes) == 0 {
		shapes = []string{"current"}
	}
	return &sdk.ResourceMetricsCatalog{Source: sdk.MetricSourceRef{PluginID: "kubernetes", ConnectionID: pc.Connection.ID, DatasourceKind: "metrics-server"}, MaxTargets: 256, Metrics: []sdk.FiniteMetricDescriptor{{ID: "cpu", Name: "CPU", ResourceKey: key, Unit: "cores", Shapes: shapes}, {ID: "memory", Name: "Memory", ResourceKey: key, Unit: "bytes", Shapes: shapes}}}, nil
}
func (p *finiteTestProvider) QueryResources(pc *types.PluginContext, q sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
	p.queries.Add(1)
	p.calls <- q
	select {
	case <-pc.Context.Done():
		select {
		case p.cancelled <- struct{}{}:
		default:
		}
		return nil, pc.Context.Err()
	case <-p.release:
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
	// Hold scheduling until all three interests have joined the pending union.
	f := &finiteCoordinator{c: c, pending: map[*finiteWaiter]bool{}, jobs: map[*finiteJob]bool{}, epochs: map[metricStreamKey]uint64{}, blocked: map[metricStreamKey]int{}, observations: map[string]*finiteObservation{}, tombstones: map[string]time.Time{}, wake: make(chan struct{}, 1)}
	c.finiteOnce.Do(func() { c.finite.Store(f) })
	a := finiteTestRead(c, ctx, finiteTestSpec("table-a", "pod-a", "cpu", "memory"))
	b := finiteTestRead(c, ctx, finiteTestSpec("table-b", "pod-b", "cpu"))
	sidebar := finiteTestRead(c, ctx, finiteTestSpec("sidebar", "pod-a", "cpu"))
	require.Eventually(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pending) == 3 }, 3*time.Second, time.Millisecond)
	f.mu.Lock()
	for w := range f.pending {
		w.queued = time.Now().Add(-time.Second)
	}
	f.dispatchLocked()
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
