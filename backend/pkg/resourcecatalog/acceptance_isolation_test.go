package resourcecatalog_test

// P07 acceptance: identical types in different scopes and revisions cannot
// contaminate one another.
//
// Each target belongs to one (plugin, generation, connection, epoch) route and
// selected operational format. Only immutable normalized content is shared by
// digest; access still requires the exact target and its current observation.
// Unrelated support revisions preserve unchanged entries.

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

// p07Marked is a closed object whose only property is marker, so a schema's
// identity is observable through navigation and admission.
func p07Marked(marker string) string {
	return `{"type":"object","additionalProperties":false,"properties":{"` + marker + `":{"type":"string"}}}`
}

func p07RequireMarker(t testing.TB, schema *resourcecatalog.Schema, marker string) {
	t.Helper()
	root := schema.Document.Nodes[schema.Root]
	if len(root.Properties) != 1 || root.Properties[0].Name != marker {
		names := make([]string, len(root.Properties))
		for i, property := range root.Properties {
			names[i] = property.Name
		}
		t.Fatalf("schema serves properties %v, want only %q", names, marker)
	}
}

func p07RequireResetRequired(t testing.TB, err error, what string) {
	t.Helper()
	if code := resourcev2.ErrorCode(err); code != "RESET_REQUIRED" {
		t.Fatalf("%s: error = %v (code %q), want RESET_REQUIRED", what, err, code)
	}
}

