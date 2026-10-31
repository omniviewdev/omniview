package main

// Verification-only provider. It never contacts a cluster, cloud, engine or hypervisor.
// The V2 catalog advertises one exact type per fixed connection. Source pages
// retain corpus scopes and tagged scalar values under the host-admitted target.
// Diagnostic stress repetition happens in the UI, never inside canonical pages.
// Only the container profile supplies advisory updates, released explicitly.
import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Generated from the selected SDK by bench/app/export-resource-corpus.mjs.
//
//go:embed resource-corpus.json
var benchmarkCorpus []byte

type benchmarkRecord struct {
	Name, ID, Incarnation, Revision string
	Scope                           map[string]string
	Body                            json.RawMessage
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

func (p *benchmarkSource) Catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	if err := ctx.Err(); err != nil {
		return resource.Catalog{}, err
	}
	scenario, ok := p.scenarios[request.Route.Connection]
	if !ok {
		return resource.Catalog{}, benchmarkError("NOT_FOUND", "unknown fixture connection")
	}
	dimensions := make([]resource.Dimension, 0)
	for name := range p.records[scenario.Pages[0].Records[0]].Scope {
		dimensions = append(dimensions, resource.Dimension{Name: name})
	}
	sort.Slice(dimensions, func(i, j int) bool { return dimensions[i].Name < dimensions[j].Name })
	scope := make(resource.QueryScope, 0, len(dimensions))
	for _, dimension := range dimensions {
		scope = append(scope, resource.ScopeConstraint{Dimension: dimension.Name, Match: resource.ScopeAny})
	}
	capabilities := []resource.Capability{
		{Operation: resource.OperationEnumerate, Scope: scope},
		{Operation: resource.OperationGet, Scope: scope},
	}
	if len(scenario.Updates) > 0 {
		capabilities = append(capabilities, resource.Capability{Operation: resource.OperationUpdate, Scope: scope, Guarantee: resource.BestEffortGuarantee})
	}
	return resource.Catalog{
		Provider: "workspace-probe", Revision: "fixture-v2-1", Coverage: resource.Coverage{Kind: "complete"},
		Types: []resource.ResourceType{{
			Type: scenario.Type, DisplayName: scenario.Type, IdentityDimensions: dimensions, QueryDimensions: dimensions,
			Representations: []resource.Representation{nativeRepresentation()}, DefaultRepresentation: "native",
			Capabilities: capabilities,
		}},
	}, nil
}

