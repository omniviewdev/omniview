package main

// Verification-only provider. It never contacts a cluster, cloud, engine or hypervisor.
import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Generated from the selected SDK by bench/app/export-resource-corpus.mjs.
//
//go:embed resource-corpus.json
var benchmarkCorpus []byte

type benchmarkRecord struct {
	Name, ID string
	Body     json.RawMessage
}
type benchmarkPage struct {
	Cursor, Next string
	Records      []string
}
type benchmarkChange struct {
	Record, Revision string
	Body             json.RawMessage
}
type benchmarkScenario struct {
	Name, Profile, Type, Freshness string
	Pages                          []benchmarkPage
	Updates                        []benchmarkChange
	Coverage                       json.RawMessage
}
type benchmarkClient struct{ name string }
type benchmarkSource struct {
	records                                                      map[string]benchmarkRecord
	scenarios                                                    map[string]benchmarkScenario
	provenance                                                   json.RawMessage
	mu                                                           sync.Mutex
	connections, watches, calls, rows, bodyBytes, events, closed int64
	release                                                      map[string]chan struct{}
	lifecycle                                                    io.Writer
}

func loadBenchmarkSource() (*benchmarkSource, error) {
	var snapshot struct {
		Provenance json.RawMessage `json:"provenance"`
		Corpus     struct {
			Records   []benchmarkRecord
			Scenarios []benchmarkScenario
		} `json:"corpus"`
	}
	if err := json.Unmarshal(benchmarkCorpus, &snapshot); err != nil {
		return nil, err
	}
	source := &benchmarkSource{records: map[string]benchmarkRecord{}, scenarios: map[string]benchmarkScenario{}, provenance: snapshot.Provenance, release: map[string]chan struct{}{}, lifecycle: os.Stderr}
	for _, record := range snapshot.Corpus.Records {
		source.records[record.Name] = record
	}
	for _, scenario := range snapshot.Corpus.Scenarios {
		source.scenarios[scenario.Name] = scenario
	}
	// Independent Kubernetes-shaped verification fixture; not the Kubernetes product provider.
	source.records["kubernetes-pod"] = benchmarkRecord{Name: "kubernetes-pod", ID: "pod-0", Body: json.RawMessage(`{"apiVersion":"v1","kind":"Pod","metadata":{"name":"p02-pod-0","namespace":"verification","uid":"p02-fixture-0","labels":{"app":"p02"}},"spec":{"containers":[{"name":"main","image":"verification.invalid/no-pull:0"}]},"status":{"phase":"Running"}}`)}
	source.scenarios["kubernetes-snapshot"] = benchmarkScenario{Name: "kubernetes-snapshot", Profile: "kubernetes", Type: "core::v1::Pod", Freshness: "snapshot-only", Pages: []benchmarkPage{{Records: []string{"kubernetes-pod"}}}}
	for _, name := range benchmarkProfiles {
		if _, ok := source.scenarios[name]; !ok {
			return nil, fmt.Errorf("missing canonical scenario %s", name)
		}
	}
	return source, nil
}

var benchmarkProfiles = []string{"cloud-bundled-pages", "container-bundled-events", "hypervisor-bundled-vms", "kubernetes-snapshot"}

func (p *benchmarkSource) LoadConnections(context.Context) ([]types.Connection, error) {
	out := make([]types.Connection, 0, len(benchmarkProfiles))
	for _, name := range benchmarkProfiles {
		out = append(out, types.Connection{ID: name, Name: "P02 verification: " + name})
	}
	return out, nil
}
func (p *benchmarkSource) CreateClient(ctx context.Context) (*benchmarkClient, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return nil, benchmarkError("INVALID_INPUT", "missing connection")
	}
	if _, ok := p.scenarios[session.Connection.ID]; !ok {
		return nil, benchmarkError("NOT_FOUND", "unknown fixture connection")
	}
	p.mu.Lock()
	p.connections++
	p.mu.Unlock()
	return &benchmarkClient{name: session.Connection.ID}, nil
}
func (p *benchmarkSource) DestroyClient(_ context.Context, _ *benchmarkClient) error {
	p.mu.Lock()
	p.connections--
	p.closed++
	p.writeLifecycleLocked()
	p.mu.Unlock()
	return nil
}

