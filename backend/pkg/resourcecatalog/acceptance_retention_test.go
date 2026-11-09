package resourcecatalog_test

// P07 acceptance: repeated and concurrent admissions retain no per-row schemas.
//
// The existing retention tests repeat one row and measure heap sequentially.
// These tests admit tens of thousands of distinct rows, sequentially and from
// many goroutines at once, while a sampler reads catalog statistics. They
// measure entries, retained documents, branch views and CEL providers, the
// physical heap after garbage collection, and the cleanup that follows
// DropConnection. A control run that does retain per-row state proves the heap
// measurement can see retention at all.

import (
	"context"
	"fmt"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"weak"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

// p07RowSchema has exactly two union nodes: the root anyOf and the spec oneOf.
const p07RowSchema = `{
	"type": "object",
	"required": ["id"],
	"properties": {
		"id": {"type": "string", "minLength": 1},
		"kind": {"enum": ["a", "b", "c"]},
		"size": {"type": "integer", "minimum": 0},
		"tags": {"type": "object", "additionalProperties": {"type": "string"}},
		"items": {"type": "array", "maxItems": 8, "items": {
			"type": "object", "required": ["n"], "properties": {"n": {"type": "integer"}}}},
		"spec": {"oneOf": [
			{"type": "object", "required": ["mode"], "properties": {"mode": {"const": "fast"}}},
			{"type": "object", "required": ["mode"], "properties": {"mode": {"const": "safe"}, "retries": {"type": "integer"}}}
		]}
	},
	"anyOf": [
		{"type": "object", "properties": {"a": {"type": "string"}, "shared": {"type": "string"}}},
		{"type": "object", "properties": {"b": {"type": "integer"}, "shared": {"type": "string"}}}
	]
}`

const p07RowUnionNodes = 2

const p07PlainSchema = `{"type":"object","properties":{"name":{"type":"string"}}}`

type p07RowClass int

const (
	p07RowValid p07RowClass = iota
	p07RowInvalid
	p07RowPartial
)

// p07RowClassOf is the generator's intent for row i: every seventh row breaks
// "size", every eleventh remaining row omits "id" under unknown-location
// partial coverage. The assertions below check the actual admission outcome.
func p07RowClassOf(i int) p07RowClass {
	switch {
	case i%7 == 0:
		return p07RowInvalid
	case i%11 == 0:
		return p07RowPartial
	default:
		return p07RowValid
	}
}

// p07Row builds a distinct row: its id, size, tags, list length and union
// branch all depend on i, and every call allocates fresh values.
func p07Row(i int) resourcev2.Value {
	str := func(s string) resourcev2.Value { return resourcev2.Value{Kind: "string", String: s} }
	num := func(n int) resourcev2.Value { return resourcev2.Value{Kind: "int64", Int: strconv.Itoa(n)} }
	items := make([]resourcev2.Value, i%9)
	for j := range items {
		items[j] = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"n": num(i + j)}}
	}
	spec := map[string]resourcev2.Value{"mode": str("fast")}
	if i%2 == 1 {
		spec = map[string]resourcev2.Value{"mode": str("safe"), "retries": num(i % 5)}
	}
	fields := map[string]resourcev2.Value{
		"id":     str("row-" + strconv.Itoa(i)),
		"kind":   str([]string{"a", "b", "c"}[i%3]),
		"size":   num(i),
		"tags":   {Kind: "map", Map: map[string]resourcev2.Value{"k" + strconv.Itoa(i%13): str("v" + strconv.Itoa(i))}},
		"items":  {Kind: "list", List: items},
		"spec":   {Kind: "map", Map: spec},
		"a":      str("x"),
		"b":      num(i),
		"shared": str("s"),
	}
	switch p07RowClassOf(i) {
	case p07RowInvalid:
		fields["size"] = num(-1)
	case p07RowPartial:
		delete(fields, "id")
	}
	return resourcev2.Value{Kind: "map", Map: fields}
}

var p07RowPaths = [][]resourcecatalog.PathSegment{
	nil,
	{{Kind: resourcecatalog.SegmentField, Name: "spec"}},
	{{Kind: resourcecatalog.SegmentField, Name: "items"}, {Kind: resourcecatalog.SegmentItem}},
}

