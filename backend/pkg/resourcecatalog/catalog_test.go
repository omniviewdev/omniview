package resourcecatalog

import (
	"context"
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

func typeOf(name string, representations ...string) resourcev2.ResourceType {
	typ := resourcev2.ResourceType{Type: name, DisplayName: name}
	for _, id := range representations {
		typ.Representations = append(typ.Representations, resourcev2.Representation{ID: id, Revision: "rep/1"})
	}
	if len(representations) > 0 {
		typ.DefaultRepresentation = representations[0]
	}
	return typ
}

// bindingMap belongs to one fixture. Catalog support never carries its schemas.
type bindingMap map[string]map[string]resourcev2.SchemaBinding

func (bindings bindingMap) resolve(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
	if err := resourcev2.ValidateSchemaRequest(request); err != nil {
		return resourcev2.SchemaBinding{}, err
	}
	if request.Target.Representation == nil {
		return resourcev2.SchemaBinding{}, resourcev2.NewError(codeInvalidRequest, "fixture requires an explicit representation target")
	}
	binding, ok := bindings[request.Type][request.Target.Representation.ID]
	if !ok {
		return resourcev2.SchemaBinding{}, resourcev2.NewError(codeNotFound, "fixture has no binding for this target")
	}
	return binding, nil
}

func bindingFor(typ string, binding resourcev2.SchemaBinding) BindingSource {
	return bindingMap{typ: {"r0": binding}}.resolve
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

func resolve(t *testing.T, e *Entry, source BindingSource, fetch DocumentSource) *Schema {
	t.Helper()
	result, err := e.Resolve(context.Background(), source, fetch)
	if err != nil {
		t.Fatalf("resolve %s/%s: %v", e.Type, e.Representation, err)
	}
	return result.Schema
}

func await[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case result := <-ch:
		return result
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for controlled schema work")
		var zero T
		return zero
	}
}

func waitForResolutionWaiters(t *testing.T, e *Entry, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c := e.snapshot.catalog
		c.mu.Lock()
		ready := e.flight != nil && e.flight.waiters == count
		c.mu.Unlock()
		if ready {
			return
		}
		runtime.Gosched()
	}
	t.Fatalf("target resolution never reached %d waiters", count)
}

func resolutionDone(t *testing.T, e *Entry) <-chan struct{} {
	t.Helper()
	c := e.snapshot.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if e.flight == nil {
		t.Fatal("target has no pending resolution")
	}
	return e.flight.done
}

func expireResolution(t *testing.T, e *Entry) {
	t.Helper()
	c := e.snapshot.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if e.outcome == nil {
		t.Fatal("target has no cached outcome to expire")
	}
	e.outcome.observed = time.Now().Add(-Freshness - time.Second)
}

type documentServer struct {
	mu        sync.Mutex
	documents map[string]resourcev2.SchemaDocument
	calls     atomic.Int32
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

func (s *documentServer) fetch(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
	s.calls.Add(1)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return resourcev2.SchemaDocument{}, s.err
	}
	d, ok := s.documents[ref.ID]
	if !ok {
		return resourcev2.SchemaDocument{}, resourcev2.NewError(codeNotFound, "no such document")
	}
	return d, nil
}

func TestResolveStaticDiscoveredAndAbsent(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(dOAS30, map[string]string{"core": `{"components":{"schemas":{"Pod":` + podSchema + `}}}`})
	bindings := bindingMap{
		"static":     {"r0": inlineBinding(d2020, podSchema, "")},
		"discovered": {"r0": refBinding(dOAS30, "core", "#/components/schemas/Pod")},
		"absent":     {"r0": {State: "absent"}},
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("static", "r0"), typeOf("discovered", "r0"), typeOf("absent", "r0")))
	if server.calls.Load() != 0 || c.Stats().Documents != 0 {
		t.Fatal("observing support must not acquire schemas")
	}
	static := resolve(t, entry(t, s, "static", "r0"), bindings.resolve, nil)
	if static.Validation != ValidationFull || static.Unvalidated != nil || static.SchemaRevision != "schema/1" || static.Dialect != d2020 {
		t.Fatalf("static = %+v", static)
	}
	if static.Document.Nodes[static.Root].Pointer != "" || string(static.Document.RawJSON()) != podSchema {
		t.Fatal("empty root must select the held original document")
	}
	discovered := resolve(t, entry(t, s, "discovered", "r0"), bindings.resolve, server.fetch)
	if discovered.Document.Nodes[discovered.Root].Pointer != "/components/schemas/Pod" {
		t.Fatalf("discovered root = %q", discovered.Document.Nodes[discovered.Root].Pointer)
	}
	absent, err := entry(t, s, "absent", "r0").Resolve(context.Background(), bindings.resolve, server.fetch)
	if absent.Schema != nil || absent.Binding.State != "absent" || absent.Observation == "" || err != nil {
		t.Fatalf("absent = %+v, %v", absent, err)
	}
	if err := entry(t, s, "absent", "r0").Current(absent.Observation); err != nil {
		t.Fatalf("known absence must have a current observation: %v", err)
	}
	if st := c.Stats(); st.Connections != 1 || st.Entries != 3 || st.Documents != 2 || st.RetainedBytes <= 0 {
		t.Fatalf("stats = %+v", st)
	}
	_, err = s.Entry("static", "missing")
	requireCode(t, err, codeNotFound, "not in the route catalog")
}

func TestResolveUnavailableBinding(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	bindings := bindingMap{
		"forbidden": {"r0": {State: "unavailable", UnavailableReason: new("FORBIDDEN")}},
		"plain":     {"r0": {State: "unavailable"}},
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("forbidden", "r0"), typeOf("plain", "r0")))
	result, err := entry(t, s, "forbidden", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, "FORBIDDEN", "Schema is unavailable for this target.")
	if result.Schema != nil || result.Binding.State != "unavailable" || result.Observation == "" {
		t.Fatalf("unavailable observation = %+v", result)
	}
	_, err = entry(t, s, "plain", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeUnavailable, "")
}