// Called under mu at both removal boundaries: cancellation and client destruction
// can complete in either order. Only actual numeric fixture gauges are emitted.
func (p *benchmarkSource) writeLifecycleLocked() {
	fmt.Fprintf(p.lifecycle, "{\"p02Lifecycle\":{\"activeConnections\":%d,\"activeSourceWatches\":%d}}\n", p.connections, p.watches)
}
func (*benchmarkSource) CheckConnection(_ context.Context, connection *types.Connection, _ *benchmarkClient) (types.ConnectionStatus, error) {
	return types.ConnectionStatus{Connection: connection, Status: types.ConnectionStatusConnected}, nil
}
func (*benchmarkSource) GetNamespaces(context.Context, *benchmarkClient) ([]string, error) {
	return nil, nil
}

func (p *benchmarkSource) List(ctx context.Context, client *benchmarkClient, _ resource.ResourceMeta, input resource.ListInput) (*resource.ListResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	scenario, ok := p.scenarios[client.name]
	if !ok {
		return nil, benchmarkError("NOT_FOUND", "unknown source")
	}
	cursor := input.Pagination.Cursor
	if cursor == "p02:metrics" || cursor == "p02:metrics:gc" {
		if cursor == "p02:metrics:gc" {
			runtime.GC()
		}
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		p.mu.Lock()
		diagnostics := map[string]any{"providerPID": os.Getpid(), "activeConnections": p.connections, "activeSourceWatches": p.watches, "finiteCalls": p.calls, "rowsCopied": p.rows, "nativeBodyBytesCopied": p.bodyBytes, "eventsEmitted": p.events, "connectionsClosed": p.closed, "providerHeapAlloc": mem.HeapAlloc, "providerHeapObjects": mem.HeapObjects, "providerGoroutines": runtime.NumGoroutine(), "provenance": p.provenance, "scenario": scenario}
		p.mu.Unlock()
		body, err := json.Marshal(diagnostics)
		if err != nil {
			return nil, err
		}
		return &resource.ListResult{Success: true, Result: []json.RawMessage{body}, TotalCount: 1}, nil
	}
	if cursor == "p02:release" {
		p.mu.Lock()
		ch := p.release[client.name]
		if ch != nil {
			close(ch)
			delete(p.release, client.name)
		}
		p.mu.Unlock()
		if ch == nil {
			return nil, benchmarkError("INVALID_INPUT", "no ready source watch")
		}
		return &resource.ListResult{Success: true}, nil
	}
	var result []json.RawMessage
	next := ""
	if strings.HasPrefix(cursor, "p02:copies:") {
		parts := strings.Split(cursor, ":")
		if len(parts) != 4 {
			return nil, benchmarkError("INVALID_INPUT", "invalid stress cursor")
		}
		count, e1 := strconv.Atoi(parts[2])
		start, e2 := strconv.Atoi(parts[3])
		if e1 != nil || e2 != nil || count < 1 || count > 10000 || start < 0 || start >= count {
			return nil, benchmarkError("INVALID_INPUT", "invalid stress bounds")
		}
		var names []string
		for _, page := range scenario.Pages {
			names = append(names, page.Records...)
		}
		end := min(start+200, count)
		for i := start; i < end; i++ {
			result = append(result, p.records[names[i%len(names)]].Body)
		}
		if end < count {
			next = fmt.Sprintf("p02:copies:%d:%d", count, end)
		}
	} else {
		found := false
		for _, page := range scenario.Pages {
			if page.Cursor != cursor {
				continue
			}
			found = true
			next = page.Next
			for _, name := range page.Records {
				result = append(result, p.records[name].Body)
			}
			break
		}
		if !found {
			return nil, benchmarkError("INVALID_INPUT", "unknown native cursor")
		}
	}
	p.mu.Lock()
	p.calls++
	p.rows += int64(len(result))
	for _, body := range result {
		p.bodyBytes += int64(len(body))
	}
	p.mu.Unlock()
	return &resource.ListResult{Success: true, Result: result, NextCursor: next, TotalCount: -1}, nil
}
func (p *benchmarkSource) Get(_ context.Context, client *benchmarkClient, _ resource.ResourceMeta, input resource.GetInput) (*resource.GetResult, error) {
	scenario := p.scenarios[client.name]
	var found json.RawMessage
	for _, page := range scenario.Pages {
		for _, name := range page.Records {
			record := p.records[name]
			if record.ID == input.ID {
				if found != nil {
					return nil, benchmarkError("INVALID_INPUT", "ambiguous native scope; old Get cannot encode it")
				}
				found = record.Body
			}
		}
	}
	if found == nil {
		return nil, benchmarkError("NOT_FOUND", "unknown fixture record")
	}
	return &resource.GetResult{Success: true, Result: found}, nil
}
func (*benchmarkSource) Find(context.Context, *benchmarkClient, resource.ResourceMeta, resource.FindInput) (*resource.FindResult, error) {
	return nil, benchmarkError("UNSUPPORTED", "no server query in verification source")
}
func (*benchmarkSource) Create(context.Context, *benchmarkClient, resource.ResourceMeta, resource.CreateInput) (*resource.CreateResult, error) {
	return nil, benchmarkError("UNSUPPORTED", "read-only verification source")
}
func (*benchmarkSource) Update(context.Context, *benchmarkClient, resource.ResourceMeta, resource.UpdateInput) (*resource.UpdateResult, error) {
	return nil, benchmarkError("UNSUPPORTED", "read-only verification source")
}
func (*benchmarkSource) Delete(context.Context, *benchmarkClient, resource.ResourceMeta, resource.DeleteInput) (*resource.DeleteResult, error) {
	return nil, benchmarkError("UNSUPPORTED", "read-only verification source")
}
func (p *benchmarkSource) GetResourceSchema(context.Context, *benchmarkClient, resource.ResourceMeta) (json.RawMessage, error) {
	return nil, nil
}
func benchmarkError(code, message string) error {
	return &resource.ResourceOperationError{Code: code, Title: "P02 verification source", Message: message}
}

