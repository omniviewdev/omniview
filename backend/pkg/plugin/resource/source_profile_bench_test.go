package resource

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/pprof"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
)

const hostSourceProfilePods = 20_000

var hostSourceProfileSnapshotHeap = flag.String("host-source-snapshot-heap", "", "Write a live heap profile after the first complete 20k-Pod host snapshot.")
var hostSourceProfileMaxAllocBytes = flag.Uint64("host-source-max-pipeline-alloc-bytes", 0, "Fail each complete 20k-Pod host snapshot above this allocation-byte budget; zero disables sampling and enforcement.")

// BenchmarkHostSourceSnapshot20KPods measures a fresh host source from the first
// received frame through the view emitter's first complete snapshot. It uses
// actual receive, phase admission, packed staging, committed membership, view
// preflight and view emission. Optional graph work is absent without demand.
// Only provider transport and final emitter are fixtures; no cluster is contacted.
func BenchmarkHostSourceSnapshot20KPods(b *testing.B) {
	b.StopTimer()
	b.ReportAllocs()
	var totals hostSourceProfileMetrics
	captureHeap := *hostSourceProfileSnapshotHeap != ""
	for range b.N {
		svc := appstate.NewTestService(b)
		metrics := hostSourceProfileIteration(b, svc, captureHeap)
		captureHeap = false
		b.SetBytes(metrics.wireBytes)
		totals.wireBytes += metrics.wireBytes
		totals.memberEstimate += metrics.memberEstimate
		totals.bodyBytes += metrics.bodyBytes
		totals.headerBytes += metrics.headerBytes
		totals.allocBytes += metrics.allocBytes
		totals.chunks += metrics.chunks
		totals.commit += metrics.commit
		totals.complete += metrics.complete
		if limit := *hostSourceProfileMaxAllocBytes; limit != 0 && metrics.allocBytes > limit {
			b.Errorf("host source snapshot allocation budget exceeded: allocated=%d bytes limit=%d bytes pods=%d", metrics.allocBytes, limit, hostSourceProfilePods)
		}
	}
	n := float64(b.N)
	b.ReportMetric(float64(hostSourceProfilePods), "pods/op")
	b.ReportMetric(float64(totals.wireBytes)/n, "protobuf-B/op")
	b.ReportMetric(float64(totals.memberEstimate)/n, "member-estimate-B/op")
	b.ReportMetric(float64(totals.bodyBytes)/n, "retained-body-B/op")
	b.ReportMetric(float64(totals.headerBytes)/n, "retained-header-estimate-B/op")
	b.ReportMetric(float64(totals.bodyBytes+totals.headerBytes)/n, "retained-storage-estimate-B/op")
	if *hostSourceProfileMaxAllocBytes != 0 {
		b.ReportMetric(float64(totals.allocBytes)/n, "pipeline-alloc-B/op")
	}
	b.ReportMetric(float64(totals.chunks)/n, "view-chunks/op")
	b.ReportMetric(float64(totals.commit.Nanoseconds())/n, "source-commit-ns/op")
	b.ReportMetric(float64(totals.complete.Nanoseconds())/n, "first-complete-snapshot-ns/op")
}

type hostSourceProfileMetrics struct {
	wireBytes      int64
	memberEstimate int64
	bodyBytes      int64
	headerBytes    int64
	allocBytes     uint64
	chunks         int
	commit         time.Duration
	complete       time.Duration
}