func TestResolveRootAndDialectFailures(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	bindings := bindingMap{
		"badroot":  {"r0": inlineBinding(d2020, podSchema, "#/properties/missing")},
		"oasroot":  {"r0": inlineBinding(dOAS30, `{"components":{"schemas":{"A":{}}}}`, "")},
		"dialect":  {"r0": inlineBinding("https://json-schema.org/draft/2019-09/schema", podSchema, "")},
		"mismatch": {"r0": inlineBinding(dDraft7, `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`, "")},
		"encoded":  {"r0": inlineBinding(d2020, `{"properties":{"a b":{"type":"string"}}}`, "#/properties/a%20b")},
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("badroot", "r0"), typeOf("oasroot", "r0"), typeOf("dialect", "r0"), typeOf("mismatch", "r0"), typeOf("encoded", "r0")))
	_, err := entry(t, s, "badroot", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeInvalidRequest, "schema root does not resolve")
	_, err = entry(t, s, "oasroot", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeInvalidRequest, "schema root does not resolve")
	_, err = entry(t, s, "dialect", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeUnsupported, "unsupported schema dialect")
	_, err = entry(t, s, "mismatch", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeInvalidRequest, "schema document dialect does not match binding")
	encoded := resolve(t, entry(t, s, "encoded", "r0"), bindings.resolve, nil)
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
	bindings := bindingMap{
		"vm":    {"r0": inlineBinding(dOAS30, doc, "#/components/schemas/VM")},
		"other": {"r0": inlineBinding(dOAS30, doc, "#/components/schemas/Spec")},
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("vm", "r0"), typeOf("other", "r0")))
	vm := resolve(t, entry(t, s, "vm", "r0"), bindings.resolve, nil)
	want := []Constraint{
		{Pointer: "/components/schemas/Spec", Keyword: "x-kubernetes-validations"},
		{Pointer: "/components/schemas/VM/properties/ext", Keyword: "$ref"},
	}
	if vm.Validation != ValidationReduced || len(vm.Unvalidated) != 2 || vm.Unvalidated[0] != want[0] || vm.Unvalidated[1] != want[1] {
		t.Fatalf("vm = %s %v", vm.Validation, vm.Unvalidated)
	}
	spec := resolve(t, entry(t, s, "other", "r0"), bindings.resolve, nil)
	if len(spec.Unvalidated) != 1 || spec.Document != vm.Document {
		t.Fatalf("spec = %v (shared document %v)", spec.Unvalidated, spec.Document == vm.Document)
	}
}

func TestResolveBooleanFalseSchemaIsReduced(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("f", "r0")))
	schema := resolve(t, entry(t, s, "f", "r0"), bindingFor("f", inlineBinding(d2020, `{"properties":{"never":false}}`, "")), nil)
	if schema.Validation != ValidationReduced || len(schema.Unvalidated) != 1 || schema.Unvalidated[0] != (Constraint{Pointer: "/properties/never", Keyword: "false"}) {
		t.Fatalf("false schema = %s %v", schema.Validation, schema.Unvalidated)
	}
}

func TestIsolationAcrossConnections(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	other := `{"type":"object","properties":{"different":{"type":"integer"}}}`
	a := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	b := c.Observe(key("b"), catalogOf("c1", typeOf("pod", "r0")))
	sa := resolve(t, entry(t, a, "pod", "r0"), bindingFor("pod", inlineBinding(d2020, podSchema, "")), nil)
	sb := resolve(t, entry(t, b, "pod", "r0"), bindingFor("pod", inlineBinding(d2020, other, "")), nil)
	if sa.Document == sb.Document || sa.Document.Nodes[sa.Root].Properties[0].Name == sb.Document.Nodes[sb.Root].Properties[0].Name {
		t.Fatal("different documents under the same type name must not be shared")
	}
	if string(sa.Document.RawJSON()) != podSchema || string(sb.Document.RawJSON()) != other {
		t.Fatal("target resolution exposed another connection's document")
	}

	same := NewCatalog(DefaultPolicy())
	x := same.Observe(key("x"), catalogOf("c1", typeOf("pod", "r0")))
	y := same.Observe(key("y"), catalogOf("c9", typeOf("pod", "r0")))
	var bindingCalls atomic.Int32
	source := func(ctx context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		bindingCalls.Add(1)
		return bindingFor("pod", inlineBinding(d2020, podSchema, ""))(ctx, request)
	}
	sx, sy := resolve(t, entry(t, x, "pod", "r0"), source, nil), resolve(t, entry(t, y, "pod", "r0"), source, nil)
	if sx.Document != sy.Document || same.Stats().Documents != 1 || bindingCalls.Load() != 2 {
		t.Fatalf("content sharing must not skip route-owned binding resolution: %+v, calls %d", same.Stats(), bindingCalls.Load())
	}
	if entry(t, x, "pod", "r0") == entry(t, y, "pod", "r0") {
		t.Fatal("entries must be per connection")
	}
	same.DropConnection("plugin", "x")
	if st := same.Stats(); st.Documents != 1 || st.Connections != 1 {
		t.Fatalf("after one drop: %+v", st)
	}
	_, err := entry(t, y, "pod", "r0").Resolve(context.Background(), source, nil)
	if err != nil {
		t.Fatalf("other route must remain usable: %v", err)
	}
	_, err = x.Entry("pod", "r0")
	requireCode(t, err, codeResetRequired, "")
	same.DropConnection("plugin", "y")
	if st := same.Stats(); st != (Stats{}) {
		t.Fatalf("after dropping both: %+v", st)
	}
}

