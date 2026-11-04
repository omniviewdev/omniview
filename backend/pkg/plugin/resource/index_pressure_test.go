package resource

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

const (
	pressureCapacity = 10_000
	pressureStep     = 1_000
	pressureRounds   = 5
	pressureUpdates  = 15_000
)

type pressureProbe struct {
	ordinal  int
	at       time.Time
	returned chan time.Time
}

// Observe the real registry mutation immediately before ingress calls Enqueue.
// The wrapper does not delay mutation or change the production queue.
type pressureStore struct {
	registry.Store
	mutations int
	probes    chan pressureProbe
	pending   *pressureProbe
}

func (s *pressureStore) mutated() {
	s.mutations++
	if delta := s.mutations - pressureCapacity - 2; delta >= 0 && delta%pressureStep == 0 && delta/pressureStep < pressureRounds {
		s.pending = &pressureProbe{ordinal: s.mutations, at: time.Now(), returned: make(chan time.Time, 1)}
		s.probes <- *s.pending
	}
}

func (s *pressureStore) enqueued() {
	if s.pending != nil {
		s.pending.returned <- time.Now()
		s.pending = nil
	}
}

func (s *pressureStore) Put(entry registry.ResourceEntry) (*registry.ResourceEntry, bool) {
	old, existed := s.Store.Put(entry)
	s.mutated()
	return old, existed
}

func (s *pressureStore) Delete(plugin string, ref resourcev2.ResourceReference, route resourcev2.AccessRoute) (*registry.ResourceEntry, bool) {
	old, existed := s.Store.Delete(plugin, ref, route)
	if existed {
		s.mutated()
	}
	return old, existed
}

type pressureDelivery struct {
	kind indexer.EventType
	id   string
	seq  int
}

// The first indexer gates the actual consumer, then records every delivered
// event. The real graph indexer remains next in the production dispatcher.
type pressureConsumer struct {
	entered   chan int
	permit    chan struct{}
	abort     chan struct{}
	unblock   sync.Once
	rounds    int
	delivered []pressureDelivery
}

func (c *pressureConsumer) Name() string { return "controlled-pressure-consumer" }
func (c *pressureConsumer) release()     { c.unblock.Do(func() { close(c.abort) }) }
func (c *pressureConsumer) record(kind indexer.EventType, entry registry.ResourceEntry, raw json.RawMessage) {
	ordinal := len(c.delivered) + 1
	if (ordinal-1)%pressureStep == 0 && (ordinal-1)/pressureStep < c.rounds {
		select {
		case c.entered <- ordinal:
		case <-c.abort:
		}
		select {
		case <-c.permit:
		case <-c.abort:
		}
	}
	c.delivered = append(c.delivered, pressureDelivery{kind: kind, id: entry.Reference.Address.ID, seq: int(gjson.GetBytes(raw, "status").Int())})
}
func (c *pressureConsumer) OnAdd(entry registry.ResourceEntry, raw json.RawMessage) {
	c.record(indexer.EventAdd, entry, raw)
}
func (c *pressureConsumer) OnUpdate(_ registry.ResourceEntry, entry registry.ResourceEntry, raw json.RawMessage) {
	c.record(indexer.EventUpdate, entry, raw)
}
func (c *pressureConsumer) OnDelete(entry registry.ResourceEntry) {
	c.record(indexer.EventDelete, entry, nil)
}

type pressureAction struct {
	record   resourcev2.Record
	metadata *resourcev2.ResourceMetadata
	recreate bool
}

type indexPressureFixture struct {
	ctrl         *controller
	graph        *graph.RelationshipGraph
	dispatcher   *indexer.Dispatcher
	consumer     *pressureConsumer
	store        *pressureStore
	generation   *pluginState
	route        resourcev2.AccessRoute
	records      []resourcev2.Record
	actions      []pressureAction
	expected     []pressureDelivery
	workload     string
	producerDone chan struct{}
}

