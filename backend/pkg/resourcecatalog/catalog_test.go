package resourcecatalog

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const podSchema = `{"type":"object","properties":{"spec":{"type":"object","properties":{"image":{"type":"string"}}}}}`

func inlineBinding(dialect, document, root string) resourcev2.SchemaBinding {
	return resourcev2.SchemaBinding{State: "available", Revision: new("schema/1"), Dialect: dialect, Root: root, Document: json.RawMessage(document)}
}

func refBinding(dialect, id, root string) resourcev2.SchemaBinding {
	return resourcev2.SchemaBinding{State: "available", Revision: new("schema/1"), Dialect: dialect, Root: root,
		DocumentRef: &resourcev2.SchemaDocumentReference{ID: id, Revision: "rev/1"}}
}

func catalogOf(revision string, types ...resourcev2.ResourceType) resourcev2.Catalog {
	return resourcev2.Catalog{Provider: "test", Revision: revision, Types: types}
}

func typeOf(name string, bindings ...resourcev2.SchemaBinding) resourcev2.ResourceType {
	t := resourcev2.ResourceType{Type: name, DisplayName: name}
	for i, b := range bindings {
		id := "r" + string(rune('0'+i))
		t.Representations = append(t.Representations, resourcev2.Representation{ID: id, Revision: "rep/1", Schema: b})
	}
	if len(bindings) > 0 {
		t.DefaultRepresentation = "r0"
	}
	return t
}

func key(connection string) ConnectionKey {
	return ConnectionKey{PluginID: "plugin", Generation: "g1", Connection: connection, Epoch: 1}
}

func entry(t *testing.T, s *Snapshot, typ, representation string) *Entry {
	t.Helper()
	e, err := s.Entry(typ, representation)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func resolve(t *testing.T, e *Entry, fetch DocumentSource) *Schema {
	t.Helper()
	schema, err := e.Resolve(context.Background(), fetch)
	if err != nil {
		t.Fatalf("resolve %s/%s: %v", e.Type, e.Representation, err)
	}
	return schema
}

type documentServer struct {
	mu        sync.Mutex
	documents map[string]resourcev2.SchemaDocument
	calls     atomic.Int32
	gate      chan struct{} // when set, fetches block until it is closed
	err       error
}

func newDocumentServer(dialect string, documents map[string]string) *documentServer {
	s := &documentServer{documents: map[string]resourcev2.SchemaDocument{}}
	for id, raw := range documents {
		s.documents[id] = resourcev2.SchemaDocument{
			Reference: resourcev2.SchemaDocumentReference{ID: id, Revision: "rev/1"},
			Dialect:   dialect,
			Document:  json.RawMessage(raw),
		}
	}
	return s
}

func (s *documentServer) fetch(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
	s.calls.Add(1)
	if s.gate != nil {
		select {
		case <-s.gate:
		case <-ctx.Done():
			return resourcev2.SchemaDocument{}, ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return resourcev2.SchemaDocument{}, s.err
	}
	d, ok := s.documents[ref.ID]
	if !ok {
		return resourcev2.SchemaDocument{}, resourcev2.NewError("NOT_FOUND", "no such document")
	}
	return d, nil
}

func TestResolveStaticDiscoveredAndAbsent(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(dOAS30, map[string]string{"core": `{"components":{"schemas":{"Pod":` + podSchema + `}}}`})
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("static", inlineBinding(d2020, podSchema, "")),
		typeOf("discovered", refBinding(dOAS30, "core", "#/components/schemas/Pod")),
		typeOf("absent", resourcev2.SchemaBinding{State: "absent"}),
	))
	static := resolve(t, entry(t, s, "static", "r0"), nil)
	if static.Validation != ValidationFull || static.Unvalidated != nil || static.SchemaRevision != "schema/1" || static.Dialect != d2020 {
		t.Fatalf("static = %+v", static)
	}
	if static.Document.Nodes[static.Root].Pointer != "" {
		t.Fatal("empty root must select the document root")
	}
	discovered := resolve(t, entry(t, s, "discovered", "r0"), server.fetch)
	if discovered.Document.Nodes[discovered.Root].Pointer != "/components/schemas/Pod" {
		t.Fatalf("discovered root = %q", discovered.Document.Nodes[discovered.Root].Pointer)
	}
	absent, err := entry(t, s, "absent", "r0").Resolve(context.Background(), server.fetch)
	if absent != nil || err != nil {
		t.Fatalf("absent = %v, %v", absent, err)
	}
	if st := c.Stats(); st.Connections != 1 || st.Entries != 3 || st.Documents != 2 || st.RetainedBytes <= 0 {
		t.Fatalf("stats = %+v", st)
	}
	_, err = s.Entry("static", "missing")
	requireCode(t, err, codeNotFound, "not in the route catalog")
}