func hostSourceProfileIteration(b *testing.B, svc *appstate.Service, captureHeap bool) hostSourceProfileMetrics {
	b.Helper()
	b.StopTimer()
	emitter := &hostSourceProfileEmitter{
		seen:   make([]uint64, (hostSourceProfilePods+63)/64),
		done:   make(chan hostSourceProfileResult, 1),
		closed: make(chan struct{}),
	}
	ctrl := NewController(logging.NewNop(), nil, svc.PluginStore, nil).(*controller)
	ctrl.emitter = emitter
	// CPU profiles also collect untimed setup. Label host worker goroutines so
	// pprof can isolate the real pipeline from fixture encoding and teardown.
	pipelineLabels := pprof.Labels("host_source_profile", "pipeline")
	pprof.Do(testInvocationContext(), pipelineLabels, func(ctx context.Context) { ctrl.Run(ctx) })
	var opened HostSourceViewOpened
	defer func() {
		if opened.ViewID != "" {
			if err := ctrl.CloseSourceView(testInvocationContext(), "p1", opened.ViewID); err != nil {
				b.Errorf("close source view: %v", err)
			}
			select {
			case <-emitter.closed:
			case <-time.After(5 * time.Second):
				b.Error("source view emitter did not close")
			}
		}
		ctrl.pluginsMu.Lock()
		for _, state := range ctrl.plugins {
			state.cancel()
		}
		ctrl.pluginsMu.Unlock()
		if err := ctrl.ServiceShutdown(); err != nil {
			b.Errorf("shut down controller: %v", err)
		}
	}()

	provider := &hostSourceProfileProvider{
		mockProvider: &mockProvider{
			CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				catalog := canonicalTestCatalog("p1", "native::Pod")
				catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
				return catalog, nil
			},
			StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Connection: &types.Connection{ID: id}, Status: types.ConnectionStatusConnected}, nil
			},
		},
		opens: make(chan hostSourceProfileOpen, 1),
	}
	registerMockPlugin(ctrl, "p1", provider)
	ctx := testInvocationContext()
	if _, err := ctrl.StartConnection(ctx, "p1", "conn-1"); err != nil {
		b.Fatal(err)
	}
	target, err := ctrl.ResolveTarget(ctx, "p1", ResolveTargetRequest{
		Route: resourcev2.AccessRoute{Connection: "conn-1"}, Type: "native::Pod", Representation: "native", Scope: resourcev2.QueryScope{},
	})
	if err != nil {
		b.Fatal(err)
	}
	pprof.Do(ctx, pipelineLabels, func(ctx context.Context) {
		opened, err = ctrl.OpenSourceView(ctx, "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
	})
	if err != nil {
		b.Fatal(err)
	}
	emitter.mu.Lock()
	emitter.topic = opened.Topic
	emitter.mu.Unlock()
	if err := ctrl.SyncSourceView(ctx, "p1", opened.ViewID); err != nil {
		b.Fatal(err)
	}
	var open hostSourceProfileOpen
	select {
	case open = <-provider.opens:
	case <-time.After(5 * time.Second):
		b.Fatal("source stream did not open")
	}
	view, err := ctrl.sourceView(ctx, "p1", opened.ViewID, "resource.SyncSourceView")
	if err != nil || view == nil {
		b.Fatalf("source view lookup: view=%v error=%v", view, err)
	}
	frames, metrics := hostSourceProfileFrames(b, open.request)
	// Closing ready publishes the fully encoded fixture to Recv. The stream
	// drops each consumed wire buffer, rather than retaining 20k decoded Pods.
	open.stream.frames = frames
	timeout := time.NewTimer(5 * time.Minute)
	defer timeout.Stop()

	// Sample only for explicit budget runs. These process-wide counters bracket
	// the benchmark timer, excluding fixture setup, validation and teardown.
	var allocationStart uint64
	if *hostSourceProfileMaxAllocBytes != 0 {
		var stats runtime.MemStats
		runtime.ReadMemStats(&stats)
		allocationStart = stats.TotalAlloc
	}
	b.StartTimer()
	started := time.Now()
	close(open.stream.ready)
	var result hostSourceProfileResult
	select {
	case result = <-emitter.done:
	case <-timeout.C:
		b.StopTimer()
		b.Fatal("host source did not emit a complete 20k-Pod snapshot within five minutes")
	}
	b.StopTimer()
	if *hostSourceProfileMaxAllocBytes != 0 {
		var stats runtime.MemStats
		runtime.ReadMemStats(&stats)
		metrics.allocBytes = stats.TotalAlloc - allocationStart
	}
	if result.message != "" {
		b.Fatal(result.message)
	}
	if result.records != hostSourceProfilePods || result.status.State != "following" || result.status.Coverage == nil || result.status.Coverage.Enumeration != resourcev2.EnumerationExhausted || result.status.Count.Value == nil || *result.status.Count.Value != strconv.Itoa(hostSourceProfilePods) {
		b.Fatalf("incomplete snapshot: records=%d status=%+v", result.records, result.status)
	}
	if result.committedAt.IsZero() || result.completedAt.Before(result.committedAt) {
		b.Fatal("snapshot did not follow a committed source state")
	}
	metrics.commit = result.committedAt.Sub(started)
	metrics.complete = result.completedAt.Sub(started)
	metrics.chunks = result.chunks

	// Correctness checks and optional retained-heap capture stay outside
	// ns/op, B/op, allocs/op and first-complete-snapshot latency.
	session := view.session
	session.mu.Lock()
	members, hasSnapshot, memberBytes := len(session.members), session.hasSnapshot, session.memberBytes
	// Header estimates include owned strings, containers and lifetime nodes.
	// The larger member charge also covers membership/index overhead and
	// staging metadata. Neither metric substitutes for a matched live heap.
	metadataPresent := true
	for _, member := range session.members {
		metrics.bodyBytes += int64(len(member.body))
		metrics.headerBytes += int64(member.retainedHeaderBytes())
		if member.metadata == nil || member.metadata.Labels["app"] != "example" || member.metadata.CreatedAt == nil || member.metadata.CreatedAt.IsZero() {
			metadataPresent = false
		}
	}
	session.mu.Unlock()
	if !hasSnapshot || members != hostSourceProfilePods || int64(memberBytes) != metrics.memberEstimate {
		b.Fatalf("source membership: committed=%v members=%d bytes=%d expectedBytes=%d", hasSnapshot, members, memberBytes, metrics.memberEstimate)
	}
	if !metadataPresent {
		b.Fatal("committed source metadata was lost")
	}
	body := result.exampleBody.Map
	containers := body["spec"].Map["containers"].List
	managed := body["metadata"].Map["managedFields"].List
	conditions := body["status"].Map["conditions"].List
	if len(containers) != 1 || len(managed) != 1 || len(conditions) != 1 {
		b.Fatal("nested Pod fixture was lost in source view")
	}
	if len(containers[0].Map["env"].List) != 1 || containers[0].Map["resources"].Map["requests"].Map["cpu"].String != "250m" || managed[0].Map["fieldsV1"].Map["f:metadata"].Map["f:labels"].Kind != "map" {
		b.Fatal("nested Pod fields were lost in source view")
	}
	if captureHeap {
		runtime.GC()
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		b.ReportMetric(float64(memory.HeapAlloc), "snapshot-live-heap-B")
		file, err := os.Create(*hostSourceProfileSnapshotHeap)
		if err != nil {
			b.Fatal(err)
		}
		profileErr := pprof.WriteHeapProfile(file)
		closeErr := file.Close()
		if profileErr != nil {
			b.Fatal(profileErr)
		}
		if closeErr != nil {
			b.Fatal(closeErr)
		}
		runtime.KeepAlive(ctrl)
		runtime.KeepAlive(session)
	}
	return metrics
}