func TestObserveReconcilesOnlyChangedTargets(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	cat := catalogOf("c1", typeOf("keep", "r0"), typeOf("change", "r0"))
	s := c.Observe(key("a"), cat)
	if c.Observe(key("a"), cat) != s {
		t.Fatal("unchanged key and revision must return the stored snapshot")
	}
	bindings := bindingMap{
		"keep":   {"r0": inlineBinding(d2020, podSchema, "")},
		"change": {"r0": inlineBinding(d2020, `{"type":"integer"}`, "")},
	}
	keep, changed := entry(t, s, "keep", "r0"), entry(t, s, "change", "r0")
	first, err := keep.Resolve(context.Background(), bindings.resolve, nil)
	if err != nil {
		t.Fatal(err)
	}
	old, err := changed.Resolve(context.Background(), bindings.resolve, nil)
	if err != nil {
		t.Fatal(err)
	}
	keepDescriptor := typeOf("keep", "r0")
	keepDescriptor.DisplayName = "New presentation"
	changeDescriptor := typeOf("change", "r0")
	changeDescriptor.Representations[0].Revision = "rep/2"
	next := c.Observe(key("a"), catalogOf("c2", keepDescriptor, changeDescriptor, typeOf("unrelated")))
	if next != s || next.Revision() != "c2" || next.Provider() != "test" {
		t.Fatal("support-only changes must reconcile the current route snapshot")
	}
	if entry(t, next, "keep", "r0") != keep || entry(t, next, "change", "r0") == changed {
		t.Fatal("only the changed selected format must replace its entry")
	}
	if keep.Descriptor.DisplayName != "keep" {
		t.Fatal("preserved entry descriptor must remain immutable")
	}
	descriptor, err := next.Descriptor("keep")
	if err != nil || descriptor.DisplayName != "New presentation" {
		t.Fatalf("current support descriptor = %+v, %v", descriptor, err)
	}
	if err := keep.Current(first.Observation); err != nil {
		t.Fatalf("unrelated support revision invalidated target observation: %v", err)
	}
	var calls atomic.Int32
	unexpected := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		calls.Add(1)
		return resourcev2.SchemaBinding{}, errors.New("preserved entry unexpectedly re-resolved")
	}
	again := resolve(t, keep, unexpected, nil)
	if again != first.Schema || calls.Load() != 0 {
		t.Fatal("unchanged target must preserve its fresh schema")
	}
	requireCode(t, changed.Current(old.Observation), codeResetRequired, "")
	_, err = changed.Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeResetRequired, "")
	if st := c.Stats(); st.Connections != 1 || st.Entries != 2 || st.Documents != 1 {
		t.Fatalf("changed target must release only its own document: %+v", st)
	}
}

func TestSupportRevisionPreservesPendingTarget(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	started, release, cancelled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		close(started)
		select {
		case <-ctx.Done():
			close(cancelled)
			return resourcev2.SchemaBinding{}, ctx.Err()
		case <-release:
			return inlineBinding(d2020, podSchema, ""), nil
		}
	}
	result := make(chan error, 1)
	go func() { _, err := e.Resolve(context.Background(), source, nil); result <- err }()
	await(t, started)
	updated := typeOf("pod", "r0")
	updated.DisplayName = "Renamed Pod"
	next := c.Observe(key("a"), catalogOf("c2", updated, typeOf("svc", "r0")))
	if entry(t, next, "pod", "r0") != e {
		t.Fatal("unrelated catalog changes replaced pending target")
	}
	select {
	case <-cancelled:
		t.Fatal("support-only revision cancelled demanded schema work")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := await(t, result); err != nil {
		t.Fatalf("preserved pending resolution: %v", err)
	}
}

func TestResolveRetiredCancellationIgnoringWorkCannotPublish(t *testing.T) {
	for _, retirement := range []string{"connection", "plugin", "generation", "epoch", "representation"} {
		t.Run(retirement, func(t *testing.T) {
			c := NewCatalog(DefaultPolicy())
			cat := catalogOf("c1", typeOf("pod", "r0"))
			route := key("a")
			s := c.Observe(route, cat)
			e := entry(t, s, "pod", "r0")
			first, err := e.Resolve(context.Background(), bindingFor("pod", inlineBinding(d2020, podSchema, "")), nil)
			if err != nil {
				t.Fatal(err)
			}
			expireResolution(t, e)
			started, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
			source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
				close(started)
				<-ctx.Done()
				close(cancelled)
				<-release // Simulate a provider that returns data despite cancellation.
				return inlineBinding(d2020, `{"type":"object","properties":{"stale":{}}}`, ""), nil
			}
			result := make(chan error, 1)
			go func() { _, err := e.Resolve(context.Background(), source, nil); result <- err }()
			await(t, started)
			done := resolutionDone(t, e)
			switch retirement {
			case "connection":
				c.DropConnection("plugin", "a")
			case "plugin":
				c.DropPlugin("plugin")
			case "generation":
				route.Generation = "g2"
				c.Observe(route, cat)
			case "epoch":
				route.Epoch++
				c.Observe(route, cat)
			case "representation":
				cat.Revision = "c2"
				cat.Types[0].Representations[0].Revision = "rep/2"
				c.Observe(route, cat)
			}
			await(t, cancelled)
			requireCode(t, await(t, result), codeResetRequired, "")
			requireCode(t, e.Current(first.Observation), codeResetRequired, "")
			releaseOnce.Do(func() { close(release) })
			await(t, done)
			if st := c.Stats(); st.Documents != 0 || st.RetainedBytes != 0 {
				t.Fatalf("retired work republished a document: %+v", st)
			}
			next := c.Observe(route, cat)
			fresh := resolve(t, entry(t, next, "pod", "r0"), bindingFor("pod", inlineBinding(d2020, `{"type":"string"}`, "")), nil)
			if string(fresh.Document.RawJSON()) != `{"type":"string"}` || c.Stats().Documents != 1 {
				t.Fatal("retired result contaminated the replacement target")
			}
		})
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
	bindings := bindingMap{
		"pod":     {"r0": refBinding(d2020, "doc", "")},
		"ref":     {"r0": refBinding(d2020, "doc", "")},
		"dialect": {"r0": refBinding(d2020, "doc", "")},
		"nofetch": {"r0": refBinding(d2020, "doc", "")},
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0"), typeOf("ref", "r0"), typeOf("dialect", "r0"), typeOf("nofetch", "r0")))
	_, err := entry(t, s, "ref", "r0").Resolve(context.Background(), bindings.resolve, wrongRef)
	requireCode(t, err, codeInvalidRequest, "reference does not match")
	_, err = entry(t, s, "dialect", "r0").Resolve(context.Background(), bindings.resolve, wrongDialect)
	requireCode(t, err, codeInvalidRequest, "dialect does not match")
	_, err = entry(t, s, "nofetch", "r0").Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeUnsupported, "provider does not serve schema documents")
	// Deterministic document failures remain cached within the freshness window.
	_, err = entry(t, s, "ref", "r0").Resolve(context.Background(), bindings.resolve, server.fetch)
	requireCode(t, err, codeInvalidRequest, "")
	_, err = entry(t, s, "nofetch", "r0").Resolve(context.Background(), bindings.resolve, server.fetch)
	requireCode(t, err, codeUnsupported, "")
	if server.calls.Load() != 0 {
		t.Fatal("cached document failures must not fetch")
	}

	// Provider failures, including RESOURCE_LIMIT, never become local deterministic outcomes.
	transient := resourcev2.NewError("FORBIDDEN", "denied")
	server.err = transient
	pod := entry(t, s, "pod", "r0")
	if _, err = pod.Resolve(context.Background(), bindings.resolve, server.fetch); !errors.Is(err, transient) {
		t.Fatalf("fetch error = %v, want unwrapped %v", err, transient)
	}
	server.err = resourcev2.NewError("RESOURCE_LIMIT", "provider refuses")
	_, err = pod.Resolve(context.Background(), bindings.resolve, server.fetch)
	requireCode(t, err, codeResourceLimit, "provider refuses")
	server.err = nil
	if schema := resolve(t, pod, bindings.resolve, server.fetch); schema == nil {
		t.Fatal("provider capacity recovery must be immediately retryable")
	}
	if server.calls.Load() != 3 {
		t.Fatalf("fetch calls = %d, want 3", server.calls.Load())
	}
}