func TestResolveUnavailableBinding(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("forbidden", resourcev2.SchemaBinding{State: "unavailable", UnavailableReason: new("FORBIDDEN")}),
		typeOf("plain", resourcev2.SchemaBinding{State: "unavailable"}),
	))
	_, err := entry(t, s, "forbidden", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, "FORBIDDEN", "Schema is unavailable for this representation.")
	_, err = entry(t, s, "plain", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeUnavailable, "")
}

func TestResolveRootAndDialectFailures(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("badroot", inlineBinding(d2020, podSchema, "#/properties/missing")),
		typeOf("oasroot", inlineBinding(dOAS30, `{"components":{"schemas":{"A":{}}}}`, "")),
		typeOf("dialect", inlineBinding("https://json-schema.org/draft/2019-09/schema", podSchema, "")),
		typeOf("mismatch", inlineBinding(dDraft7, `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`, "")),
		typeOf("encoded", inlineBinding(d2020, `{"properties":{"a b":{"type":"string"}}}`, "#/properties/a%20b")),
	))
	_, err := entry(t, s, "badroot", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeInvalidRequest, "schema root does not resolve")
	_, err = entry(t, s, "oasroot", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeInvalidRequest, "schema root does not resolve")
	_, err = entry(t, s, "dialect", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeUnsupported, "unsupported schema dialect")
	_, err = entry(t, s, "mismatch", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeInvalidRequest, "schema document dialect does not match binding")
	encoded := resolve(t, entry(t, s, "encoded", "r0"), nil)
	if encoded.Document.Nodes[encoded.Root].Types != TypeString {
		t.Fatal("percent-encoded root did not resolve")
	}
	if st := c.Stats(); st.Documents != 1 {
		t.Fatalf("failed resolves leaked documents: %+v", st)
	}
}

func TestResolveValidationReducedOnlyForReachableConstraints(t *testing.T) {
	doc := `{"components":{"schemas":{
		"VM": {"type":"object","properties":{"spec":{"$ref":"#/components/schemas/Spec"},"ext":{"$ref":"https://example.com/x.json"}}},
		"Spec": {"type":"object","x-kubernetes-validations":[{"rule":"true"}]},
		"Other": {"not": {}}
	}}}`
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("vm", inlineBinding(dOAS30, doc, "#/components/schemas/VM")),
		typeOf("other", inlineBinding(dOAS30, doc, "#/components/schemas/Spec")),
	))
	vm := resolve(t, entry(t, s, "vm", "r0"), nil)
	want := []Constraint{
		{Pointer: "/components/schemas/Spec", Keyword: "x-kubernetes-validations"},
		{Pointer: "/components/schemas/VM/properties/ext", Keyword: "$ref"},
	}
	if vm.Validation != ValidationReduced || len(vm.Unvalidated) != 2 || vm.Unvalidated[0] != want[0] || vm.Unvalidated[1] != want[1] {
		t.Fatalf("vm = %s %v", vm.Validation, vm.Unvalidated)
	}
	spec := resolve(t, entry(t, s, "other", "r0"), nil)
	if len(spec.Unvalidated) != 1 || spec.Document != vm.Document {
		t.Fatalf("spec = %v (shared document %v)", spec.Unvalidated, spec.Document == vm.Document)
	}
}