func newIndexPressureFixture(t testing.TB, count int, workload string) *indexPressureFixture {
	t.Helper()
	ctrl, g, initial := newGraphPipeline(t)
	route := resourcev2.AccessRoute{Connection: "route/one"}
	setPipelineDeclarations(t, ctrl, g, "plugin-a", route, "workload", []resourcev2.RelationshipDescriptor{
		{Type: resourcev2.RelOwns, TargetType: "owner", TargetScope: []resourcev2.ScopeEntry{{Dimension: "shard", Value: "west"}}, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "metadata.ownerReferences.0.name"}},
		{Type: resourcev2.RelRunsOn, TargetType: "machine", Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "machine"}},
	})
	f := &indexPressureFixture{ctrl: ctrl, graph: g, route: route, generation: ctrl.plugins["plugin-a"], workload: workload}
	f.records = make([]resourcev2.Record, count)
	for i := range f.records {
		_, f.records[i] = graphPipelineRecord(t, ctrl, "workload", fmt.Sprint(i), `{"metadata":{"ownerReferences":[{"name":"parent-0"}]},"machine":"worker-0","status":0}`)
		require.NoError(t, ctrl.observeValidatedSourceRecord(testInvocationContext(), "plugin-a", f.generation, route, f.records[i], &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "zero"}}))
	}
	initial.Flush()
	initial.Stop()
	g.TakeChanged()
	f.store = &pressureStore{Store: ctrl.registryStore, probes: make(chan pressureProbe, pressureRounds)}
	ctrl.registryStore = f.store
	f.consumer = &pressureConsumer{entered: make(chan int, pressureRounds), permit: make(chan struct{}, pressureRounds), abort: make(chan struct{}), rounds: pressureRounds, delivered: make([]pressureDelivery, 0, pressureUpdates*2)}
	f.dispatcher = indexer.NewDispatcher([]indexer.ResourceIndexer{f.consumer, graph.NewGraphIndexer(g, f.store)})
	ctrl.dispatcher = f.dispatcher
	f.dispatcher.Start()
	// Cleanup opens every test gate before Stop drains accepted events. Stop is
	// not cancellation for an indexer callback, and Flush must follow producers.
	t.Cleanup(func() {
		f.consumer.release()
		if f.producerDone != nil {
			<-f.producerDone
		}
		f.dispatcher.Stop()
	})
	f.actions = make([]pressureAction, pressureUpdates)
	for n := range f.actions {
		i, cycle := n%count, n/count+1
		owner, machine, label := "parent-0", "worker-0", "zero"
		if workload == "owner" {
			owner = fmt.Sprintf("parent-%d", cycle%2)
		}
		if workload == "field" {
			machine = fmt.Sprintf("worker-%d", cycle%2)
		}
		if workload == "label" {
			label = fmt.Sprintf("label-%d", cycle%2)
		}
		record := f.records[i]
		body, err := resourcev2.JSONToValue([]byte(fmt.Sprintf(`{"metadata":{"ownerReferences":[{"name":%q}]},"machine":%q,"status":%d}`, owner, machine, n+1)))
		require.NoError(t, err)
		record.Body = body
		if workload == "recreate" {
			token := fmt.Sprintf("incarnation-%d", cycle)
			record.Reference.Incarnation = &token
		}
		f.actions[n] = pressureAction{record: record, metadata: &resourcev2.ResourceMetadata{Labels: map[string]string{"app": label}}, recreate: workload == "recreate"}
		if workload == "recreate" {
			f.expected = append(f.expected, pressureDelivery{kind: indexer.EventDelete, id: record.Reference.Address.ID})
		}
		kind := indexer.EventUpdate
		if workload == "recreate" {
			kind = indexer.EventAdd
		}
		f.expected = append(f.expected, pressureDelivery{kind: kind, id: record.Reference.Address.ID, seq: n + 1})
	}
	return f
}

func pressureReceive[T any](t testing.TB, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(15 * time.Second):
		t.Fatal("controlled pressure barrier timed out")
		var zero T
		return zero
	}
}

func (f *indexPressureFixture) produce(limit int) <-chan error {
	done := make(chan error, 1)
	f.producerDone = make(chan struct{})
	go func() {
		defer close(f.producerDone)
		for _, action := range f.actions[:limit] {
			if action.recreate {
				// Delete by address, not the next incarnation's precondition.
				ref := action.record.Reference
				ref.Incarnation = nil
				deleteGraphRecord(f.ctrl, f.route, ref)
				f.store.enqueued()
			}
			if err := f.ctrl.observeValidatedSourceRecord(testInvocationContext(), "plugin-a", f.generation, f.route, action.record, action.metadata); err != nil {
				done <- err
				return
			}
			f.store.enqueued()
		}
		done <- nil
	}()
	return done
}

type pressureMetrics struct {
	blocked, elapsed, drain time.Duration
	peak                    int
}