func TestResolveProviderBindingFailuresAreNotCached(t *testing.T) {
	for _, code := range []string{"FORBIDDEN", codeResourceLimit} {
		t.Run(code, func(t *testing.T) {
			c := NewCatalog(DefaultPolicy())
			s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
			e := entry(t, s, "pod", "r0")
			providerErr := resourcev2.NewError(code, "provider binding failure")
			var calls atomic.Int32
			source := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
				if calls.Add(1) == 1 {
					return resourcev2.SchemaBinding{}, providerErr
				}
				return inlineBinding(d2020, podSchema, ""), nil
			}
			if _, err := e.Resolve(context.Background(), source, nil); !errors.Is(err, providerErr) {
				t.Fatalf("binding failure = %v, want %v", err, providerErr)
			}
			if schema := resolve(t, e, source, nil); schema == nil || calls.Load() != 2 {
				t.Fatalf("provider recovery was cached: schema %v, calls %d", schema, calls.Load())
			}
		})
	}
}

func TestResolveSingleFlightIncludesBindingLookup(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	source := func(ctx context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-ctx.Done():
			return resourcev2.SchemaBinding{}, ctx.Err()
		case <-release:
			return bindingFor("pod", inlineBinding(d2020, podSchema, ""))(ctx, request)
		}
	}
	type outcome struct {
		result Resolution
		err    error
	}
	results := make(chan outcome, 16)
	for range cap(results) {
		go func() {
			result, err := e.Resolve(context.Background(), source, nil)
			results <- outcome{result, err}
		}()
	}
	await(t, started)
	waitForResolutionWaiters(t, e, cap(results))
	releaseOnce.Do(func() { close(release) })
	var first Resolution
	for i := range cap(results) {
		result := await(t, results)
		if result.err != nil || result.result.Schema == nil {
			t.Fatalf("resolve %d: %+v, %v", i, result.result, result.err)
		}
		if i == 0 {
			first = result.result
		}
		if result.result.Schema != first.Schema || result.result.Observation != first.Observation {
			t.Fatal("one target flight must publish one coherent observation")
		}
	}
	if calls.Load() != 1 || c.Stats().Documents != 1 {
		t.Fatalf("binding calls %d, stats %+v", calls.Load(), c.Stats())
	}
}

func TestSameEntryWaiterCancellationPreservesOtherOwner(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	started, release, cancelled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-ctx.Done():
			close(cancelled)
			return resourcev2.SchemaBinding{}, ctx.Err()
		case <-release:
			return inlineBinding(d2020, podSchema, ""), nil
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := e.Resolve(ctx, source, nil); first <- err }()
	await(t, started)
	go func() { _, err := e.Resolve(context.Background(), source, nil); second <- err }()
	waitForResolutionWaiters(t, e, 2)
	cancel()
	requireCode(t, await(t, first), codeCancelled, "")
	select {
	case <-cancelled:
		t.Fatal("one caller cancelled another caller's binding lookup")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := await(t, second); err != nil {
		t.Fatalf("surviving same-entry resolve: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("binding calls = %d, want 1", calls.Load())
	}
}

func TestSameEntryLastWaiterCancelsOwnedWork(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	started, cancelled := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			close(cancelled)
			return resourcev2.SchemaBinding{}, ctx.Err()
		}
		return inlineBinding(d2020, podSchema, ""), nil
	}
	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel1()
	defer cancel2()
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := e.Resolve(ctx1, source, nil); first <- err }()
	await(t, started)
	go func() { _, err := e.Resolve(ctx2, source, nil); second <- err }()
	waitForResolutionWaiters(t, e, 2)
	done := resolutionDone(t, e)
	cancel1()
	requireCode(t, await(t, first), codeCancelled, "")
	select {
	case <-cancelled:
		t.Fatal("work cancelled before its last waiter left")
	default:
	}
	cancel2()
	requireCode(t, await(t, second), codeCancelled, "")
	await(t, cancelled)
	await(t, done)
	if schema := resolve(t, e, source, nil); schema == nil || calls.Load() != 2 {
		t.Fatalf("retry after last-waiter cancellation: schema %v, calls %d", schema, calls.Load())
	}
}

func TestFreshSequentialSharedReferenceReusesDocumentAcrossRoots(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	server := newDocumentServer(dOAS30, map[string]string{"core": `{"components":{"schemas":{"Pod":` + podSchema + `,"Spec":{"type":"string"}}}}`})
	bindings := bindingMap{
		"pod":    {"r0": refBinding(dOAS30, "core", "#/components/schemas/Pod")},
		"spec":   {"r0": refBinding(dOAS30, "core", "#/components/schemas/Spec")},
		"denied": {"r0": {State: "unavailable", UnavailableReason: new("FORBIDDEN")}},
	}
	var calls atomic.Int32
	source := func(ctx context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		calls.Add(1)
		return bindings.resolve(ctx, request)
	}
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0"), typeOf("spec", "r0"), typeOf("denied", "r0")))
	pod := resolve(t, entry(t, s, "pod", "r0"), source, server.fetch)
	spec := resolve(t, entry(t, s, "spec", "r0"), source, server.fetch)
	if pod.Document != spec.Document || pod.Root == spec.Root || spec.Document.Nodes[spec.Root].Types != TypeString {
		t.Fatal("fresh exact-reference association must share content, not selected roots")
	}
	if server.calls.Load() != 1 || calls.Load() != 2 {
		t.Fatalf("sequential target calls %d, document calls %d", calls.Load(), server.calls.Load())
	}
	denied, err := entry(t, s, "denied", "r0").Resolve(context.Background(), source, server.fetch)
	requireCode(t, err, "FORBIDDEN", "")
	if denied.Schema != nil || denied.Binding.State != "unavailable" || calls.Load() != 3 || server.calls.Load() != 1 {
		t.Fatal("shared document content must not imply access to another target")
	}
}