func TestResolveBooleanFalseSchemaIsReduced(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("f", inlineBinding(d2020, `{"properties":{"never":false}}`, ""))))
	schema := resolve(t, entry(t, s, "f", "r0"), nil)
	if schema.Validation != ValidationReduced || len(schema.Unvalidated) != 1 || schema.Unvalidated[0] != (Constraint{Pointer: "/properties/never", Keyword: "false"}) {
		t.Fatalf("false schema = %s %v", schema.Validation, schema.Unvalidated)
	}
}

func TestIsolationAcrossConnections(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	other := `{"type":"object","properties":{"different":{"type":"integer"}}}`
	a := c.Observe(key("a"), catalogOf("c1", typeOf("pod", inlineBinding(d2020, podSchema, ""))))
	b := c.Observe(key("b"), catalogOf("c1", typeOf("pod", inlineBinding(d2020, other, ""))))
	sa, sb := resolve(t, entry(t, a, "pod", "r0"), nil), resolve(t, entry(t, b, "pod", "r0"), nil)
	if sa.Document == sb.Document || sa.Document.Nodes[sa.Root].Properties[0].Name == sb.Document.Nodes[sb.Root].Properties[0].Name {
		t.Fatal("different documents under the same type name must not be shared")
	}
	if _, ok := a.Document(hex.EncodeToString(sb.Document.Digest[:])); ok {
		t.Fatal("snapshot exposed another connection's document")
	}
	if d, ok := a.Document(hex.EncodeToString(sa.Document.Digest[:])); !ok || d != sa.Document {
		t.Fatal("snapshot must expose its own resolved document")
	}

	same := NewCatalog(DefaultPolicy())
	x := same.Observe(key("x"), catalogOf("c1", typeOf("pod", inlineBinding(d2020, podSchema, ""))))
	y := same.Observe(key("y"), catalogOf("c9", typeOf("pod", inlineBinding(d2020, podSchema, ""))))
	sx, sy := resolve(t, entry(t, x, "pod", "r0"), nil), resolve(t, entry(t, y, "pod", "r0"), nil)
	if sx.Document != sy.Document || same.Stats().Documents != 1 {
		t.Fatalf("byte-identical documents must share one Document: %+v", same.Stats())
	}
	if entry(t, x, "pod", "r0") == entry(t, y, "pod", "r0") {
		t.Fatal("entries must be per connection")
	}
	same.DropConnection("plugin", "x")
	if st := same.Stats(); st.Documents != 1 || st.Connections != 1 {
		t.Fatalf("after one drop: %+v", st)
	}
	_, err := entry(t, x, "pod", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeResetRequired, "")
	same.DropConnection("plugin", "y")
	if st := same.Stats(); st != (Stats{}) {
		t.Fatalf("after dropping both: %+v", st)
	}
}

func TestObserveSnapshotIdentityAndRevisionReplacement(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	cat := catalogOf("c1", typeOf("pod", inlineBinding(d2020, podSchema, "")))
	first := c.Observe(key("a"), cat)
	if c.Observe(key("a"), cat) != first {
		t.Fatal("unchanged key and revision must return the stored snapshot")
	}
	resolve(t, entry(t, first, "pod", "r0"), nil)

	replacedKeys := []ConnectionKey{
		{PluginID: "plugin", Generation: "g2", Connection: "a", Epoch: 1},
		{PluginID: "plugin", Generation: "g2", Connection: "a", Epoch: 2},
	}
	prev := first
	for _, k := range replacedKeys {
		next := c.Observe(k, cat)
		if next == prev {
			t.Fatalf("key %+v must replace the snapshot", k)
		}
		prev = next
	}
	updated := catalogOf("c2", typeOf("pod", inlineBinding(d2020, `{"type":"object","properties":{"v2":{}}}`, "")), typeOf("svc"))
	next := c.Observe(replacedKeys[1], updated)
	if next == prev || next.Revision() != "c2" || next.Provider() != "test" {
		t.Fatal("revision change must replace the snapshot")
	}
	e := entry(t, next, "pod", "r0")
	if e == entry(t, first, "pod", "r0") || string(e.Binding.Document) == podSchema {
		t.Fatal("revision change must replace the entries")
	}
	if st := c.Stats(); st.Connections != 1 || st.Entries != 1 || st.Documents != 0 {
		t.Fatalf("replacement must release old documents: %+v", st)
	}
	_, err := entry(t, first, "pod", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeResetRequired, "Schema catalog changed during resolution.")
}

