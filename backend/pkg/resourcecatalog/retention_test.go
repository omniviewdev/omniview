package resourcecatalog_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"weak"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

// retentionUnionSchema has exactly two union nodes: the root anyOf and the
// nested spec oneOf.
const retentionUnionSchema = `{
	"type": "object",
	"properties": {
		"kind": {"type": "string"},
		"spec": {"oneOf": [
			{"type": "object", "required": ["mode"], "properties": {"mode": {"const": "a"}}},
			{"type": "object", "required": ["mode"], "properties": {"mode": {"const": "b"}, "size": {"type": "integer"}}}
		]}
	},
	"anyOf": [
		{"type": "object", "required": ["shared"], "properties": {"shared": {"type": "string"}, "a": {"type": "string"}}},
		{"type": "object", "required": ["shared"], "properties": {"shared": {"type": "string"}, "a": {"type": "string"}, "b": {"type": "integer"}}}
	]
}`

const retentionUnionNodes = 2

// retentionBody is valid for both anyOf branches.
const retentionBody = `{"kind":"x","shared":"s","a":"y","spec":{"mode":"b","size":3}}`

const retentionPlainSchema = `{"type":"object","properties":{"name":{"type":"string"}}}`

var retentionCoverage = resourcev2.Coverage{Kind: "complete"}

func retentionCatalog() resourcev2.Catalog {
	resourceType := func(name string) resourcev2.ResourceType {
		return resourcev2.ResourceType{Type: name, DisplayName: name, DefaultRepresentation: "r",
			Representations: []resourcev2.Representation{{ID: "r", Revision: "rep/1"}}}
	}
	return resourcev2.Catalog{Provider: "test", Revision: "c1", Types: []resourcev2.ResourceType{
		resourceType("union"),
		resourceType("plain"),
	}}
}

func retentionSource(connection string) resourcecatalog.BindingSource {
	representation := resourcev2.Representation{ID: "r", Revision: "rep/1"}
	revision := "schema/1"
	return func(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if request.Route.Connection != connection || request.Target.Auxiliary != nil ||
			request.Target.Representation == nil || *request.Target.Representation != representation {
			return resourcev2.SchemaBinding{}, resourcev2.NewError("INVALID_REQUEST", "schema request escaped its retention fixture")
		}
		var document string
		switch request.Type {
		case "union":
			document = retentionUnionSchema
		case "plain":
			document = retentionPlainSchema
		default:
			return resourcev2.SchemaBinding{}, resourcev2.NewError("NOT_FOUND", "schema target is not in the retention fixture")
		}
		return resourcev2.SchemaBinding{State: "available", Revision: &revision,
			Dialect: resourcev2.DialectJSONSchema202012, Document: json.RawMessage(document)}, nil
	}
}

func retentionKey(connection string) resourcecatalog.ConnectionKey {
	return resourcecatalog.ConnectionKey{PluginID: "plugin", Generation: "g1", Connection: connection, Epoch: 1}
}

func mustValue(t testing.TB, raw string) resourcev2.Value {
	t.Helper()
	v, err := resourcev2.JSONToValue([]byte(raw))
	if err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return v
}

func resolveType(t testing.TB, snapshot *resourcecatalog.Snapshot, resourceType string, resolve resourcecatalog.BindingSource) (*resourcecatalog.Entry, *resourcecatalog.Schema) {
	t.Helper()
	entry, err := snapshot.Entry(resourceType, "r")
	if err != nil {
		t.Fatal(err)
	}
	resolution, err := entry.Resolve(context.Background(), resolve, nil)
	if err != nil {
		t.Fatalf("resolve %s: %v", resourceType, err)
	}
	return entry, resolution.Schema
}

// admitAndNavigate exercises the read paths that must not grow retention.
func admitAndNavigate(t testing.TB, schema *resourcecatalog.Schema, value resourcev2.Value, policy resourcecatalog.Policy) {
	admission, err := resourcecatalog.Admit(context.Background(), schema, value, retentionCoverage, policy)
	if err != nil || admission.Validation != "full" {
		t.Fatalf("admit = %+v, %v", admission, err)
	}
	for _, path := range [][]resourcecatalog.PathSegment{nil, {{Kind: resourcecatalog.SegmentField, Name: "spec"}}} {
		navigation, err := resourcecatalog.Navigate(context.Background(), schema, path, policy)
		if err != nil || len(navigation.Fields) == 0 {
			t.Fatalf("navigate %v = %+v, %v", path, navigation, err)
		}
	}
}

func heapSample() runtime.MemStats {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats
}

// residentBytes reads Linux RSS from /proc/self/statm; ok is false elsewhere.
func residentBytes() (int64, bool) {
	if runtime.GOOS != "linux" {
		return 0, false
	}
	raw, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0, false
	}
	fields := strings.Fields(string(raw))
	if len(fields) < 2 {
		return 0, false
	}
	pages, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return pages * int64(os.Getpagesize()), true
}