func TestExactReferenceAssociationsStayWithinRouteAndDialect(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	cat := catalogOf("c1", typeOf("pod", "r0"), typeOf("draft7", "r0"))
	a, b := c.Observe(key("a"), cat), c.Observe(key("b"), cat)
	first := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	second := newDocumentServer(d2020, map[string]string{"doc": `{"type":"integer"}`})
	bindings := bindingMap{
		"pod":    {"r0": refBinding(d2020, "doc", "")},
		"draft7": {"r0": refBinding(dDraft7, "doc", "")},
	}
	sa := resolve(t, entry(t, a, "pod", "r0"), bindings.resolve, first.fetch)
	sb := resolve(t, entry(t, b, "pod", "r0"), bindings.resolve, second.fetch)
	if sa.Document == sb.Document || first.calls.Load() != 1 || second.calls.Load() != 1 {
		t.Fatal("same exact reference on another route must acquire its own document")
	}
	_, err := entry(t, a, "draft7", "r0").Resolve(context.Background(), bindings.resolve, first.fetch)
	requireCode(t, err, codeInvalidRequest, "dialect does not match")
	if first.calls.Load() != 2 {
		t.Fatal("exact-reference success under one dialect must not validate another dialect")
	}
}

func TestResolveFreshnessIsDemandOnlyAndFencesObservations(t *testing.T) {
	if Freshness != 30*time.Second {
		t.Fatalf("freshness = %v, want 30s", Freshness)
	}
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if calls.Add(1) == 1 {
			return inlineBinding(d2020, podSchema, ""), nil
		}
		close(started)
		select {
		case <-ctx.Done():
			return resourcev2.SchemaBinding{}, ctx.Err()
		case <-release:
			binding := inlineBinding(d2020, `{"type":"object","properties":{"new":{}}}`, "")
			binding.Revision = new("schema/2")
			return binding, nil
		}
	}
	first, err := e.Resolve(context.Background(), source, nil)
	if err != nil {
		t.Fatal(err)
	}
	again, err := e.Resolve(context.Background(), source, nil)
	if err != nil || again.Schema != first.Schema || again.Observation != first.Observation || calls.Load() != 1 {
		t.Fatalf("fresh demand = %+v, %v, calls %d", again, err, calls.Load())
	}
	requireCode(t, e.Current(""), codeResetRequired, "")
	expireResolution(t, e)
	if calls.Load() != 1 {
		t.Fatal("expiring an observation must not acquire unrequested schema")
	}
	type outcome struct {
		result Resolution
		err    error
	}
	result := make(chan outcome, 1)
	go func() { r, err := e.Resolve(context.Background(), source, nil); result <- outcome{r, err} }()
	await(t, started)
	requireCode(t, e.Current(first.Observation), codeResetRequired, "")
	releaseOnce.Do(func() { close(release) })
	updated := await(t, result)
	if updated.err != nil || updated.result.Schema == nil || updated.result.Schema.SchemaRevision != "schema/2" || updated.result.Observation == first.Observation || calls.Load() != 2 {
		t.Fatalf("targeted revalidation = %+v, %v, calls %d", updated.result, updated.err, calls.Load())
	}
	requireCode(t, e.Current(first.Observation), codeResetRequired, "")
	if err := e.Current(updated.result.Observation); err != nil {
		t.Fatalf("new observation is not current: %v", err)
	}
	if c.Stats().Documents != 1 {
		t.Fatal("revalidation must release replaced normalized content")
	}
}

func TestResolveHonoursCancellationWhileWaiting(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("a", "r0")))
	e := entry(t, s, "a", "r0")
	started := make(chan struct{})
	owner, stop := context.WithCancel(context.Background())
	defer stop()
	source := func(ctx context.Context, _ resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		close(started)
		<-ctx.Done()
		return resourcev2.SchemaBinding{}, ctx.Err()
	}
	result := make(chan error, 1)
	go func() { _, err := e.Resolve(owner, source, nil); result <- err }()
	await(t, started)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := e.Resolve(ctx, source, nil)
	requireCode(t, err, codeCancelled, "")
	ctx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err = e.Resolve(ctx, source, nil)
	requireCode(t, err, codeTimeout, "")
	stop()
	requireCode(t, await(t, result), codeCancelled, "")
}

func TestRetentionLimits(t *testing.T) {
	documents := []string{podSchema, `{"type":"string"}`, `{"type":"integer"}`}
	types := make([]resourcev2.ResourceType, len(documents))
	bindings := bindingMap{}
	for i, document := range documents {
		name := string(rune('a' + i))
		types[i] = typeOf(name, "r0")
		bindings[name] = map[string]resourcev2.SchemaBinding{"r0": inlineBinding(d2020, document, "")}
	}
	policy := DefaultPolicy()
	policy.MaxRetainedDocuments = 2
	c := NewCatalog(policy)
	s := c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), bindings.resolve, nil)
	resolve(t, entry(t, s, "b", "r0"), bindings.resolve, nil)
	waiting := entry(t, s, "c", "r0")
	_, err := waiting.Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeResourceLimit, "MaxRetainedDocuments")
	c.Observe(key("a"), catalogOf("c2", types[1:]...))
	if resolve(t, waiting, bindings.resolve, nil) == nil || c.Stats().Documents != 2 {
		t.Fatal("global document pressure must be retryable after another target releases capacity")
	}

	measure := NewCatalog(DefaultPolicy())
	ms := measure.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, ms, "a", "r0"), bindings.resolve, nil)
	resolve(t, entry(t, ms, "b", "r0"), bindings.resolve, nil)
	exact := measure.Stats().RetainedBytes

	policy = DefaultPolicy()
	policy.MaxRetainedBytes = exact
	c = NewCatalog(policy)
	s = c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), bindings.resolve, nil)
	resolve(t, entry(t, s, "b", "r0"), bindings.resolve, nil)
	if c.Stats().RetainedBytes != exact {
		t.Fatal("retained bytes differ between identical fixture documents")
	}
	policy.MaxRetainedBytes = exact - 1
	c = NewCatalog(policy)
	s = c.Observe(key("a"), catalogOf("c1", types...))
	resolve(t, entry(t, s, "a", "r0"), bindings.resolve, nil)
	waiting = entry(t, s, "b", "r0")
	_, err = waiting.Resolve(context.Background(), bindings.resolve, nil)
	requireCode(t, err, codeResourceLimit, "MaxRetainedBytes")
	c.Observe(key("a"), catalogOf("c2", types[1:]...))
	if resolve(t, waiting, bindings.resolve, nil) == nil {
		t.Fatal("global retained-byte pressure must not poison the target cache")
	}
}