func TestResolveRetiredDuringResolutionDoesNotLeak(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	server.gate = make(chan struct{})
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", refBinding(d2020, "doc", ""))))
	e := entry(t, s, "pod", "r0")
	result := make(chan error, 1)
	go func() {
		_, err := e.Resolve(context.Background(), server.fetch)
		result <- err
	}()
	for server.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	c.Observe(key("a"), catalogOf("c2", typeOf("pod", refBinding(d2020, "doc", ""))))
	close(server.gate)
	requireCode(t, <-result, codeResetRequired, "Schema catalog changed during resolution.")
	if st := c.Stats(); st.Documents != 0 || st.RetainedBytes != 0 {
		t.Fatalf("retired resolve leaked a document: %+v", st)
	}
}

func TestResolveFetchVerificationAndCaching(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	wrongRef := func(context.Context, resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return resourcev2.SchemaDocument{Reference: resourcev2.SchemaDocumentReference{ID: "other", Revision: "rev/1"}, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
	}
	wrongDialect := func(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return resourcev2.SchemaDocument{Reference: ref, Dialect: dDraft7, Document: json.RawMessage(podSchema)}, nil
	}
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("pod", refBinding(d2020, "doc", "")),
		typeOf("ref", refBinding(d2020, "doc", "")),
		typeOf("dialect", refBinding(d2020, "doc", "")),
		typeOf("nofetch", refBinding(d2020, "doc", "")),
	))
	_, err := entry(t, s, "ref", "r0").Resolve(context.Background(), wrongRef)
	requireCode(t, err, codeInvalidRequest, "reference does not match")
	_, err = entry(t, s, "dialect", "r0").Resolve(context.Background(), wrongDialect)
	requireCode(t, err, codeInvalidRequest, "dialect does not match")
	_, err = entry(t, s, "nofetch", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeUnsupported, "provider does not serve schema documents")
	// Deterministic outcomes are cached: a working fetch does not change them.
	_, err = entry(t, s, "ref", "r0").Resolve(context.Background(), server.fetch)
	requireCode(t, err, codeInvalidRequest, "")
	_, err = entry(t, s, "nofetch", "r0").Resolve(context.Background(), server.fetch)
	requireCode(t, err, codeUnsupported, "")
	if server.calls.Load() != 0 {
		t.Fatal("cached outcomes must not fetch")
	}

	// Transient fetch errors are returned unwrapped and never cached.
	transient := resourcev2.NewError("FORBIDDEN", "denied")
	server.err = transient
	pod := entry(t, s, "pod", "r0")
	if _, err = pod.Resolve(context.Background(), server.fetch); !errors.Is(err, transient) {
		t.Fatalf("fetch error = %v, want unwrapped %v", err, transient)
	}
	server.err = resourcev2.NewError("RESOURCE_LIMIT", "provider refuses")
	_, err = pod.Resolve(context.Background(), server.fetch)
	requireCode(t, err, codeResourceLimit, "provider refuses")
	server.err = nil
	_, err = pod.Resolve(context.Background(), server.fetch)
	requireCode(t, err, codeResourceLimit, "provider refuses") // deterministic fetch refusal is cached
	if server.calls.Load() != 2 {
		t.Fatalf("fetch calls = %d, want 2", server.calls.Load())
	}
}