// The nested accounting fixture is intentionally retained, not flattened into
// names. Extra fields cover common Pod identity, scheduling, environment,
// resource requests, managed fields and readiness without a full object corpus.
func hostSourceProfilePod(target resourcev2.ReadTarget, i int) resourcev2.SourceObservation {
	observation := podAccountingObservation(i)
	address := &observation.Record.Reference.Address
	address.Provider, address.Authority, address.Type = target.Provider, target.Authority, target.Type
	uid := fmt.Sprintf("00000000-0000-4000-8000-%012d", i)
	revision := strconv.Itoa(10_000_000 + i)
	observation.Record.Reference.Incarnation = &uid
	observation.Record.SourceRevision = &revision
	created := time.Date(2026, time.November, 10, 0, 0, 0, 0, time.UTC)
	observation.Metadata = &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "example"}, CreatedAt: &created}
	metadata := observation.Record.Body.Map["metadata"].Map
	metadata["uid"] = resourcev2.Value{Kind: "string", String: uid}
	metadata["resourceVersion"] = resourcev2.Value{Kind: "string", String: revision}
	managed := metadata["managedFields"].List[0].Map
	managed["operation"] = resourcev2.Value{Kind: "string", String: "Update"}
	managed["fieldsType"] = resourcev2.Value{Kind: "string", String: "FieldsV1"}
	spec := observation.Record.Body.Map["spec"].Map
	spec["nodeName"] = resourcev2.Value{Kind: "string", String: fmt.Sprintf("worker-%03d", i%100)}
	container := spec["containers"].List[0].Map
	container["env"] = resourcev2.Value{Kind: "list", List: []resourcev2.Value{{Kind: "map", Map: map[string]resourcev2.Value{
		"name": {Kind: "string", String: "ENVIRONMENT"}, "value": {Kind: "string", String: "production"},
	}}}}
	container["resources"] = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"requests": {Kind: "map", Map: map[string]resourcev2.Value{
			"cpu": {Kind: "string", String: "250m"}, "memory": {Kind: "string", String: "128Mi"},
		}},
	}}
	status := observation.Record.Body.Map["status"].Map
	status["podIP"] = resourcev2.Value{Kind: "string", String: fmt.Sprintf("10.0.%d.%d", i/250, i%250+1)}
	status["conditions"] = resourcev2.Value{Kind: "list", List: []resourcev2.Value{{Kind: "map", Map: map[string]resourcev2.Value{
		"type": {Kind: "string", String: "Ready"}, "status": {Kind: "string", String: "True"},
	}}}}
	return observation
}