func (f *indexPressureFixture) run(t testing.TB) pressureMetrics {
	t.Helper()
	start := time.Now()
	done := f.produce(len(f.actions))
	// Reflection observes only length/capacity, matching BenchmarkIndexInputs.
	queue := reflect.ValueOf(f.dispatcher).Elem().FieldByName("events")
	require.Equal(t, pressureCapacity, queue.Cap())
	var result pressureMetrics
	for round := range pressureRounds {
		consumed := pressureReceive(t, f.consumer.entered)
		probe := pressureReceive(t, f.store.probes)
		require.Equal(t, round*pressureStep+1, consumed)
		require.Equal(t, pressureCapacity+consumed+1, probe.ordinal)
		require.Equal(t, pressureCapacity, queue.Len())
		result.peak = max(result.peak, queue.Len())
		// Registry mutation reached the next ingress send, but capacity cannot
		// admit it until this consumer gate opens. No sleep or drop is involved.
		select {
		case err := <-done:
			t.Fatalf("producer finished behind full queue: %v", err)
		case <-probe.returned:
			t.Fatal("pending ingress returned before consumer release")
		default:
		}
		f.consumer.permit <- struct{}{}
		result.blocked += pressureReceive(t, probe.returned).Sub(probe.at)
	}
	require.NoError(t, pressureReceive(t, done))
	drain := time.Now()
	f.dispatcher.Flush()
	result.drain = time.Since(drain)
	result.elapsed = time.Since(start)
	require.Zero(t, queue.Len())
	return result
}

func (f *indexPressureFixture) verify(t testing.TB) {
	t.Helper()
	// A full delivery journal proves count, FIFO order, and exact delete/add
	// interleaving. Final state alone could conceal dropped intermediate updates.
	require.Equal(t, f.expected, f.consumer.delivered)
	count := len(f.records)
	require.Len(t, f.store.ScanByResourceKey("plugin-a", f.route.Connection, "workload"), count)
	lastCycle := pressureUpdates / count
	label, owner, machine := "zero", "parent-0", "worker-0"
	if f.workload == "label" {
		label = fmt.Sprintf("label-%d", lastCycle%2)
		require.Empty(t, f.store.ScanByLabel("plugin-a", f.route.Connection, "workload", map[string]string{"app": "zero"}))
		require.Empty(t, f.store.ScanByLabel("plugin-a", f.route.Connection, "workload", map[string]string{"app": fmt.Sprintf("label-%d", 1-lastCycle%2)}))
	}
	if f.workload == "owner" {
		owner = fmt.Sprintf("parent-%d", lastCycle%2)
	}
	if f.workload == "field" {
		machine = fmt.Sprintf("worker-%d", lastCycle%2)
	}
	require.Len(t, f.store.ScanByLabel("plugin-a", f.route.Connection, "workload", map[string]string{"app": label}), count)
	targets := make(map[string]struct{})
	for _, action := range f.actions[len(f.actions)-count:] {
		entry, ok := f.store.Get("plugin-a", action.record.Reference, f.route)
		require.True(t, ok)
		require.Equal(t, action.record.Reference, entry.Reference)
		require.Equal(t, action.metadata.Labels, entry.Labels)
		node := graph.GraphNode{PluginID: "plugin-a", Reference: entry.Reference, Route: f.route}
		edges := f.graph.EdgesFrom(node.Key())
		require.Len(t, edges, 2)
		for _, edge := range edges {
			require.Equal(t, entry.Reference, edge.Source.Reference)
			if edge.Type == resourcev2.RelOwns {
				require.Equal(t, owner, edge.Target.Reference.Address.ID)
				require.Equal(t, "owner", edge.Target.Reference.Address.Type)
				require.Equal(t, []resourcev2.ScopeEntry{{Dimension: "shard", Value: "west"}}, edge.Target.Reference.Address.Scope)
			} else {
				require.Equal(t, resourcev2.RelRunsOn, edge.Type)
				require.Equal(t, machine, edge.Target.Reference.Address.ID)
				require.Equal(t, "machine", edge.Target.Reference.Address.Type)
				require.Empty(t, edge.Target.Reference.Address.Scope)
			}
			targets[edge.Target.Key()] = struct{}{}
		}
	}
	for key := range targets {
		incoming := f.graph.EdgesTo(key)
		require.Len(t, incoming, count)
		seen := make(map[string]bool, count)
		for _, edge := range incoming {
			require.False(t, seen[edge.Source.Reference.Address.ID])
			seen[edge.Source.Reference.Address.ID] = true
		}
	}
	changed := f.graph.TakeChanged()
	if f.workload == "status" {
		require.Empty(t, changed)
	} else {
		require.Len(t, changed, 1)
	}
}

func TestIndexInputsSustainedPressure(t *testing.T) {
	for _, count := range []int{300, 3000} {
		for _, workload := range []string{"status", "label", "owner", "field", "recreate"} {
			t.Run(fmt.Sprintf("%d/%s", count, workload), func(t *testing.T) {
				f := newIndexPressureFixture(t, count, workload)
				metrics := f.run(t)
				f.verify(t)
				t.Logf("controlled backend: events=%d edges=%d queue-high-water=%d saturation-barriers=%d blocked-ingress=%s throughput=%.0f events/s drain=%s", len(f.expected), count*2, metrics.peak, pressureRounds, metrics.blocked, float64(len(f.expected))/metrics.elapsed.Seconds(), metrics.drain)
			})
		}
	}
}