func TestResolveSingleFlight(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	server.gate = make(chan struct{})
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("a", refBinding(d2020, "doc", "")),
		typeOf("b", refBinding(d2020, "doc", "#/properties/spec")),
	))
	var wg sync.WaitGroup
	schemas := make([]*Schema, 16)
	errs := make([]error, 16)
	for i := range 16 {
		e := entry(t, s, []string{"a", "b"}[i%2], "r0")
		wg.Add(1)
		go func() {
			defer wg.Done()
			schemas[i], errs[i] = e.Resolve(context.Background(), server.fetch)
		}()
	}
	for server.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(server.gate)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("resolve %d: %v", i, err)
		}
		if schemas[i] != schemas[i%2] {
			t.Fatal("one entry must resolve to one cached schema")
		}
	}
	if server.calls.Load() != 1 {
		t.Fatalf("fetch calls = %d, want 1 shared fetch", server.calls.Load())
	}
	if st := c.Stats(); st.Documents != 1 {
		t.Fatalf("stats = %+v", st)
	}
}

func waitForFetchWaiters(t *testing.T, s *Snapshot, ref resourcev2.SchemaDocumentReference, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.fetchMu.Lock()
		flight := s.fetches[ref]
		ready := flight != nil && flight.waiters == count
		s.fetchMu.Unlock()
		if ready {
			return
		}
		runtime.Gosched()
	}
	t.Fatalf("fetch never reached %d waiters", count)
}

func TestSharedFetchSurvivesCallerCancellation(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("a", refBinding(d2020, "doc", "")),
		typeOf("b", refBinding(d2020, "doc", "")),
	))
	ref := *entry(t, s, "a", "r0").Binding.DocumentRef
	started := make(chan struct{})
	release := make(chan struct{})
	cancelled := make(chan struct{})
	var startOnce, releaseOnce, cancelOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	fetch := func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		calls.Add(1)
		startOnce.Do(func() { close(started) })
		select {
		case <-ctx.Done():
			cancelOnce.Do(func() { close(cancelled) })
			return resourcev2.SchemaDocument{}, ctx.Err()
		case <-release:
			return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := make(chan error, 1)
	second := make(chan error, 1)
	a, b := entry(t, s, "a", "r0"), entry(t, s, "b", "r0")
	go func() { _, err := a.Resolve(ctx, fetch); first <- err }()
	<-started
	go func() { _, err := b.Resolve(context.Background(), fetch); second <- err }()
	waitForFetchWaiters(t, s, ref, 2)
	cancel()
	requireCode(t, <-first, codeCancelled, "")
	select {
	case <-cancelled:
		t.Fatal("shared fetch cancelled while another caller was waiting")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := <-second; err != nil {
		t.Fatalf("surviving resolve: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls.Load())
	}
}

func TestSharedFetchCancelsAfterLastWaiter(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("a", refBinding(d2020, "doc", ""))))
	e := entry(t, s, "a", "r0")
	started := make(chan struct{})
	cancelled := make(chan struct{})
	var calls atomic.Int32
	fetch := func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			close(cancelled)
			return resourcev2.SchemaDocument{}, ctx.Err()
		}
		return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := e.Resolve(ctx, fetch); result <- err }()
	<-started
	cancel()
	requireCode(t, <-result, codeCancelled, "")
	<-cancelled
	if _, err := e.Resolve(context.Background(), fetch); err != nil {
		t.Fatalf("retry after cancellation: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("fetch calls = %d, want 2", calls.Load())
	}
}

func TestSharedFetchChecksDialectPerBinding(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("matching", refBinding(d2020, "doc", "")),
		typeOf("mismatch", refBinding(dDraft7, "doc", "")),
	))
	matching, mismatch := entry(t, s, "matching", "r0"), entry(t, s, "mismatch", "r0")
	ref := *matching.Binding.DocumentRef
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce, releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	fetch := func(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		calls.Add(1)
		startOnce.Do(func() { close(started) })
		<-release
		return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
	}
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := matching.Resolve(context.Background(), fetch); first <- err }()
	<-started
	go func() { _, err := mismatch.Resolve(context.Background(), fetch); second <- err }()
	waitForFetchWaiters(t, s, ref, 2)
	releaseOnce.Do(func() { close(release) })
	if err := <-first; err != nil {
		t.Fatalf("matching dialect: %v", err)
	}
	requireCode(t, <-second, codeInvalidRequest, "dialect does not match")
	if calls.Load() != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls.Load())
	}
}

