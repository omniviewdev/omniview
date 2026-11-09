package resourcecatalog_test

// P07 acceptance: identical types in different scopes and revisions cannot
// contaminate one another.
//
// The catalog key is (plugin, generation, connection, epoch) plus the catalog
// revision; only immutable normalized documents are shared, and only by content
// digest (spec §2.2). These tests hold every key dimension fixed except one,
// give the same type name different documents, and prove the schema each
// snapshot serves is its own, including while snapshots are being replaced
// concurrently.

import (
	"context"
	"encoding/hex"
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

func p07DigestOf(schema *resourcecatalog.Schema) string {
	return hex.EncodeToString(schema.Document.Digest[:])
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
	observe := func(key resourcecatalog.ConnectionKey, catalogRevision, document, representationRevision string) (*resourcecatalog.Snapshot, *resourcecatalog.Entry) {
		typ := p07Type("instance", []string{"account"}, p07Binding(p07Draft2020, "schema/"+catalogRevision, document))
		typ.Representations[0].Revision = representationRevision
		snapshot := catalog.Observe(key, p07Catalog(catalogRevision, typ))
		entry, err := snapshot.Entry("instance", "native")
		if err != nil {
			t.Fatal(err)
		}
		return snapshot, entry
	}
	resolveEntry := func(entry *resourcecatalog.Entry) *resourcecatalog.Schema {
		t.Helper()
		schema, err := entry.Resolve(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		return schema
	}
	key := func(plugin, generation, connection string, epoch uint64) resourcecatalog.ConnectionKey {
		return resourcecatalog.ConnectionKey{PluginID: plugin, Generation: generation, Connection: connection, Epoch: epoch}
	}

	// Four scopes, one type name and one representation name:
	// alpha and beta differ only by connection; gamma shares alpha's connection
	// name under another plugin; twin carries alpha's exact bytes on a third
	// connection with a different representation revision.
	alphaSnapshot, alphaEntry := observe(key("p1", "g1", "a", 1), "c1", p07Marked("alpha"), "native/1")
	betaSnapshot, betaEntry := observe(key("p1", "g1", "b", 1), "c1", p07Marked("beta"), "native/1")
	gammaSnapshot, gammaEntry := observe(key("p2", "g1", "a", 1), "c1", p07Marked("gamma"), "native/1")
	twinSnapshot, twinEntry := observe(key("p1", "g1", "c", 1), "c1", p07Marked("alpha"), "native/2")
	alpha, beta, gamma, twin := resolveEntry(alphaEntry), resolveEntry(betaEntry), resolveEntry(gammaEntry), resolveEntry(twinEntry)

	for _, tc := range []struct {
		name   string
		schema *resourcecatalog.Schema
		marker string
	}{{"alpha", alpha, "alpha"}, {"beta", beta, "beta"}, {"gamma", gamma, "gamma"}, {"twin", twin, "alpha"}} {
		p07RequireMarker(t, tc.schema, tc.marker)
		navigation := p07Navigate(t, tc.schema)
		if got := p07Fields(navigation); !slices.Equal(got, []string{tc.marker}) {
			t.Fatalf("%s navigation = %v, want [%s]", tc.name, got, tc.marker)
		}
		p07RequireAdmitted(t, tc.schema, `{"`+tc.marker+`":"v"}`, p07Complete)
	}
	// Another scope's property is closed out of this scope's admission.
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
	if alphaEntry == twinEntry || alphaSnapshot == twinSnapshot {
		t.Fatal("entries and snapshots are per connection even when the document is shared")
	}

	// A snapshot serves only documents its own resolved entries reference.
	for _, tc := range []struct {
		name     string
		snapshot *resourcecatalog.Snapshot
		own      *resourcecatalog.Schema
		others   []*resourcecatalog.Schema
	}{
		{"alpha", alphaSnapshot, alpha, []*resourcecatalog.Schema{beta, gamma}},
		{"beta", betaSnapshot, beta, []*resourcecatalog.Schema{alpha, gamma}},
		{"gamma", gammaSnapshot, gamma, []*resourcecatalog.Schema{alpha, beta}},
	} {
		if document, ok := tc.snapshot.Document(p07DigestOf(tc.own)); !ok || document != tc.own.Document {
			t.Fatalf("%s snapshot must serve its own document", tc.name)
		}
		for _, other := range tc.others {
			if _, ok := tc.snapshot.Document(p07DigestOf(other)); ok {
				t.Fatalf("%s snapshot served another scope's document", tc.name)
			}
		}
	}

	// Identical content keeps one CEL content key; every revision dimension still
	// changes the checking identity.
	environment := func(snapshot *resourcecatalog.Snapshot, entry *resourcecatalog.Entry, schema *resourcecatalog.Schema) *celtypes.Environment {
		t.Helper()
		env, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema)
		if err != nil {
			t.Fatal(err)
		}
		return env
	}
	alphaEnv, twinEnv, betaEnv := environment(alphaSnapshot, alphaEntry, alpha), environment(twinSnapshot, twinEntry, twin), environment(betaSnapshot, betaEntry, beta)
	if alphaEnv.ContentKey != twinEnv.ContentKey {
		t.Fatal("identical document bytes must share the CEL content key")
	}
	if alphaEnv.Revision == twinEnv.Revision {
		t.Fatal("a different representation revision must change the CEL environment revision")
	}
	if alphaEnv.ContentKey == betaEnv.ContentKey || alphaEnv.Revision == betaEnv.Revision {
		t.Fatal("different documents must not share a CEL content key or revision")
	}

	// Replacing one dimension at a time retires the old snapshot; it never serves
	// stale or foreign schema and never disturbs the other scopes.
	previous, previousEntry := alphaSnapshot, alphaEntry
	for _, tc := range []struct {
		name     string
		key      resourcecatalog.ConnectionKey
		revision string
		document string
		marker   string
	}{
		{"generation", key("p1", "g2", "a", 1), "c1", p07Marked("alpha"), "alpha"},
		{"epoch", key("p1", "g2", "a", 2), "c1", p07Marked("alpha"), "alpha"},
		{"catalog revision", key("p1", "g2", "a", 2), "c2", p07Marked("alpha_v2"), "alpha_v2"},
	} {
		next, nextEntry := observe(tc.key, tc.revision, tc.document, "native/1")
		if next == previous || nextEntry == previousEntry {
			t.Fatalf("%s change must replace the snapshot", tc.name)
		}
		_, err := previousEntry.Resolve(context.Background(), nil)
		p07RequireResetRequired(t, err, tc.name+": retired snapshot")
		if _, ok := previous.Document(p07DigestOf(alpha)); ok {
			t.Fatalf("%s: retired snapshot still serves a document", tc.name)
		}
		replaced := resolveEntry(nextEntry)
		p07RequireMarker(t, replaced, tc.marker)
		if got := p07Fields(p07Navigate(t, replaced)); !slices.Equal(got, []string{tc.marker}) {
			t.Fatalf("%s: navigation = %v", tc.name, got)
		}
		if _, ok := next.Document(p07DigestOf(beta)); ok {
			t.Fatalf("%s: replacement served the beta scope's document", tc.name)
		}
		previous, previousEntry = next, nextEntry
	}
	// The other scopes are untouched by every replacement above.
	p07RequireMarker(t, resolveEntry(betaEntry), "beta")
	p07RequireMarker(t, resolveEntry(gammaEntry), "gamma")
	p07RequireMarker(t, resolveEntry(twinEntry), "alpha")

	// The catalog revision is the observation identity: the same key and revision
	// returns the stored snapshot and never re-reads different bytes.
	same, sameEntry := observe(key("p1", "g2", "a", 2), "c2", p07Marked("changed_without_new_revision"), "native/1")
	if same != previous || sameEntry != previousEntry {
		t.Fatal("same key and catalog revision must return the stored snapshot")
	}
	p07RequireMarker(t, resolveEntry(sameEntry), "alpha_v2")

	// Dropping a plugin releases only that plugin's documents.
	catalog.DropPlugin("p2")
	if stats := catalog.Stats(); stats.Connections != 3 || stats.Documents != 3 {
		t.Fatalf("after DropPlugin(p2): %+v", stats)
	}
	_, err := gammaEntry.Resolve(context.Background(), nil)
	p07RequireResetRequired(t, err, "dropped plugin")
	p07RequireMarker(t, resolveEntry(betaEntry), "beta")
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
	typ := p07Type("instance", []string{"account"}, p07RefBinding(p07Draft2020, "schema/1", "instance"))
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
	schemas := make([]*resourcecatalog.Schema, len(connections))
	errs := make([]error, len(connections))
	for i, connection := range connections {
		snapshots[i] = catalog.Observe(p07Key("neutral", connection.name), p07Catalog("c1", typ))
	}
	var wg sync.WaitGroup
	for i, connection := range connections {
		wg.Go(func() {
			entry, err := snapshots[i].Entry("instance", "native")
			if err != nil {
				errs[i] = err
				return
			}
			schemas[i], errs[i] = entry.Resolve(context.Background(), serve(connection.marker))
		})
	}
	wg.Wait()
	for i, connection := range connections {
		if errs[i] != nil {
			t.Fatalf("connection %s: %v", connection.name, errs[i])
		}
		p07RequireMarker(t, schemas[i], connection.marker)
	}
	if started.Load() != 2 {
		t.Fatalf("fetches = %d, want one per connection", started.Load())
	}
	if _, ok := snapshots[0].Document(p07DigestOf(schemas[1])); ok {
		t.Fatal("connection a served connection b's document")
	}
	if stats := catalog.Stats(); stats.Documents != 2 || stats.Entries != 2 {
		t.Fatalf("stats = %+v", stats)
	}
}

// TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema replaces
// snapshots at new catalog revisions while workers resolve, navigate and admit
// against them. Every outcome must be the schema of the snapshot the worker
// observed, or RESET_REQUIRED when that snapshot was replaced first.
func TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema(t *testing.T) {
	const slots, workers, rounds, revisions = 6, 24, 250, 40
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	var current [slots]atomic.Int64
	marker := func(slot int, revision int64) string { return fmt.Sprintf("m%d_r%d", slot, revision) }
	observe := func(slot int, revision int64) (*resourcecatalog.Snapshot, *resourcecatalog.Entry) {
		typ := p07Type("instance", []string{"account"}, p07Binding(p07Draft2020, fmt.Sprintf("schema/%d", revision), p07Marked(marker(slot, revision))))
		snapshot := catalog.Observe(p07Key("neutral", fmt.Sprintf("c%d", slot)), p07Catalog(fmt.Sprintf("r%d", revision), typ))
		entry, err := snapshot.Entry("instance", "native")
		if err != nil {
			panic(err)
		}
		return snapshot, entry
	}
	for slot := range slots {
		current[slot].Store(1)
		observe(slot, 1)
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
				observe(slot, revision)
			}
		})
	}
	for worker := range workers {
		wg.Go(func() {
			for round := range rounds {
				slot := (worker + round) % slots
				revision := current[slot].Load()
				snapshot, entry := observe(slot, revision)
				if want := fmt.Sprintf("r%d", revision); snapshot.Revision() != want {
					fail("snapshot revision = %q, want %q", snapshot.Revision(), want)
					return
				}
				schema, err := entry.Resolve(context.Background(), nil)
				if err != nil {
					if code := resourcev2.ErrorCode(err); code != "RESET_REQUIRED" {
						fail("slot %d revision %d: unexpected resolve error %v", slot, revision, err)
						return
					}
					reset.Add(1)
					continue
				}
				resolved.Add(1)
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
		t.Fatal("no worker resolved a schema")
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