func TestDocumentSpecificLimitIsCached(t *testing.T) {
	policy := DefaultPolicy()
	policy.MaxDocumentBytes = len(podSchema) - 1
	c := NewCatalog(policy)
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	var calls atomic.Int32
	source := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if calls.Add(1) == 1 {
			return inlineBinding(d2020, podSchema, ""), nil
		}
		return inlineBinding(d2020, `{}`, ""), nil
	}
	for range 2 {
		_, err := e.Resolve(context.Background(), source, nil)
		requireCode(t, err, codeResourceLimit, "MaxDocumentBytes")
	}
	if calls.Load() != 1 || c.Stats().Documents != 0 {
		t.Fatal("local document-specific limits must remain deterministic within freshness")
	}
}

func auxiliaryRequest(connection, id, revision string) resourcev2.SchemaRequest {
	return resourcev2.SchemaRequest{
		Route: resourcev2.AccessRoute{Connection: connection},
		Type:  "helm:releases",
		Target: resourcev2.SchemaTarget{Auxiliary: &resourcev2.AuxiliarySchemaTarget{
			Key: "values", SourceRevision: new(revision),
			Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: "test", Authority: "authority", Type: "helm:releases", ID: id,
				Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}},
			}},
		}},
	}
}

func auxiliaryType() resourcev2.ResourceType {
	typ := typeOf("helm:releases")
	typ.IdentityDimensions = []resourcev2.Dimension{{Name: "namespace"}}
	return typ
}

func targetEntry(t *testing.T, snapshot *Snapshot, request resourcev2.SchemaRequest) *Entry {
	t.Helper()
	e, err := snapshot.Target(request)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestAuxiliaryTargetCoalescesCanonicalScopeAndRetiresOnlyItsRevision(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	typ := auxiliaryType()
	typ.IdentityDimensions = append(typ.IdentityDimensions, resourcev2.Dimension{Name: "account"})
	snapshot := c.Observe(key("a"), catalogOf("c1", typ))
	first := auxiliaryRequest("a", "one", "source/1")
	first.Target.Auxiliary.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}, {Dimension: "account", Value: "opaque/account"}}
	second := auxiliaryRequest("a", "one", "source/1")
	second.Target.Auxiliary.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "account", Value: "opaque/account"}, {Dimension: "namespace", Value: "ns"}}
	one, two := targetEntry(t, snapshot, first), targetEntry(t, snapshot, second)
	if one != two {
		t.Fatal("scope declaration order created a second target owner")
	}
	var calls atomic.Int32
	source := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		calls.Add(1)
		return inlineBinding(d2020, podSchema, ""), nil
	}
	resolved, err := one.Resolve(context.Background(), source, nil)
	if err != nil {
		t.Fatal(err)
	}
	again, err := two.Resolve(context.Background(), source, nil)
	if err != nil || resolved.Observation != again.Observation || calls.Load() != 1 {
		t.Fatalf("canonical target demand = %+v, %v, calls %d", again, err, calls.Load())
	}
	second.Target.Auxiliary.SourceRevision = new("source/2")
	newer := targetEntry(t, snapshot, second)
	if newer == one {
		t.Fatal("a new exact source revision reused the old owner")
	}
	requireCode(t, one.Current(resolved.Observation), codeResetRequired, "")
	if len(snapshot.aux) != 1 {
		t.Fatal("superseded scope-equivalent revision retained another auxiliary owner")
	}
}

func TestTargetedAuxiliaryResolutionAndRevisionOwnership(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", auxiliaryType()))
	oneRequest, twoRequest := auxiliaryRequest("a", "one", "source/1"), auxiliaryRequest("a", "two", "source/1")
	one, two := targetEntry(t, s, oneRequest), targetEntry(t, s, twoRequest)
	if targetEntry(t, s, oneRequest) != one || one == two {
		t.Fatal("auxiliary ownership must identify an exact resource, key and source revision")
	}
	server := newDocumentServer(dDraft7, map[string]string{"values": `{"type":"object","properties":{"replicas":{"type":"integer"}}}`})
	requests := make(chan resourcev2.SchemaRequest, 3)
	source := func(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		requests <- request
		if request.Target.Auxiliary == nil || request.Target.Representation != nil || request.Target.Auxiliary.Key != "values" {
			return resourcev2.SchemaBinding{}, resourcev2.NewError(codeInvalidRequest, "fixture received an untargeted auxiliary request")
		}
		if request.Target.Auxiliary.Reference.Address.ID == "two" {
			return refBinding(dDraft7, "values", ""), nil
		}
		if *request.Target.Auxiliary.SourceRevision == "source/2" {
			return inlineBinding(dDraft7, `{"type":"integer"}`, ""), nil
		}
		return inlineBinding(dDraft7, `{"type":"object"}`, ""), nil
	}
	first, err := one.Resolve(context.Background(), source, server.fetch)
	if err != nil || first.Schema == nil {
		t.Fatalf("first auxiliary resolve = %+v, %v", first, err)
	}
	if request := await(t, requests); request.Route.Connection != "a" || request.Type != "helm:releases" || request.Target.Auxiliary.Reference.Address.ID != "one" {
		t.Fatalf("resolved wrong auxiliary target: %+v", request)
	}
	if len(requests) != 0 || server.calls.Load() != 0 || c.Stats().Documents != 1 {
		t.Fatal("one auxiliary demand must not enumerate or fetch another resource's schema")
	}
	second, err := two.Resolve(context.Background(), source, server.fetch)
	if err != nil || second.Schema == nil {
		t.Fatalf("second auxiliary resolve = %+v, %v", second, err)
	}
	if request := await(t, requests); request.Target.Auxiliary.Reference.Address.ID != "two" {
		t.Fatalf("resolved wrong second resource: %+v", request)
	}
	oneRequest.Target.Auxiliary.SourceRevision = new("source/2")
	replacement := targetEntry(t, s, oneRequest)
	if replacement == one || targetEntry(t, s, twoRequest) != two {
		t.Fatal("source revision must retire only its exact auxiliary target")
	}
	requireCode(t, one.Current(first.Observation), codeResetRequired, "")
	if err := two.Current(second.Observation); err != nil {
		t.Fatalf("another auxiliary resource was retired: %v", err)
	}
	if c.Stats().Documents != 1 {
		t.Fatal("replacing one auxiliary owner must release only its own document")
	}
	updated := resolve(t, replacement, source, server.fetch)
	if updated.Document.Nodes[updated.Root].Types != TypeInteger || server.calls.Load() != 1 || c.Stats().Documents != 2 {
		t.Fatal("replacement auxiliary target did not resolve independently")
	}
	await(t, requests)
	c.DropPlugin("plugin")
	if st := c.Stats(); st != (Stats{}) {
		t.Fatalf("after DropPlugin: %+v", st)
	}
	_, err = replacement.Resolve(context.Background(), source, server.fetch)
	requireCode(t, err, codeResetRequired, "")
}