func TestResolveHonoursCancellationWhileWaiting(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	server.gate = make(chan struct{})
	defer close(server.gate)
	s := c.Observe(key("a"), catalogOf("c1", typeOf("a", refBinding(d2020, "doc", ""))))
	e := entry(t, s, "a", "r0")
	go func() { _, _ = e.Resolve(context.Background(), server.fetch) }()
	for server.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := e.Resolve(ctx, server.fetch)
	requireCode(t, err, codeCancelled, "")
	ctx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err = e.Resolve(ctx, server.fetch)
	requireCode(t, err, codeTimeout, "")
}

func TestRetentionLimits(t *testing.T) {
	documents := []string{podSchema, `{"type":"string"}`, `{"type":"integer"}`}
	types := make([]resourcev2.ResourceType, len(documents))
	for i, d := range documents {
		types[i] = typeOf(string(rune('a'+i)), inlineBinding(d2020, d, ""))
	}
	policy := DefaultPolicy()
	policy.MaxRetainedDocuments = 2
	c := NewCatalog(policy)
	s := c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), nil)
	resolve(t, entry(t, s, "b", "r0"), nil)
	_, err := entry(t, s, "c", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeResourceLimit, "MaxRetainedDocuments")

	measure := NewCatalog(DefaultPolicy())
	ms := measure.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, ms, "a", "r0"), nil)
	resolve(t, entry(t, ms, "b", "r0"), nil)
	exact := measure.Stats().RetainedBytes

	policy = DefaultPolicy()
	policy.MaxRetainedBytes = exact
	c = NewCatalog(policy)
	s = c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), nil)
	resolve(t, entry(t, s, "b", "r0"), nil)
	if c.Stats().RetainedBytes != exact {
		t.Fatal("retained bytes differ between identical catalogs")
	}
	policy.MaxRetainedBytes = exact - 1
	c = NewCatalog(policy)
	s = c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), nil)
	_, err = entry(t, s, "b", "r0").Resolve(context.Background(), nil)
	requireCode(t, err, codeResourceLimit, "MaxRetainedBytes")
}

func TestResolveAux(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1"))
	server := newDocumentServer(dDraft7, map[string]string{"values": `{"type":"object","properties":{"replicas":{"type":"integer"}}}`})
	aux := []resourcev2.EditorSchema{
		{Type: "helm:releases", Key: "ns/one", Language: "yaml", Binding: inlineBinding(dDraft7, `{"type":"object"}`, "")},
		{Type: "helm:releases", Key: "ns/two", Language: "yaml", Binding: refBinding(dDraft7, "values", "")},
		{Type: "helm:releases", Key: "ns/three", Language: "yaml", Binding: resourcev2.SchemaBinding{State: "absent"}},
		{Type: "helm:releases", Key: "ns/four", Language: "yaml", Binding: inlineBinding("http://json-schema.org/schema#", `{}`, "")},
		{Type: "helm:releases", Key: "ns/five", Language: "yaml", Binding: resourcev2.SchemaBinding{State: "unavailable"}},
	}
	results, err := s.ResolveAux(context.Background(), aux, server.fetch)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Resolved == nil || results[1].Resolved == nil || results[2].Resolved != nil || results[2].Err != nil {
		t.Fatalf("results = %+v", results)
	}
	requireCode(t, results[3].Err, codeUnsupported, "unsupported schema dialect")
	requireCode(t, results[4].Err, codeUnavailable, "")
	if results[1].Schema.Key != "ns/two" {
		t.Fatal("result must carry its editor schema")
	}
	first := hex.EncodeToString(results[0].Resolved.Document.Digest[:])
	if _, ok := s.Document(first); !ok {
		t.Fatal("aux document must be referenced by the snapshot")
	}
	if st := c.Stats(); st.Documents != 2 {
		t.Fatalf("stats = %+v", st)
	}

	results, err = s.ResolveAux(context.Background(), aux[1:2], server.fetch)
	if err != nil || results[0].Resolved == nil {
		t.Fatalf("second ResolveAux = %+v, %v", results, err)
	}
	if _, ok := s.Document(first); ok {
		t.Fatal("replaced aux document must no longer be referenced")
	}
	if st := c.Stats(); st.Documents != 1 {
		t.Fatalf("previous aux documents were not released: %+v", st)
	}
	c.DropPlugin("plugin")
	if st := c.Stats(); st != (Stats{}) {
		t.Fatalf("after DropPlugin: %+v", st)
	}
	_, err = s.ResolveAux(context.Background(), aux, server.fetch)
	requireCode(t, err, codeResetRequired, "")
}