func hostSourceProfileFrames(b *testing.B, request resourcev2.SourceOpenRequest) ([][]byte, hostSourceProfileMetrics) {
	b.Helper()
	if request.Mode != resourcev2.SourceModeSnapshotAndUpdates || request.Limits.MaxBatchItems != defaultSourceMaxBatchItems {
		b.Fatalf("unexpected source negotiation: mode=%q batch=%d", request.Mode, request.Limits.MaxBatchItems)
	}
	var metrics hostSourceProfileMetrics
	frames := make([][]byte, 0, hostSourceProfilePods/defaultSourceMaxBatchItems+2)
	appendFrame := func(frame resourcev2.SourceFrame) {
		frame.SessionID, frame.Generation, frame.Sequence = request.SessionID, request.Generation, uint64(len(frames)+1)
		wire, err := resourcev2.ToProtoSourceFrame(frame)
		if err != nil {
			b.Fatal(err)
		}
		encoded, err := proto.Marshal(wire)
		if err != nil {
			b.Fatal(err)
		}
		if len(encoded) > int(request.Limits.MaxFrameBytes) {
			b.Fatal("fixture frame exceeds negotiated wire limit")
		}
		frames = append(frames, encoded)
		metrics.wireBytes += int64(len(encoded))
	}
	appendFrame(resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: request.Mode}})
	for start := 0; start < hostSourceProfilePods; start += defaultSourceMaxBatchItems {
		count := min(defaultSourceMaxBatchItems, hostSourceProfilePods-start)
		observations := make([]resourcev2.SourceObservation, count)
		for i := range observations {
			observations[i] = hostSourceProfilePod(request.Target, start+i)
			size, err := sourceMemberEstimate(observations[i], defaultSourceStagingBytes)
			if err != nil {
				b.Fatal(err)
			}
			metrics.memberEstimate += int64(size)
		}
		frame := resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}}
		if _, err := sourceFrameTransientEstimate(frame, maxSourceTransientBytes); err != nil {
			b.Fatal(err)
		}
		appendFrame(frame)
	}
	if metrics.memberEstimate > defaultSourceStagingBytes {
		b.Fatalf("20k-Pod fixture exceeds unchanged host staging limit: %d > %d", metrics.memberEstimate, defaultSourceStagingBytes)
	}
	appendFrame(sourceBoundary(resourcev2.EnumerationExhausted))
	return frames, metrics
}

type hostSourceProfileOpen struct {
	request resourcev2.SourceOpenRequest
	stream  *hostSourceProfileStream
}

type hostSourceProfileProvider struct {
	*mockProvider
	opens chan hostSourceProfileOpen
}

func (*hostSourceProfileProvider) Features(context.Context) (resourcev2.FeatureSet, error) {
	return resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnections, resourcev2.FeatureSourceSessions}}, nil
}