func (p *benchmarkSource) LoadConnections(context.Context) ([]types.Connection, error) {
	out := make([]types.Connection, 0, len(benchmarkProfiles))
	for _, name := range benchmarkProfiles {
		out = append(out, types.Connection{ID: name, Name: "P02 verification: " + name})
	}
	return out, nil
}
func (p *benchmarkSource) CreateClient(_ context.Context, connection types.Connection) (*benchmarkClient, error) {
	if _, ok := p.scenarios[connection.ID]; !ok {
		return nil, benchmarkError("NOT_FOUND", "unknown fixture connection")
	}
	p.mu.Lock()
	p.connections++
	p.mu.Unlock()
	return &benchmarkClient{name: connection.ID}, nil
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
func (*benchmarkSource) CheckConnection(_ context.Context, connection types.Connection, _ *benchmarkClient) (types.ConnectionStatus, error) {
	return types.ConnectionStatus{Connection: &connection, Status: types.ConnectionStatusConnected}, nil
}

func (p *benchmarkSource) Enumerate(ctx context.Context, client *benchmarkClient, input resource.EnumerateRequest) (resource.SourcePage, error) {
	if err := ctx.Err(); err != nil {
		return resource.SourcePage{}, err
	}
	scenario, ok := p.scenarios[client.name]
	if !ok {
		return resource.SourcePage{}, benchmarkError("NOT_FOUND", "unknown source")
	}
	cursor := ""
	if input.Cursor != nil {
		cursor = *input.Cursor
	}
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
			return resource.SourcePage{}, err
		}
		return p.page(input.Target, []benchmarkRecord{{Name: "metrics", ID: "metrics", Scope: p.records[scenario.Pages[0].Records[0]].Scope, Body: body}}, "", resource.Count{Kind: "exact", Value: stringPointer("1")})
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
			return resource.SourcePage{}, benchmarkError("INVALID_REQUEST", "no ready source watch")
		}
		return p.page(input.Target, nil, "", resource.Count{Kind: "exact", Value: stringPointer("0")})
	}
	// A split native page retains its original cursor and filtered-record offset.
	// The envelope is source-local and never changes a corpus address.
	nativeCursor, offset := cursor, 0
	if strings.HasPrefix(cursor, "p02:page:") {
		data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(cursor, "p02:page:"))
		var continuation struct {
			Cursor string
			Offset int
		}
		if err != nil {
			return resource.SourcePage{}, benchmarkError("INVALID_REQUEST", "invalid page cursor")
		}
		if err := json.Unmarshal(data, &continuation); err != nil || continuation.Offset < 1 {
			return resource.SourcePage{}, benchmarkError("INVALID_REQUEST", "invalid page offset")
		}
		nativeCursor, offset = continuation.Cursor, continuation.Offset
	}
	var result []benchmarkRecord
	next := ""
	found := false
	for _, page := range scenario.Pages {
		if page.Cursor != nativeCursor {
			continue
		}
		found = true
		for _, name := range page.Records {
			item := p.records[name]
			if matchesScope(item.Scope, input.Target.Scope) {
				result = append(result, item)
			}
		}
		if offset > len(result) {
			return resource.SourcePage{}, benchmarkError("INVALID_REQUEST", "page offset out of bounds")
		}
		end := len(result)
		if input.PageSize != 0 && uint64(end-offset) > uint64(input.PageSize) {
			end = offset + int(input.PageSize)
		}
		next = page.Next
		if end < len(result) {
			data, err := json.Marshal(struct {
				Cursor string
				Offset int
			}{nativeCursor, end})
			if err != nil {
				return resource.SourcePage{}, err
			}
			next = "p02:page:" + base64.RawURLEncoding.EncodeToString(data)
		}
		result = result[offset:end]
		break
	}
	if !found {
		return resource.SourcePage{}, benchmarkError("INVALID_REQUEST", "unknown native cursor")
	}
	p.mu.Lock()
	p.calls++
	p.rows += int64(len(result))
	for _, body := range result {
		p.bodyBytes += int64(len(body.Body))
	}
	p.mu.Unlock()
	return p.page(input.Target, result, next, resource.Count{Kind: "unknown"})
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func matchesScope(scope map[string]string, constraints resource.QueryScope) bool {
	for _, constraint := range constraints {
		if constraint.Match == resource.ScopeAny {
			continue
		}
		matched := false
		if constraint.Values != nil {
			for _, value := range *constraint.Values {
				if actual, ok := scope[constraint.Dimension]; ok && actual == value {
					matched = true
					break
				}
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func nativeRepresentation() resource.Representation {
	return resource.Representation{ID: "native", Revision: "1", Schema: resource.SchemaBinding{State: "absent", Validation: "none"}}
}

func (p *benchmarkSource) record(target resource.ReadTarget, item benchmarkRecord) (resource.Record, error) {
	body, err := resource.JSONToValue(item.Body)
	if err != nil {
		return resource.Record{}, err
	}
	scope := make([]resource.ScopeEntry, 0, len(item.Scope))
	for dimension, value := range item.Scope {
		scope = append(scope, resource.ScopeEntry{Dimension: dimension, Value: value})
	}
	sort.Slice(scope, func(i, j int) bool { return scope[i].Dimension < scope[j].Dimension })
	return resource.Record{
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, Scope: scope, ID: item.ID}, Incarnation: stringPointer(item.Incarnation)},
		Body:      body, Representation: nativeRepresentation(), Coverage: resource.Coverage{Kind: "complete"}, SourceRevision: stringPointer(item.Revision),
	}, nil
}

func (p *benchmarkSource) page(target resource.ReadTarget, items []benchmarkRecord, next string, count resource.Count) (resource.SourcePage, error) {
	records := make([]resource.Record, 0, len(items))
	for _, item := range items {
		if !matchesScope(item.Scope, target.Scope) {
			continue
		}
		record, err := p.record(target, item)
		if err != nil {
			return resource.SourcePage{}, err
		}
		records = append(records, record)
	}
	if count.Kind == "exact" {
		count.Value = stringPointer(fmt.Sprint(len(records)))
	}
	return resource.SourcePage{Records: records, NextCursor: stringPointer(next), Count: count, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
}

func (p *benchmarkSource) Get(ctx context.Context, client *benchmarkClient, input resource.GetRequest) (resource.Record, error) {
	if err := ctx.Err(); err != nil {
		return resource.Record{}, err
	}
	target := resource.ReadTarget{Route: input.Route, Provider: input.Reference.Address.Provider, Authority: input.Reference.Address.Authority, Type: input.Reference.Address.Type, Representation: input.Representation}
	for _, page := range p.scenarios[client.name].Pages {
		for _, name := range page.Records {
			record, err := p.record(target, p.records[name])
			if err != nil {
				return resource.Record{}, err
			}
			address := record.Reference.Address
			expected := input.Reference.Address
			if address.Provider != expected.Provider || address.Authority != expected.Authority || address.Type != expected.Type || address.ID != expected.ID || len(address.Scope) != len(expected.Scope) {
				continue
			}
			scope := make(map[string]string, len(address.Scope))
			for _, entry := range address.Scope {
				scope[entry.Dimension] = entry.Value
			}
			same := true
			for _, entry := range expected.Scope {
				if value, ok := scope[entry.Dimension]; !ok || value != entry.Value {
					same = false
					break
				}
			}
			if !same {
				continue
			}
			if input.Reference.Incarnation != nil && (record.Reference.Incarnation == nil || *input.Reference.Incarnation != *record.Reference.Incarnation) {
				continue
			}
			return record, nil
		}
	}
	return resource.Record{}, benchmarkError("NOT_FOUND", "unknown fixture record")
}

func benchmarkError(code, message string) error {
	return resource.NewError(code, message)
}

type benchmarkEvents struct{ *benchmarkSource }

func (p *benchmarkEvents) Watch(ctx context.Context, client *benchmarkClient, target resource.ReadTarget, _ resource.Representation, sink resource.WatchEventSink) error {
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
	sink.OnStateChange(resource.WatchStateEvent{Route: target.Route, Type: scenario.Type, State: resource.WatchStateSynced, Count: resource.Count{Kind: "unknown"}, Guarantee: resource.BestEffortGuarantee})
	select {
	case <-ctx.Done():
		return nil
	case <-release:
		for _, change := range scenario.Updates {
			item := p.records[change.Record]
			if !matchesScope(item.Scope, target.Scope) {
				continue
			}
			item.Body, item.Revision = change.Body, change.Revision
			record, err := p.record(target, item)
			if err != nil {
				return err
			}
			sink.OnUpdate(resource.WatchUpdatePayload{Route: target.Route, Record: record, Guarantee: resource.BestEffortGuarantee})
			p.mu.Lock()
			p.events++
			p.mu.Unlock()
		}
	}
	<-ctx.Done()
	return nil
}