func TestResolveAuxLifecycleFailurePreservesPublishedDocuments(t *testing.T) {
	for _, code := range []string{codeCancelled, codeTimeout, codeResetRequired} {
		t.Run(code, func(t *testing.T) {
			c := NewCatalog(DefaultPolicy())
			s := c.Observe(key("a"), catalogOf("c1"))
			original := []resourcev2.EditorSchema{
				{Type: "helm:releases", Key: "original", Language: "yaml", Binding: inlineBinding(d2020, `{"type":"string"}`, "")},
			}
			results, err := s.ResolveAux(context.Background(), original, nil)
			if err != nil {
				t.Fatal(err)
			}
			id := hex.EncodeToString(results[0].Resolved.Document.Digest[:])
			before := c.Stats()
			replacement := []resourcev2.EditorSchema{
				{Type: "helm:releases", Key: "new", Language: "yaml", Binding: inlineBinding(d2020, `{"type":"integer"}`, "")},
				{Type: "helm:releases", Key: "failure", Language: "yaml", Binding: refBinding(d2020, "failure", "")},
			}
			fetchErr := resourcev2.NewError(code, "provider lifecycle failure")
			fetch := func(context.Context, resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
				return resourcev2.SchemaDocument{}, fetchErr
			}
			results, err = s.ResolveAux(context.Background(), replacement, fetch)
			if results != nil || !errors.Is(err, fetchErr) {
				t.Fatalf("ResolveAux = %v, %v; want nil, provider error", results, err)
			}
			if _, ok := s.Document(id); !ok {
				t.Fatal("previously published document was discarded")
			}
			if got := c.Stats(); got != before {
				t.Fatalf("stats after failure = %+v, want %+v", got, before)
			}
		})
	}
}

func TestActionInputSchemasAreNotEntries(t *testing.T) {
	inputSchema := resourcev2.Schema{}
	typ := typeOf("vm", inlineBinding(d2020, podSchema, ""), resourcev2.SchemaBinding{State: "absent"})
	typ.NativeQueries = []resourcev2.NativeQueryDescriptor{{Language: "sql", InputSchema: inputSchema}}
	typ.Capabilities = []resourcev2.Capability{{Operation: resourcev2.OperationAction}, {Operation: resourcev2.OperationNativeQuery}}
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typ))
	entries := s.Entries()
	if len(entries) != 2 || entries[0].Representation != "r0" || entries[1].Representation != "r1" {
		t.Fatalf("entries = %d", len(entries))
	}
	if len(entries[0].Descriptor.NativeQueries) != 1 || len(entries[0].Descriptor.Capabilities) != 2 {
		t.Fatal("descriptor must be copied onto the entry")
	}
	typ.Capabilities[0].Operation = resourcev2.OperationDelete
	if entries[0].Descriptor.Capabilities[0].Operation != resourcev2.OperationAction {
		t.Fatal("entry descriptor must not alias the observed catalog")
	}
}