func (p *hostSourceProfileProvider) OpenSourceStream(ctx context.Context, request resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	stream := &hostSourceProfileStream{ctx: ctx, ready: make(chan struct{}), closed: make(chan struct{})}
	select {
	case p.opens <- hostSourceProfileOpen{request: request, stream: stream}:
		return stream, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Recv replaces only transport. It decodes the same protobuf/domain adapters as
// the SDK boundary, then hands each frame to sourceSession.receive unchanged.
// Waiting after SnapshotEnd preserves the real following-mode stream lifetime.
// frames is published by closing ready, then owned exclusively by Recv.
type hostSourceProfileStream struct {
	ctx    context.Context
	ready  chan struct{}
	closed chan struct{}
	once   sync.Once
	frames [][]byte
	next   int
}

func (s *hostSourceProfileStream) Recv() (resourcev2.SourceFrame, error) {
	select {
	case <-s.ready:
	case <-s.closed:
		return resourcev2.SourceFrame{}, io.EOF
	case <-s.ctx.Done():
		return resourcev2.SourceFrame{}, s.ctx.Err()
	}
	if s.next == len(s.frames) {
		select {
		case <-s.closed:
			return resourcev2.SourceFrame{}, io.EOF
		case <-s.ctx.Done():
			return resourcev2.SourceFrame{}, s.ctx.Err()
		}
	}
	encoded := s.frames[s.next]
	s.frames[s.next] = nil
	s.next++
	var wire resourcepb.SourceFrame
	if err := proto.Unmarshal(encoded, &wire); err != nil {
		return resourcev2.SourceFrame{}, err
	}
	return resourcev2.FromProtoSourceFrame(&wire)
}

func (s *hostSourceProfileStream) Close() { s.once.Do(func() { close(s.closed) }) }

type hostSourceProfileResult struct {
	records     int
	chunks      int
	status      HostSourceStatus
	committedAt time.Time
	completedAt time.Time
	exampleBody resourcev2.Value
	message     string
}

// Count unique rows without retaining every emitted Pod or adding a second
// object cache. One example body supports untimed nested-value assertions.
type hostSourceProfileEmitter struct {
	mu          sync.Mutex
	topic       string
	seen        []uint64
	records     int
	chunks      int
	generation  string
	sequence    uint64
	committedAt time.Time
	exampleBody resourcev2.Value
	completed   bool
	done        chan hostSourceProfileResult
	closed      chan struct{}
	closedOnce  sync.Once
}

func (e *hostSourceProfileEmitter) completeLocked(status HostSourceStatus, message string) {
	if e.completed {
		return
	}
	e.completed = true
	e.done <- hostSourceProfileResult{
		records: e.records, chunks: e.chunks, status: status,
		committedAt: e.committedAt, completedAt: time.Now(), exampleBody: e.exampleBody, message: message,
	}
}

func (e *hostSourceProfileEmitter) Emit(key string, data ...any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(data) != 1 {
		return
	}
	if key == EventSourceState {
		if event, ok := data[0].(HostSourceStateEvent); ok && event.PluginID == "p1" && event.Type == "native::Pod" && event.Route.Connection == "conn-1" {
			if event.Status.State == "following" && e.committedAt.IsZero() {
				e.committedAt = time.Now()
			}
			if event.Status.State == "failed" {
				e.completeLocked(event.Status, fmt.Sprintf("source failed: %+v", event.Status.Error))
			}
		}
		return
	}
	if key != e.topic {
		return
	}
	event, ok := data[0].(HostSourceViewEvent)
	if !ok {
		e.completeLocked(HostSourceStatus{}, "view emitter received an unexpected payload")
		return
	}
	if event.Kind == "reset" {
		if event.Reset != nil && event.Reset.Reason == "closed" {
			e.closedOnce.Do(func() { close(e.closed) })
		} else {
			e.completeLocked(HostSourceStatus{}, fmt.Sprintf("source view reset: %+v", event.Reset))
		}
		return
	}
	sequence, err := strconv.ParseUint(event.Sequence, 10, 64)
	if err != nil || sequence != e.sequence+1 || e.generation != "" && event.ViewGeneration != e.generation {
		e.completeLocked(HostSourceStatus{}, "source view sequence or generation changed before snapshot completion")
		return
	}
	e.sequence, e.generation = sequence, event.ViewGeneration
	switch event.Kind {
	case "snapshot":
		e.chunks++
		for _, record := range event.Records {
			id, hasPrefix := strings.CutPrefix(record.Record.Reference.Address.ID, "pod-")
			index, err := strconv.Atoi(id)
			if !hasPrefix || err != nil || index < 0 || index >= hostSourceProfilePods || record.Key == "" || record.AddressKey == "" {
				e.completeLocked(HostSourceStatus{}, "source view emitted an invalid Pod identity")
				return
			}
			mask := uint64(1) << uint(index%64)
			if e.seen[index/64]&mask != 0 {
				e.completeLocked(HostSourceStatus{}, "source view emitted a duplicate Pod")
				return
			}
			e.seen[index/64] |= mask
			if e.records == 0 {
				e.exampleBody = record.Record.Body
			}
			e.records++
		}
	case "snapshotEnd":
		if event.Status == nil {
			e.completeLocked(HostSourceStatus{}, "source snapshot ended without status")
			return
		}
		e.completeLocked(*event.Status, "")
	case "status":
		if event.Status != nil && event.Status.State == "failed" {
			e.completeLocked(*event.Status, fmt.Sprintf("source view failed: %+v", event.Status.Error))
		}
	default:
		e.completeLocked(HostSourceStatus{}, "source view emitted an unexpected event before snapshot completion")
	}
}