// p07RunRow admits row i, verifies its outcome against its class and runs field
// discovery on the same schema. It returns an error so goroutines can report.
func p07RunRow(schema *resourcecatalog.Schema, policy resourcecatalog.Policy, i int) error {
	class := p07RowClassOf(i)
	coverage := p07Complete
	if class == p07RowPartial {
		coverage = p07Partial()
	}
	admission, err := resourcecatalog.Admit(context.Background(), schema, p07Row(i), coverage, policy)
	switch class {
	case p07RowValid:
		if err != nil || admission.Validation != resourcecatalog.ValidationFull || len(admission.UnavailablePaths) != 0 {
			return fmt.Errorf("row %d: admission = %+v, %v; want full validation", i, admission, err)
		}
	case p07RowInvalid:
		if resourcev2.ErrorCode(err) != "INVALID_REQUEST" || !strings.Contains(p07ErrorMessage(err), `"/size"`) {
			return fmt.Errorf("row %d: error = %v; want INVALID_REQUEST at /size", i, err)
		}
	case p07RowPartial:
		// The missing required id is unavailable; omission-sensitive checks on
		// other limited values may be listed too, always sorted and unique.
		if err != nil || !slices.Contains(admission.UnavailablePaths, "/id") || !slices.IsSorted(admission.UnavailablePaths) ||
			len(slices.Compact(slices.Clone(admission.UnavailablePaths))) != len(admission.UnavailablePaths) {
			return fmt.Errorf("row %d: admission = %+v, %v; want unavailable paths including /id", i, admission, err)
		}
	}
	navigation, err := resourcecatalog.Navigate(context.Background(), schema, p07RowPaths[i%len(p07RowPaths)], policy)
	if err != nil || len(navigation.Fields) == 0 {
		return fmt.Errorf("row %d: navigation = %+v, %v", i, navigation.Fields, err)
	}
	return nil
}

type p07RetentionFixture struct {
	catalog     *resourcecatalog.Catalog
	connections []string
	rows        []*resourcecatalog.Schema // one resolved row schema per connection
	snapshots   []*resourcecatalog.Snapshot
	entries     []*resourcecatalog.Entry
}

func p07RowCatalog() resourcev2.Catalog {
	return p07Catalog("c1",
		p07Type("row", []string{"scope"}, p07Binding(p07Draft2020, "row/1", p07RowSchema)),
		p07Type("plain", []string{"scope"}, p07Binding(p07Draft2020, "plain/1", p07PlainSchema)))
}

// p07RetainPerRowControl admits and navigates rows while retaining every result,
// the behavior the acceptance bounds exist to forbid. The retained values are
// still alive when the heap is sampled and are released when it returns.
func p07RetainPerRowControl(t *testing.T, schema *resourcecatalog.Schema, policy resourcecatalog.Policy, rows int, before runtime.MemStats) (heapDelta, objectDelta int64) {
	t.Helper()
	navigations := make([]resourcecatalog.Navigation, 0, rows)
	admissions := make([]resourcecatalog.Admission, 0, rows)
	for i := range rows {
		admission, err := resourcecatalog.Admit(context.Background(), schema, p07Row(7*i+4), p07Partial(), policy)
		if err != nil {
			t.Fatal(err)
		}
		navigation, err := resourcecatalog.Navigate(context.Background(), schema, p07RowPaths[i%len(p07RowPaths)], policy)
		if err != nil {
			t.Fatal(err)
		}
		admissions = append(admissions, admission)
		navigations = append(navigations, navigation)
	}
	after := p07Heap()
	runtime.KeepAlive(navigations)
	runtime.KeepAlive(admissions)
	return p07Delta(after.HeapAlloc, before.HeapAlloc), p07Delta(after.HeapObjects, before.HeapObjects)
}

func p07NewRetentionFixture(t *testing.T, policy resourcecatalog.Policy, connections ...string) (*p07RetentionFixture, []weak.Pointer[resourcecatalog.Document]) {
	t.Helper()
	fixture := &p07RetentionFixture{catalog: resourcecatalog.NewCatalog(policy), connections: connections}
	var documents []weak.Pointer[resourcecatalog.Document]
	for _, connection := range connections {
		snapshot := fixture.catalog.Observe(p07Key("neutral", connection), p07RowCatalog())
		for _, name := range []string{"row", "plain"} {
			entry, err := snapshot.Entry(name, "native")
			if err != nil {
				t.Fatal(err)
			}
			schema, err := entry.Resolve(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			// Checking environments build the per-document CEL provider once.
			if _, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema); err != nil {
				t.Fatal(err)
			}
			if name == "row" {
				fixture.rows = append(fixture.rows, schema)
				fixture.snapshots = append(fixture.snapshots, snapshot)
				fixture.entries = append(fixture.entries, entry)
				if connection == connections[0] {
					documents = append(documents, weak.Make(schema.Document))
				}
			} else if connection == connections[0] {
				documents = append(documents, weak.Make(schema.Document))
			}
		}
	}
	return fixture, documents
}

func p07Heap() runtime.MemStats {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats
}