func TestRetentionSequentialAdmitNavigate(t *testing.T) {
	policy := resourcecatalog.DefaultPolicy()
	catalog := resourcecatalog.NewCatalog(policy)
	snapshot := catalog.Observe(retentionKey("a"), retentionCatalog())
	_, schema := resolveType(t, snapshot, "union", retentionSource("a"))
	value := mustValue(t, retentionBody)

	// Warm the lazily built, document-lifetime caches once.
	admitAndNavigate(t, schema, value, policy)
	before := catalog.Stats()
	heapBefore := heapSample()
	rssBefore, rssOK := residentBytes()

	for range 10_000 {
		admitAndNavigate(t, schema, value, policy)
	}

	heapAfter := heapSample()
	rssAfter, _ := residentBytes()
	after := catalog.Stats()
	runtime.KeepAlive(schema)

	if before != after {
		t.Fatalf("stats changed: before %+v after %+v", before, after)
	}
	if after.Entries != 2 || after.Documents != 1 || after.BranchViews > retentionUnionNodes || after.CELProviders > 1 {
		t.Fatalf("stats = %+v", after)
	}
	heapDelta := int64(heapAfter.HeapAlloc) - int64(heapBefore.HeapAlloc)
	t.Logf("HeapAlloc delta %d B (before %d, after %d)", heapDelta, heapBefore.HeapAlloc, heapAfter.HeapAlloc)
	t.Logf("HeapInuse delta %d B, HeapSys delta %d B",
		int64(heapAfter.HeapInuse)-int64(heapBefore.HeapInuse), int64(heapAfter.HeapSys)-int64(heapBefore.HeapSys))
	if rssOK {
		t.Logf("RSS delta %d B (before %d, after %d)", rssAfter-rssBefore, rssBefore, rssAfter)
	} else {
		t.Logf("RSS not measured on %s", runtime.GOOS)
	}
	if heapDelta >= 1<<20 {
		t.Fatalf("HeapAlloc grew by %d bytes over 10,000 admit+navigate calls", heapDelta)
	}
}

// mixedWorkload runs one Observe/Resolve/Admit/Navigate/NewEnvironment round
// against a stable catalog revision, so every run converges on the same stats.
func mixedWorkload(catalog *resourcecatalog.Catalog, connection string, value resourcev2.Value, policy resourcecatalog.Policy) error {
	snapshot := catalog.Observe(retentionKey(connection), retentionCatalog())
	resolve := retentionSource(connection)
	for _, resourceType := range []string{"union", "plain"} {
		entry, err := snapshot.Entry(resourceType, "r")
		if err != nil {
			return err
		}
		resolution, err := entry.Resolve(context.Background(), resolve, nil)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", resourceType, err)
		}
		schema := resolution.Schema
		if _, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema); err != nil {
			return fmt.Errorf("environment %s: %w", resourceType, err)
		}
		if _, err := resourcecatalog.Navigate(context.Background(), schema, nil, policy); err != nil {
			return fmt.Errorf("navigate %s: %w", resourceType, err)
		}
		if resourceType == "union" {
			if _, err := resourcecatalog.Admit(context.Background(), schema, value, retentionCoverage, policy); err != nil {
				return fmt.Errorf("admit: %w", err)
			}
		}
	}
	return nil
}

func TestConcurrentMixedWorkloadMatchesSequential(t *testing.T) {
	const goroutines, iterations = 64, 1_000
	connections := []string{"a", "b", "c", "d"}
	policy := resourcecatalog.DefaultPolicy()
	value := mustValue(t, retentionBody)

	sequential := resourcecatalog.NewCatalog(policy)
	for i := range goroutines * iterations {
		if err := mixedWorkload(sequential, connections[i%len(connections)], value, policy); err != nil {
			t.Fatal(err)
		}
	}

	concurrent := resourcecatalog.NewCatalog(policy)
	errs := make(chan error, goroutines)
	var wg sync.WaitGroup
	for g := range goroutines {
		wg.Go(func() {
			for i := range iterations {
				if err := mixedWorkload(concurrent, connections[(g+i)%len(connections)], value, policy); err != nil {
					errs <- err
					return
				}
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	want, got := sequential.Stats(), concurrent.Stats()
	t.Logf("sequential %+v concurrent %+v", want, got)
	if want != got {
		t.Fatalf("concurrent stats %+v differ from sequential %+v", got, want)
	}
	if got.Connections != len(connections) || got.Documents != 2 || got.BranchViews > retentionUnionNodes || got.CELProviders != 2 {
		t.Fatalf("stats = %+v", got)
	}
}

// observeAndUse builds every document cache and returns only a weak pointer,
// so no strong reference to the document outlives this frame.
func observeAndUse(t *testing.T, catalog *resourcecatalog.Catalog, connections []string) weak.Pointer[resourcecatalog.Document] {
	t.Helper()
	policy := resourcecatalog.DefaultPolicy()
	value := mustValue(t, retentionBody)
	var document *resourcecatalog.Document
	for _, connection := range connections {
		if err := mixedWorkload(catalog, connection, value, policy); err != nil {
			t.Fatal(err)
		}
		_, schema := resolveType(t, catalog.Observe(retentionKey(connection), retentionCatalog()), "union", retentionSource(connection))
		if _, err := schema.Document.EditorJSON(); err != nil {
			t.Fatal(err)
		}
		document = schema.Document
	}
	return weak.Make(document)
}

func TestCleanupReleasesEveryDocument(t *testing.T) {
	connections := []string{"a", "b"}
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	document := observeAndUse(t, catalog, connections)
	if stats := catalog.Stats(); stats.Connections != 2 || stats.Documents != 2 || stats.CELProviders == 0 || stats.BranchViews == 0 {
		t.Fatalf("stats before drop = %+v", stats)
	}

	catalog.DropConnection("plugin", "a")
	if stats := catalog.Stats(); stats.Connections != 1 || stats.Documents != 2 {
		t.Fatalf("stats after one drop = %+v", stats)
	}
	catalog.DropConnection("plugin", "b")
	if stats := catalog.Stats(); stats != (resourcecatalog.Stats{}) {
		t.Fatalf("stats after drop = %+v", stats)
	}

	for attempt := 0; document.Value() != nil; attempt++ {
		if attempt == 10 {
			t.Fatal("dropped document is still reachable after 10 GC cycles")
		}
		runtime.GC()
	}
}