func TestTargetedAuxiliaryFailurePreservesUnrelatedObservation(t *testing.T) {
	for _, code := range []string{codeCancelled, codeTimeout, codeResetRequired} {
		t.Run(code, func(t *testing.T) {
			c := NewCatalog(DefaultPolicy())
			s := c.Observe(key("a"), catalogOf("c1", auxiliaryType()))
			original := targetEntry(t, s, auxiliaryRequest("a", "original", "source/1"))
			source := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
				return inlineBinding(d2020, `{"type":"string"}`, ""), nil
			}
			first, err := original.Resolve(context.Background(), source, nil)
			if err != nil {
				t.Fatal(err)
			}
			before := c.Stats()
			failing := targetEntry(t, s, auxiliaryRequest("a", "failure", "source/1"))
			failureSource := func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
				return refBinding(d2020, "failure", ""), nil
			}
			providerErr := resourcev2.NewError(code, "provider lifecycle failure")
			fetch := func(context.Context, resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
				return resourcev2.SchemaDocument{}, providerErr
			}
			result, err := failing.Resolve(context.Background(), failureSource, fetch)
			if result.Schema != nil || !errors.Is(err, providerErr) {
				t.Fatalf("targeted failure = %+v, %v; want provider error", result, err)
			}
			if err := original.Current(first.Observation); err != nil {
				t.Fatalf("unrelated target lost its observation: %v", err)
			}
			if got := c.Stats(); got.Documents != before.Documents || got.RetainedBytes != before.RetainedBytes {
				t.Fatalf("unrelated document changed after target failure: before %+v, after %+v", before, got)
			}
		})
	}
}

func TestTargetRequiresExactCurrentSelection(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	request := resourcev2.SchemaRequest{Route: resourcev2.AccessRoute{Connection: "a"}, Type: "pod",
		Target: resourcev2.SchemaTarget{Representation: &resourcev2.Representation{ID: "r0", Revision: "rep/1"}}}
	if targetEntry(t, s, request) != entry(t, s, "pod", "r0") {
		t.Fatal("explicit format target must use its existing catalog entry")
	}
	request.Target.Representation = &resourcev2.Representation{ID: "r0", Revision: "rep/old"}
	_, err := s.Target(request)
	requireCode(t, err, codeResetRequired, "")
	request.Target.Representation = &resourcev2.Representation{ID: "r0", Revision: "rep/1"}
	request.Route.Connection = "other"
	_, err = s.Target(request)
	requireCode(t, err, codeResetRequired, "")
	request.Route.Connection = "a"
	request.Target = resourcev2.SchemaTarget{}
	_, err = s.Target(request)
	requireCode(t, err, codeInvalidRequest, "")
}

func TestActionInputSchemasAreNotEntries(t *testing.T) {
	inputSchema := resourcev2.Schema{}
	typ := typeOf("vm", "r0", "r1")
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
	typ.Representations[0].Revision = "rep/mutated"
	if entries[0].Descriptor.Capabilities[0].Operation != resourcev2.OperationAction || entries[0].Target.Representation.Revision != "rep/1" {
		t.Fatal("immutable entry descriptor and target must not alias the observed catalog")
	}
}

func waitForDocumentWaiters(t *testing.T, s *Snapshot, ref resourcev2.SchemaDocumentReference, dialect string, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.catalog.mu.Lock()
		flight := s.fetches[documentKey{reference: ref, dialect: dialect}]
		ready := flight != nil && flight.waiters == count
		s.catalog.mu.Unlock()
		if ready {
			return
		}
		runtime.Gosched()
	}
	t.Fatalf("document acquisition never reached %d waiters", count)
}

func documentFetchDone(t *testing.T, s *Snapshot, ref resourcev2.SchemaDocumentReference, dialect string) <-chan struct{} {
	t.Helper()
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	flight := s.fetches[documentKey{reference: ref, dialect: dialect}]
	if flight == nil {
		t.Fatal("target has no pending document acquisition")
	}
	return flight.done
}