func TestAcceptanceIdenticalTypeIsolationAcrossScopeAndRevision(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	type scopedFixture struct {
		key      resourcecatalog.ConnectionKey
		snapshot *resourcecatalog.Snapshot
		entry    *resourcecatalog.Entry
		resolve  resourcecatalog.BindingSource
	}
	observe := func(key resourcecatalog.ConnectionKey, catalogRevision, document, representationRevision string) scopedFixture {
		typ := p07Type("instance", []string{"account"})
		typ.Representations[0].Revision = representationRevision
		snapshot := catalog.Observe(key, p07Catalog(catalogRevision, typ))
		entry, err := snapshot.Entry("instance", "native")
		if err != nil {
			t.Fatal(err)
		}
		return scopedFixture{key, snapshot, entry, p07Source(key.Connection, typ, p07Binding(p07Draft2020, "schema/"+catalogRevision, document))}
	}
	resolveEntry := func(fixture scopedFixture) resourcecatalog.Resolution {
		t.Helper()
		resolution, err := fixture.entry.Resolve(context.Background(), fixture.resolve, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := fixture.entry.Current(resolution.Observation); err != nil {
			t.Fatalf("resolved observation is not current: %v", err)
		}
		return resolution
	}
	key := func(plugin, generation, connection string, epoch uint64) resourcecatalog.ConnectionKey {
		return resourcecatalog.ConnectionKey{PluginID: plugin, Generation: generation, Connection: connection, Epoch: epoch}
	}

	// Four scopes, one type name and one representation name. Twin carries
	// alpha's exact bytes under another route and selected format revision.
	alphaFixture := observe(key("p1", "g1", "a", 1), "c1", p07Marked("alpha"), "native/1")
	betaFixture := observe(key("p1", "g1", "b", 1), "c1", p07Marked("beta"), "native/1")
	gammaFixture := observe(key("p2", "g1", "a", 1), "c1", p07Marked("gamma"), "native/1")
	twinFixture := observe(key("p1", "g1", "c", 1), "c1", p07Marked("alpha"), "native/2")
	alphaResult, betaResult := resolveEntry(alphaFixture), resolveEntry(betaFixture)
	gammaResult, twinResult := resolveEntry(gammaFixture), resolveEntry(twinFixture)
	alpha, beta, gamma, twin := alphaResult.Schema, betaResult.Schema, gammaResult.Schema, twinResult.Schema

	fixtures := []struct {
		name    string
		fixture scopedFixture
		result  resourcecatalog.Resolution
		marker  string
	}{
		{"alpha", alphaFixture, alphaResult, "alpha"},
		{"beta", betaFixture, betaResult, "beta"},
		{"gamma", gammaFixture, gammaResult, "gamma"},
		{"twin", twinFixture, twinResult, "alpha"},
	}
	for _, tc := range fixtures {
		p07RequireMarker(t, tc.result.Schema, tc.marker)
		navigation := p07Navigate(t, tc.result.Schema)
		if got := p07Fields(navigation); !slices.Equal(got, []string{tc.marker}) {
			t.Fatalf("%s navigation = %v, want [%s]", tc.name, got, tc.marker)
		}
		p07RequireAdmitted(t, tc.result.Schema, `{"`+tc.marker+`":"v"}`, p07Complete)
		request := resourcev2.SchemaRequest{Route: resourcev2.AccessRoute{Connection: tc.fixture.key.Connection},
			Type: "instance", Target: tc.fixture.entry.Target}
		owned, err := tc.fixture.snapshot.Target(request)
		if err != nil || owned != tc.fixture.entry {
			t.Fatalf("%s exact target = %v, %v", tc.name, owned, err)
		}
		again := resolveEntry(tc.fixture)
		if again.Schema.Document != tc.result.Schema.Document || again.Observation != tc.result.Observation ||
			string(again.Schema.Document.RawJSON()) != p07Marked(tc.marker) {
			t.Fatalf("%s exact target did not retain its resolved document", tc.name)
		}
		for _, other := range fixtures {
			if other.name == tc.name {
				continue
			}
			p07RequireResetRequired(t, tc.fixture.entry.Current(other.result.Observation), tc.name+": foreign observation")
			if other.fixture.key.Connection != tc.fixture.key.Connection {
				foreign := request
				foreign.Route.Connection = other.fixture.key.Connection
				_, err := tc.fixture.snapshot.Target(foreign)
				p07RequireResetRequired(t, err, tc.name+": foreign route")
			}
		}
	}
	p07RequireRejected(t, alpha, `{"beta":"v"}`, p07Complete, "/beta")
	p07RequireRejected(t, beta, `{"alpha":"v"}`, p07Complete, "/alpha")
	p07RequireRejected(t, gamma, `{"alpha":"v"}`, p07Complete, "/alpha")

	if alpha.Document != twin.Document {
		t.Fatal("byte-identical documents under one dialect must share one immutable Document")
	}
	if alpha.Document == beta.Document || alpha.Document == gamma.Document || beta.Document == gamma.Document {
		t.Fatal("documents with different bytes must never share a Document")
	}
	if stats := catalog.Stats(); stats.Connections != 4 || stats.Entries != 4 || stats.Documents != 3 {
		t.Fatalf("stats = %+v, want 4 connections, 4 entries and 3 shared-by-digest documents", stats)
	}
	if alphaFixture.entry == twinFixture.entry || alphaFixture.snapshot == twinFixture.snapshot {
		t.Fatal("entries and snapshots are per connection even when the document is shared")
	}

	// Content sharing does not merge the CEL checking identity.
	environment := func(fixture scopedFixture, schema *resourcecatalog.Schema) *celtypes.Environment {
		t.Helper()
		env, err := celtypes.NewEnvironment(fixture.snapshot.Revision(), fixture.entry, schema)
		if err != nil {
			t.Fatal(err)
		}
		return env
	}
	alphaEnv, twinEnv, betaEnv := environment(alphaFixture, alpha), environment(twinFixture, twin), environment(betaFixture, beta)
	if alphaEnv.ContentKey != twinEnv.ContentKey {
		t.Fatal("identical document bytes must share the CEL content key")
	}
	if alphaEnv.Revision == twinEnv.Revision {
		t.Fatal("a different representation revision must change the CEL environment revision")
	}
	if alphaEnv.ContentKey == betaEnv.ContentKey || alphaEnv.Revision == betaEnv.Revision {
		t.Fatal("different documents must not share a CEL content key or revision")
	}

	// Presentation and unrelated support changes do not retire target ownership
	// or cause a fresh schema observation to be resolved again.
	updatedType := p07Type("instance", []string{"account"})
	updatedType.DisplayName = "renamed instance"
	updated := catalog.Observe(alphaFixture.key, p07Catalog("c2", updatedType, p07Type("unrelated", []string{"account"})))
	updatedEntry, err := updated.Entry("instance", "native")
	if err != nil || updatedEntry != alphaFixture.entry {
		t.Fatalf("unrelated support change replaced the entry: %v, %v", updatedEntry, err)
	}
	descriptor, err := updated.Descriptor("instance")
	if err != nil || descriptor.DisplayName != updatedType.DisplayName || updated.Revision() != "c2" {
		t.Fatalf("support update was not observed: %+v, %v", descriptor, err)
	}
	if again := resolveEntry(alphaFixture); again.Observation != alphaResult.Observation || again.Schema != alpha {
		t.Fatal("unrelated support change invalidated a fresh schema observation")
	}

	// Generation, epoch and selected-format changes retire only their owners.
	previous, previousResult := alphaFixture, alphaResult
	for _, tc := range []struct {
		name                     string
		key                      resourcecatalog.ConnectionKey
		revision, format, marker string
	}{
		{"generation", key("p1", "g2", "a", 1), "c1", "native/1", "alpha"},
		{"epoch", key("p1", "g2", "a", 2), "c1", "native/1", "alpha"},
		{"selected format", key("p1", "g2", "a", 2), "c2", "native/2", "alpha_v2"},
	} {
		next := observe(tc.key, tc.revision, p07Marked(tc.marker), tc.format)
		if next.entry == previous.entry {
			t.Fatalf("%s change must replace the selected entry", tc.name)
		}
		_, err := previous.entry.Resolve(context.Background(), previous.resolve, nil)
		p07RequireResetRequired(t, err, tc.name+": retired target")
		p07RequireResetRequired(t, previous.entry.Current(previousResult.Observation), tc.name+": stale observation")
		_, err = previous.snapshot.Target(resourcev2.SchemaRequest{
			Route: resourcev2.AccessRoute{Connection: previous.key.Connection}, Type: "instance", Target: previous.entry.Target})
		p07RequireResetRequired(t, err, tc.name+": old exact target")
		replaced := resolveEntry(next)
		p07RequireMarker(t, replaced.Schema, tc.marker)
		if got := p07Fields(p07Navigate(t, replaced.Schema)); !slices.Equal(got, []string{tc.marker}) {
			t.Fatalf("%s: navigation = %v", tc.name, got)
		}
		p07RequireResetRequired(t, next.entry.Current(betaResult.Observation), tc.name+": foreign observation")
		previous, previousResult = next, replaced
	}
	p07RequireMarker(t, resolveEntry(betaFixture).Schema, "beta")
	p07RequireMarker(t, resolveEntry(gammaFixture).Schema, "gamma")
	p07RequireMarker(t, resolveEntry(twinFixture).Schema, "alpha")

	// Re-observing support does not smuggle new schema bytes into the entry.
	// A fresh target observation remains cached until targeted revalidation.
	same := observe(key("p1", "g2", "a", 2), "c2", p07Marked("changed_without_schema_demand"), "native/2")
	if same.entry != previous.entry {
		t.Fatal("unchanged selected target must preserve its entry")
	}
	again := resolveEntry(same)
	p07RequireMarker(t, again.Schema, "alpha_v2")
	if again.Observation != previousResult.Observation {
		t.Fatal("fresh demand must reuse the held observation")
	}

	catalog.DropPlugin("p2")
	if stats := catalog.Stats(); stats.Connections != 3 || stats.Documents != 3 {
		t.Fatalf("after DropPlugin(p2): %+v", stats)
	}
	_, err = gammaFixture.entry.Resolve(context.Background(), gammaFixture.resolve, nil)
	p07RequireResetRequired(t, err, "dropped plugin")
	p07RequireResetRequired(t, gammaFixture.entry.Current(gammaResult.Observation), "dropped plugin observation")
	p07RequireMarker(t, resolveEntry(betaFixture).Schema, "beta")
	catalog.DropPlugin("p1")
	if stats := catalog.Stats(); stats != (resourcecatalog.Stats{}) {
		t.Fatalf("after dropping every plugin: %+v", stats)
	}
}

// TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently gives two
// connections the same document reference (ID and revision) while each
// provider route serves different bytes. Both fetches are forced to be in
// flight together: if reference deduplication crossed connections, the second
// fetch would never start.
func TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	typ := p07Type("instance", []string{"account"})
	binding := p07RefBinding(p07Draft2020, "schema/1", "instance")
	var started atomic.Int32
	overlap := make(chan struct{})
	serve := func(marker string) resourcecatalog.DocumentSource {
		return func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
			if started.Add(1) == 2 {
				close(overlap)
			}
			select {
			case <-overlap:
			case <-ctx.Done():
				return resourcev2.SchemaDocument{}, ctx.Err()
			case <-time.After(10 * time.Second):
				return resourcev2.SchemaDocument{}, resourcev2.NewError("TIMEOUT", "the second connection's fetch never started: the reference fetch was shared across connections")
			}
			return resourcev2.SchemaDocument{Reference: ref, Dialect: p07Draft2020, Document: json.RawMessage(p07Marked(marker))}, nil
		}
	}
	connections := []struct{ name, marker string }{{"a", "only_a"}, {"b", "only_b"}}
	snapshots := make([]*resourcecatalog.Snapshot, len(connections))
	entries := make([]*resourcecatalog.Entry, len(connections))
	resolutions := make([]resourcecatalog.Resolution, len(connections))
	errs := make([]error, len(connections))
	for i, connection := range connections {
		snapshots[i] = catalog.Observe(p07Key("neutral", connection.name), p07Catalog("c1", typ))
		entry, err := snapshots[i].Entry("instance", "native")
		if err != nil {
			t.Fatal(err)
		}
		entries[i] = entry
	}
	var wg sync.WaitGroup
	for i, connection := range connections {
		wg.Go(func() {
			resolutions[i], errs[i] = entries[i].Resolve(context.Background(), p07Source(connection.name, typ, binding), serve(connection.marker))
		})
	}
	wg.Wait()
	for i, connection := range connections {
		if errs[i] != nil {
			t.Fatalf("connection %s: %v", connection.name, errs[i])
		}
		p07RequireMarker(t, resolutions[i].Schema, connection.marker)
		if err := entries[i].Current(resolutions[i].Observation); err != nil {
			t.Fatalf("connection %s observation: %v", connection.name, err)
		}
		p07RequireResetRequired(t, entries[i].Current(resolutions[1-i].Observation), "another route's observation")
	}
	if started.Load() != 2 {
		t.Fatalf("fetches = %d, want one per connection", started.Load())
	}
	_, err := snapshots[0].Target(resourcev2.SchemaRequest{Route: resourcev2.AccessRoute{Connection: connections[1].name},
		Type: "instance", Target: entries[1].Target})
	p07RequireResetRequired(t, err, "another connection's exact target")
	if stats := catalog.Stats(); stats.Documents != 2 || stats.Entries != 2 {
		t.Fatalf("stats = %+v", stats)
	}
}

// TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema replaces
// selected formats while workers resolve, navigate and admit. A worker receives
// its exact target's schema or RESET_REQUIRED; stale observations cannot publish.
func TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema(t *testing.T) {
	const slots, workers, rounds, revisions = 6, 24, 250, 40
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	var current [slots]atomic.Int64
	marker := func(slot int, revision int64) string { return fmt.Sprintf("m%d_r%d", slot, revision) }
	support := func(revision int64) resourcev2.Catalog {
		typ := p07Type("instance", []string{"account"})
		typ.Representations[0].Revision = fmt.Sprintf("native/%d", revision)
		return p07Catalog(fmt.Sprintf("r%d", revision), typ)
	}
	key := func(slot int) resourcecatalog.ConnectionKey { return p07Key("neutral", fmt.Sprintf("c%d", slot)) }
	for slot := range slots {
		current[slot].Store(1)
		catalog.Observe(key(slot), support(1))
	}

	var resolved, reset atomic.Int64
	failures := make(chan error, workers+slots)
	fail := func(format string, args ...any) {
		select {
		case failures <- fmt.Errorf(format, args...):
		default:
		}
	}
	var wg sync.WaitGroup
	for slot := range slots {
		wg.Go(func() {
			for revision := int64(2); revision <= revisions; revision++ {
				current[slot].Store(revision)
				catalog.Observe(key(slot), support(revision))
			}
		})
	}
	for worker := range workers {
		wg.Go(func() {
			for round := range rounds {
				slot := (worker + round) % slots
				revision := current[slot].Load()
				routeKey := key(slot)
				descriptor := support(revision)
				snapshot := catalog.Observe(routeKey, descriptor)
				representation := descriptor.Types[0].Representations[0]
				entry, err := snapshot.Target(resourcev2.SchemaRequest{
					Route: resourcev2.AccessRoute{Connection: routeKey.Connection}, Type: "instance",
					Target: resourcev2.SchemaTarget{Representation: &representation}})
				if err != nil {
					if resourcev2.ErrorCode(err) != "RESET_REQUIRED" {
						fail("slot %d revision %d: unexpected target error %v", slot, revision, err)
						return
					}
					reset.Add(1)
					continue
				}
				resolve := p07Source(routeKey.Connection, descriptor.Types[0],
					p07Binding(p07Draft2020, fmt.Sprintf("schema/%d", revision), p07Marked(marker(slot, revision))))
				resolution, err := entry.Resolve(context.Background(), resolve, nil)
				if err != nil {
					if code := resourcev2.ErrorCode(err); code != "RESET_REQUIRED" {
						fail("slot %d revision %d: unexpected resolve error %v", slot, revision, err)
						return
					}
					reset.Add(1)
					continue
				}
				schema := resolution.Schema
				want := marker(slot, revision)
				root := schema.Document.Nodes[schema.Root]
				if len(root.Properties) != 1 || root.Properties[0].Name != want {
					fail("slot %d revision %d served %+v, want only %q", slot, revision, root.Properties, want)
					return
				}
				if _, err := p07Admit(schema, resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{want: {Kind: "string", String: "v"}}}, p07Complete); err != nil {
					fail("slot %d revision %d rejected its own property: %v", slot, revision, err)
					return
				}
				foreign := marker((slot+1)%slots, revision)
				if _, err := p07Admit(schema, resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{foreign: {Kind: "string", String: "v"}}}, p07Complete); err == nil {
					fail("slot %d revision %d admitted another slot's property %q", slot, revision, foreign)
					return
				}
				navigation, err := resourcecatalog.Navigate(context.Background(), schema, nil, resourcecatalog.DefaultPolicy())
				if err != nil || len(navigation.Fields) != 1 || navigation.Fields[0].Segment.Name != want {
					fail("slot %d revision %d navigation = %+v, %v", slot, revision, navigation.Fields, err)
					return
				}
				if err := entry.Current(resolution.Observation); err != nil {
					if resourcev2.ErrorCode(err) != "RESET_REQUIRED" {
						fail("slot %d revision %d: unexpected observation error %v", slot, revision, err)
						return
					}
					reset.Add(1)
					continue
				}
				resolved.Add(1)
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	t.Logf("%d resolutions served their own schema, %d observed RESET_REQUIRED after replacement", resolved.Load(), reset.Load())
	if resolved.Load() == 0 {
		t.Fatal("no worker resolved a current schema")
	}
	stats := catalog.Stats()
	if stats.Connections != slots || stats.Entries != slots || stats.Documents > slots {
		t.Fatalf("stats = %+v", stats)
	}
	catalog.DropPlugin("neutral")
	if stats := catalog.Stats(); stats != (resourcecatalog.Stats{}) {
		t.Fatalf("after DropPlugin: %+v", stats)
	}
}

func TestAcceptanceSupportRefreshPreservesInflightTargetButFormatChangeCancels(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	key := p07Key("neutral", "a")
	t.Cleanup(func() { catalog.DropConnection(key.PluginID, key.Connection) })
	typ := p07Type("instance", []string{"account"})
	snapshot := catalog.Observe(key, p07Catalog("c1", typ))
	entry, err := snapshot.Entry("instance", "native")
	if err != nil {
		t.Fatal(err)
	}
	started, canceled, released, returned := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(released) }) }
	t.Cleanup(release)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	oldSource := p07Source(key.Connection, typ, p07Binding(p07Draft2020, "schema/old", p07Marked("old")))
	var providerContext context.Context
	resolve := func(ctx context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		defer close(returned)
		providerContext = ctx
		close(started)
		<-ctx.Done()
		close(canceled)
		<-released
		// A provider may finish after cancellation. Its result must stay retired.
		return oldSource(context.Background(), request)
	}
	type result struct {
		resolution resourcecatalog.Resolution
		err        error
	}
	done := make(chan result, 1)
	go func() {
		resolution, err := entry.Resolve(ctx, resolve, nil)
		done <- result{resolution, err}
	}()
	await := func(signal <-chan struct{}, name string) {
		t.Helper()
		select {
		case <-signal:
		case <-time.After(10 * time.Second):
			t.Fatalf("timed out waiting for %s", name)
		}
	}
	await(started, "targeted resolver")

	updatedType := p07Type("instance", []string{"account"})
	updatedType.DisplayName = "renamed instance"
	updated := catalog.Observe(key, p07Catalog("c2", updatedType, p07Type("unrelated", []string{"account"})))
	unchanged, err := updated.Entry("instance", "native")
	if err != nil || unchanged != entry {
		t.Fatalf("support refresh replaced the in-flight target: %v, %v", unchanged, err)
	}
	if err := providerContext.Err(); err != nil {
		t.Fatalf("unrelated support refresh canceled provider context: %v", err)
	}
	select {
	case <-canceled:
		t.Fatal("unrelated support refresh canceled targeted schema work")
	case <-done:
		t.Fatal("pending targeted schema work completed before its provider")
	default:
	}

	updatedType.Representations[0].Revision = "native/2"
	next := catalog.Observe(key, p07Catalog("c3", updatedType))
	await(canceled, "retired target cancellation")
	release()
	await(returned, "late provider result")
	select {
	case outcome := <-done:
		p07RequireResetRequired(t, outcome.err, "retired in-flight target")
		if outcome.resolution.Schema != nil || outcome.resolution.Observation != "" {
			t.Fatalf("retired waiter published %+v", outcome.resolution)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("retired target waiter did not finish")
	}
	p07RequireResetRequired(t, entry.Current(""), "retired target observation")
	_, err = next.Target(resourcev2.SchemaRequest{Route: resourcev2.AccessRoute{Connection: key.Connection},
		Type: typ.Type, Target: entry.Target})
	p07RequireResetRequired(t, err, "retired exact format")

	current, err := next.Entry("instance", "native")
	if err != nil {
		t.Fatal(err)
	}
	resolution, err := current.Resolve(context.Background(),
		p07Source(key.Connection, updatedType, p07Binding(p07Draft2020, "schema/new", p07Marked("new"))), nil)
	if err != nil {
		t.Fatal(err)
	}
	p07RequireMarker(t, resolution.Schema, "new")
	if err := current.Current(resolution.Observation); err != nil {
		t.Fatalf("replacement observation: %v", err)
	}
	_, err = entry.Resolve(context.Background(), oldSource, nil)
	p07RequireResetRequired(t, err, "late provider cannot revive its old owner")
}