func TestIndexInputsPressureGenerationRetirement(t *testing.T) {
	f := newIndexPressureFixture(t, 300, "status")
	f.consumer.rounds = 1
	f.ctrl.connections["plugin-a"] = []types.Connection{{ID: f.route.Connection}}
	// One callback plus 10,000 queued updates leaves observation 10,002
	// holding the actual ingress generation read fence while its send blocks.
	done := f.produce(pressureCapacity + 2)
	require.Equal(t, 1, pressureReceive(t, f.consumer.entered))
	require.Equal(t, pressureCapacity+2, pressureReceive(t, f.store.probes).ordinal)
	queue := reflect.ValueOf(f.dispatcher).Elem().FieldByName("events")
	require.Equal(t, pressureCapacity, queue.Len())
	retired := make(chan error, 1)
	retirementDone := make(chan struct{})
	go func() {
		defer close(retirementDone)
		retired <- f.ctrl.OnPluginStop("plugin-a", config.PluginMeta{})
	}()
	t.Cleanup(func() { f.consumer.release(); <-retirementDone })
	// Stop cancels the old generation before taking its exclusive fence.
	pressureReceive(t, f.generation.ctx.Done())
	select {
	case err := <-retired:
		t.Fatalf("retirement passed blocked ingress fence: %v", err)
	default:
	}
	f.consumer.release()
	require.NoError(t, pressureReceive(t, done))
	require.NoError(t, pressureReceive(t, retired))
	f.dispatcher.Flush()
	require.Zero(t, queue.Len())
	require.Equal(t, f.expected[:pressureCapacity+2], f.consumer.delivered[:pressureCapacity+2])
	deletes := f.consumer.delivered[pressureCapacity+2:]
	require.Len(t, deletes, len(f.records))
	seen := make(map[string]bool)
	for _, event := range deletes {
		require.Equal(t, indexer.EventDelete, event.kind)
		require.False(t, seen[event.id])
		seen[event.id] = true
	}
	require.Empty(t, f.store.ScanByResourceKey("plugin-a", f.route.Connection, "workload"))
	require.Empty(t, f.store.ScanByLabel("plugin-a", f.route.Connection, "workload", map[string]string{"app": "zero"}))
	for _, record := range f.records {
		require.Empty(t, f.graph.EdgesFrom((graph.GraphNode{PluginID: "plugin-a", Reference: record.Reference, Route: f.route}).Key()))
	}
	before := len(f.consumer.delivered)
	err := f.ctrl.observeValidatedSourceRecord(testInvocationContext(), "plugin-a", f.generation, f.route, f.records[0], nil)
	require.Error(t, err)
	f.dispatcher.Flush()
	require.Len(t, f.consumer.delivered, before)
}

// BenchmarkIndexInputsPressure measures controlled actual-ingress backpressure,
// including the gate/journal cost. Fixture construction and final invariants are
// outside its timer. This is not desktop or provider-transport throughput.
func BenchmarkIndexInputsPressure(b *testing.B) {
	for _, count := range []int{300, 3000} {
		for _, workload := range []string{"status", "label", "owner", "field", "recreate"} {
			b.Run(fmt.Sprintf("%d/%s", count, workload), func(b *testing.B) {
				b.StopTimer()
				var blocked, elapsed, drain time.Duration
				var events, peak int
				b.ReportAllocs()
				for range b.N {
					f := newIndexPressureFixture(b, count, workload)
					b.StartTimer()
					metrics := f.run(b)
					b.StopTimer()
					f.verify(b)
					f.consumer.release()
					f.dispatcher.Stop()
					blocked += metrics.blocked
					elapsed += metrics.elapsed
					drain += metrics.drain
					events += len(f.expected)
					peak = max(peak, metrics.peak)
				}
				b.ReportMetric(float64(peak), "queue-high-water")
				b.ReportMetric(float64(pressureRounds), "saturations/op")
				b.ReportMetric(float64(blocked.Nanoseconds())/float64(b.N), "blocked-ingress-ns/op")
				b.ReportMetric(float64(drain.Nanoseconds())/float64(b.N), "drain-ns/op")
				b.ReportMetric(float64(events)/elapsed.Seconds(), "events/s")
				b.ReportMetric(float64(events)/float64(b.N), "events/op")
				b.ReportMetric(float64(count*2), "expected-edges")
			})
		}
	}
}