func TestSharedDocumentFetchPreservesOtherTargetOwner(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("a", "r0"), typeOf("b", "r0")))
	bindings := bindingMap{
		"a": {"r0": refBinding(d2020, "doc", "")},
		"b": {"r0": refBinding(d2020, "doc", "#/properties/spec")},
	}
	a, b := entry(t, s, "a", "r0"), entry(t, s, "b", "r0")
	ref := *bindings["a"]["r0"].DocumentRef
	started, release, cancelled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	fetch := func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-ctx.Done():
			close(cancelled)
			return resourcev2.SchemaDocument{}, ctx.Err()
		case <-release:
			return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := a.Resolve(ctx, bindings.resolve, fetch); first <- err }()
	await(t, started)
	go func() { _, err := b.Resolve(context.Background(), bindings.resolve, fetch); second <- err }()
	waitForDocumentWaiters(t, s, ref, d2020, 2)
	cancel()
	requireCode(t, await(t, first), codeCancelled, "")
	waitForDocumentWaiters(t, s, ref, d2020, 1)
	select {
	case <-cancelled:
		t.Fatal("one target cancelled another target's exact-reference fetch")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := await(t, second); err != nil {
		t.Fatalf("surviving target resolution: %v", err)
	}
	if calls.Load() != 1 || c.Stats().Documents != 1 {
		t.Fatalf("document calls %d, stats %+v", calls.Load(), c.Stats())
	}
	if schema := resolve(t, a, bindings.resolve, fetch); schema == nil || calls.Load() != 1 {
		t.Fatal("cancelled target retry must reuse the surviving target's fresh document association")
	}
}

func TestLastDocumentWaiterCancelsFetchAndAllowsRetry(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	binding := refBinding(d2020, "doc", "")
	source := bindingFor("pod", binding)
	started, cancelled := make(chan struct{}), make(chan struct{})
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
	go func() { _, err := e.Resolve(ctx, source, fetch); result <- err }()
	await(t, started)
	resolvedDone := resolutionDone(t, e)
	fetchedDone := documentFetchDone(t, s, *binding.DocumentRef, d2020)
	cancel()
	requireCode(t, await(t, result), codeCancelled, "")
	await(t, cancelled)
	await(t, resolvedDone)
	await(t, fetchedDone)
	if schema := resolve(t, e, source, fetch); schema == nil || calls.Load() != 2 {
		t.Fatalf("document retry after cancellation: schema %v, calls %d", schema, calls.Load())
	}
}

func TestRouteRetirementRejectsCancellationIgnoringDocumentFetch(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	cat := catalogOf("c1", typeOf("pod", "r0"))
	s := c.Observe(key("a"), cat)
	e := entry(t, s, "pod", "r0")
	binding := refBinding(d2020, "doc", "")
	source := bindingFor("pod", binding)
	started, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	fetch := func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			close(cancelled)
			<-release // The retired provider still returns its stale document.
			return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(`{"type":"integer"}`)}, nil
		}
		return resourcev2.SchemaDocument{Reference: ref, Dialect: d2020, Document: json.RawMessage(podSchema)}, nil
	}
	result := make(chan error, 1)
	go func() { _, err := e.Resolve(context.Background(), source, fetch); result <- err }()
	await(t, started)
	resolvedDone := resolutionDone(t, e)
	fetchedDone := documentFetchDone(t, s, *binding.DocumentRef, d2020)
	c.DropConnection("plugin", "a")
	await(t, cancelled)
	requireCode(t, await(t, result), codeResetRequired, "")
	await(t, resolvedDone)
	releaseOnce.Do(func() { close(release) })
	await(t, fetchedDone)
	if st := c.Stats(); st != (Stats{}) {
		t.Fatalf("retired fetch published content or retained route state: %+v", st)
	}
	next := c.Observe(key("a"), cat)
	fresh := resolve(t, entry(t, next, "pod", "r0"), source, fetch)
	if string(fresh.Document.RawJSON()) != podSchema || calls.Load() != 2 {
		t.Fatal("replacement route reused a retired exact-reference association")
	}
}

func TestExpiredReferenceAssociationRevalidatesOnlyOnDemand(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("a", "r0"), typeOf("b", "r0")))
	binding := refBinding(d2020, "doc", "")
	bindings := bindingMap{
		"a": {"r0": binding},
		"b": {"r0": refBinding(d2020, "doc", "#/properties/spec")},
	}
	server := newDocumentServer(d2020, map[string]string{"doc": podSchema})
	a := entry(t, s, "a", "r0")
	first, err := a.Resolve(context.Background(), bindings.resolve, server.fetch)
	if err != nil {
		t.Fatal(err)
	}
	documentID := documentKey{reference: *binding.DocumentRef, dialect: d2020}
	c.mu.Lock()
	association, ok := s.documents[documentID]
	if ok {
		association.observed = time.Now().Add(-Freshness - time.Second)
		s.documents[documentID] = association
	}
	c.mu.Unlock()
	if !ok {
		t.Fatal("successful exact-reference resolution did not retain its association")
	}
	if server.calls.Load() != 1 || c.Stats().Documents != 1 {
		t.Fatal("association expiry performed unrequested document acquisition")
	}
	second := resolve(t, entry(t, s, "b", "r0"), bindings.resolve, server.fetch)
	if server.calls.Load() != 2 || second.Document != first.Schema.Document || second.Root == first.Schema.Root {
		t.Fatal("expired association must revalidate on demand while preserving immutable content sharing")
	}
	if err := a.Current(first.Observation); err != nil {
		t.Fatalf("another target's document revalidation invalidated a current observation: %v", err)
	}
}

func TestResolvePassesExactSelectedTarget(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0", "r1")))
	requests := make(chan resourcev2.SchemaRequest, 1)
	source := func(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		requests <- request
		return resourcev2.SchemaBinding{State: "absent"}, nil
	}
	e := entry(t, s, "pod", "r1")
	result, err := e.Resolve(context.Background(), source, nil)
	if err != nil || result.Binding.State != "absent" || result.Schema != nil {
		t.Fatalf("selected target resolution = %+v, %v", result, err)
	}
	request := await(t, requests)
	if request.Route.Connection != "a" || request.Type != "pod" || request.Target.Auxiliary != nil ||
		request.Target.Representation == nil || *request.Target.Representation != (resourcev2.Representation{ID: "r1", Revision: "rep/1"}) {
		t.Fatalf("provider received wrong selected target: %+v", request)
	}
}

func TestResolveMissingOptionalResolverIsUnsupported(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("pod", "r0")))
	e := entry(t, s, "pod", "r0")
	result, err := e.Resolve(context.Background(), nil, nil)
	requireCode(t, err, codeUnsupported, "")
	overlay := OverlayFor(e, result.Schema, err)
	if result.Schema != nil || result.Binding.State == "absent" || overlay.HostEvaluation != HostEvaluationUnsupported ||
		overlay.HostEvaluationCode != codeUnsupported || overlay.Validation != ValidationNone {
		t.Fatalf("missing optional resolver must not claim known absence: result %+v, overlay %+v", result, overlay)
	}
}