func p07Delta(after, before uint64) int64 { return int64(after) - int64(before) }

const (
	// p07HeapBound is the deterministic live-heap growth allowed after GC.
	p07HeapBound = 1 << 20
	// p07ObjectBound is the live-object growth allowed after GC. A single
	// retained object per row would exceed it within the sequential rows.
	p07ObjectBound = 4096
)

// p07StatsSampler reads catalog statistics until stopped and records the
// extremes, so growth between the before and after samples cannot hide.
type p07StatsSampler struct {
	min, max resourcecatalog.Stats
	samples  int
}

func p07Sample(catalog *resourcecatalog.Catalog, stop <-chan struct{}) *p07StatsSampler {
	sampler := &p07StatsSampler{}
	record := func() {
		stats := catalog.Stats()
		if sampler.samples == 0 {
			sampler.min, sampler.max = stats, stats
		}
		sampler.min.Connections, sampler.max.Connections = min(sampler.min.Connections, stats.Connections), max(sampler.max.Connections, stats.Connections)
		sampler.min.Entries, sampler.max.Entries = min(sampler.min.Entries, stats.Entries), max(sampler.max.Entries, stats.Entries)
		sampler.min.Documents, sampler.max.Documents = min(sampler.min.Documents, stats.Documents), max(sampler.max.Documents, stats.Documents)
		sampler.min.RetainedBytes, sampler.max.RetainedBytes = min(sampler.min.RetainedBytes, stats.RetainedBytes), max(sampler.max.RetainedBytes, stats.RetainedBytes)
		sampler.min.BranchViews, sampler.max.BranchViews = min(sampler.min.BranchViews, stats.BranchViews), max(sampler.max.BranchViews, stats.BranchViews)
		sampler.min.CELProviders, sampler.max.CELProviders = min(sampler.min.CELProviders, stats.CELProviders), max(sampler.max.CELProviders, stats.CELProviders)
		sampler.samples++
	}
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			record()
			return sampler
		case <-ticker.C:
			record()
		}
	}
}

func TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas(t *testing.T) {
	const sequentialRows, workers, rowsPerWorker, controlRows = 10_000, 24, 700, 5_000
	policy := resourcecatalog.DefaultPolicy()
	connections := []string{"a", "b", "c"}
	baseline := p07Heap()
	fixture, documents := p07NewRetentionFixture(t, policy, connections...)

	// Warm the document-lifetime caches (branch views, CEL providers) once.
	for i := range 300 {
		if err := p07RunRow(fixture.rows[i%len(connections)], policy, i); err != nil {
			t.Fatal(err)
		}
	}
	warm := fixture.catalog.Stats()
	if warm.Connections != 3 || warm.Entries != 6 || warm.Documents != 2 || warm.CELProviders != 2 || warm.BranchViews == 0 || warm.BranchViews > p07RowUnionNodes {
		t.Fatalf("warm stats = %+v, want 3 connections, 6 entries, 2 shared documents, 2 CEL providers and 1..%d branch views", warm, p07RowUnionNodes)
	}
	heapWarm := p07Heap()

	// Sequential distinct rows.
	for i := range sequentialRows {
		if err := p07RunRow(fixture.rows[i%len(connections)], policy, 1000+i); err != nil {
			t.Fatal(err)
		}
	}
	heapSequential := p07Heap()
	if stats := fixture.catalog.Stats(); stats != warm {
		t.Fatalf("stats after %d sequential rows = %+v, want %+v", sequentialRows, stats, warm)
	}
	sequentialDelta, sequentialObjects := p07Delta(heapSequential.HeapAlloc, heapWarm.HeapAlloc), p07Delta(heapSequential.HeapObjects, heapWarm.HeapObjects)
	t.Logf("sequential: %d distinct rows; HeapAlloc delta %d B, HeapObjects delta %d, HeapInuse delta %d B", sequentialRows, sequentialDelta,
		sequentialObjects, p07Delta(heapSequential.HeapInuse, heapWarm.HeapInuse))
	if sequentialDelta >= p07HeapBound || sequentialObjects >= p07ObjectBound {
		t.Fatalf("live heap grew by %d B / %d objects over %d sequential rows", sequentialDelta, sequentialObjects, sequentialRows)
	}

	// Concurrent distinct rows; a sampler watches the statistics throughout.
	stop := make(chan struct{})
	sampled := make(chan *p07StatsSampler, 1)
	go func() { sampled <- p07Sample(fixture.catalog, stop) }()
	var admitted atomic.Int64
	failures := make(chan error, workers)
	var wg sync.WaitGroup
	for worker := range workers {
		wg.Go(func() {
			for j := range rowsPerWorker {
				row := 100_000 + worker*rowsPerWorker + j
				connection := (worker + j) % len(connections)
				if err := p07RunRow(fixture.rows[connection], policy, row); err != nil {
					failures <- err
					return
				}
				admitted.Add(1)
				if j%100 == 0 {
					// Observation of an unchanged revision is a lookup, never a rebuild.
					if again := fixture.catalog.Observe(p07Key("neutral", connections[connection]), p07RowCatalog()); again != fixture.snapshots[connection] {
						failures <- fmt.Errorf("worker %d: unchanged key replaced the snapshot", worker)
						return
					}
					if _, err := celtypes.NewEnvironment(fixture.snapshots[connection].Revision(), fixture.entries[connection], fixture.rows[connection]); err != nil {
						failures <- err
						return
					}
				}
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	close(stop)
	sampler := <-sampled
	heapConcurrent := p07Heap()

	t.Logf("concurrent: %d workers x %d distinct rows (%d admitted); %d statistics samples", workers, rowsPerWorker, admitted.Load(), sampler.samples)
	t.Logf("sampled extremes: min %+v max %+v", sampler.min, sampler.max)
	if sampler.min != sampler.max || sampler.max.Connections != 3 || sampler.max.Entries != 6 || sampler.max.Documents != 2 || sampler.max.BranchViews > p07RowUnionNodes || sampler.max.CELProviders != 2 {
		t.Fatalf("statistics moved during concurrent admissions: min %+v max %+v", sampler.min, sampler.max)
	}
	if stats := fixture.catalog.Stats(); stats != warm {
		t.Fatalf("stats after concurrent rows = %+v, want %+v", stats, warm)
	}
	concurrentDelta, concurrentObjects := p07Delta(heapConcurrent.HeapAlloc, heapWarm.HeapAlloc), p07Delta(heapConcurrent.HeapObjects, heapWarm.HeapObjects)
	t.Logf("concurrent: HeapAlloc delta %d B, HeapObjects delta %d, HeapInuse delta %d B, HeapSys delta %d B", concurrentDelta, concurrentObjects,
		p07Delta(heapConcurrent.HeapInuse, heapWarm.HeapInuse), p07Delta(heapConcurrent.HeapSys, heapWarm.HeapSys))
	if concurrentDelta >= p07HeapBound || concurrentObjects >= p07ObjectBound {
		t.Fatalf("live heap grew by %d B / %d objects over %d concurrent rows", concurrentDelta, concurrentObjects, workers*rowsPerWorker)
	}
	if want := int64(workers * rowsPerWorker); admitted.Load() != want {
		t.Fatalf("admitted %d rows, want %d", admitted.Load(), want)
	}

	// Control: the same work, retaining per-row results, must breach the bounds.
	// This proves the measurement observes retention and is not vacuously small.
	controlDelta, controlObjects := p07RetainPerRowControl(t, fixture.rows[0], policy, controlRows, heapConcurrent)
	t.Logf("control: retaining %d rows' results grows HeapAlloc by %d B and HeapObjects by %d", controlRows, controlDelta, controlObjects)
	if controlDelta < p07HeapBound || controlObjects < p07ObjectBound {
		t.Fatalf("control retained %d rows but heap grew only %d B / %d objects: the bounds cannot detect per-row retention", controlRows, controlDelta, controlObjects)
	}

	// Cleanup: dropping every connection releases every document, branch view and
	// CEL provider, and returns the live heap to its starting level.
	fixture.rows, fixture.entries, fixture.snapshots = nil, nil, nil
	for _, connection := range connections {
		fixture.catalog.DropConnection("neutral", connection)
	}
	if stats := fixture.catalog.Stats(); stats != (resourcecatalog.Stats{}) {
		t.Fatalf("stats after dropping every connection = %+v", stats)
	}
	for attempt := 0; ; attempt++ {
		released := true
		for _, document := range documents {
			released = released && document.Value() == nil
		}
		if released {
			break
		}
		if attempt == 10 {
			t.Fatal("a dropped document is still reachable after 10 GC cycles")
		}
		runtime.GC()
	}
	heapEnd := p07Heap()
	endDelta, endObjects := p07Delta(heapEnd.HeapAlloc, baseline.HeapAlloc), p07Delta(heapEnd.HeapObjects, baseline.HeapObjects)
	t.Logf("after cleanup: HeapAlloc delta vs start %d B, HeapObjects delta %d", endDelta, endObjects)
	if endDelta >= p07HeapBound || endObjects >= p07ObjectBound {
		t.Fatalf("heap did not return to its starting level after cleanup: %d B / %d objects", endDelta, endObjects)
	}
}