type benchmarkEvents struct{ *benchmarkSource }

func (*benchmarkEvents) SyncPolicy() resource.SyncPolicy { return resource.SyncNever }
func (p *benchmarkEvents) Watch(ctx context.Context, client *benchmarkClient, _ resource.ResourceMeta, sink resource.WatchEventSink) error {
	scenario := p.scenarios[client.name]
	if len(scenario.Updates) == 0 {
		return benchmarkError("UNSUPPORTED", "snapshot-only fixture")
	}
	release := make(chan struct{})
	p.mu.Lock()
	p.release[client.name] = release
	p.watches++
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		if p.release[client.name] == release {
			delete(p.release, client.name)
		}
		p.watches--
		p.writeLifecycleLocked()
		p.mu.Unlock()
	}()
	sink.OnStateChange(resource.WatchStateEvent{ResourceKey: scenario.Type, State: resource.WatchStateSynced})
	select {
	case <-ctx.Done():
		return nil
	case <-release:
		for _, change := range scenario.Updates {
			sink.OnUpdate(resource.WatchUpdatePayload{Key: scenario.Type, ID: p.records[change.Record].ID, Data: change.Body})
			p.mu.Lock()
			p.events++
			p.mu.Unlock()
		}
	}
	<-ctx.Done()
	return nil
}
