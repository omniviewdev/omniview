package graph

import (
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestRemovedCatalogTypeCannotPoisonReplacementCoverage(t *testing.T) {
	g, _, idx, source, _, _ := boundFixture(t, MethodFieldPath)
	sourceType := source.Reference.Address.Type
	g.ObserveDeclarationCatalog(source.PluginID, source.Route, "first", 1, []string{sourceType, "current"})
	idx.OnAdd(source, json.RawMessage(`{"link":"target","account":"a"}`))
	old, _ := g.boundSnapshot(source.PluginID, source.Route, sourceType)
	if len(g.EdgesFrom(source.EntryKey())) != 1 {
		t.Fatal("initial declaration did not extract")
	}
	types := []string{"current"}
	g.ObserveDeclarationCatalog(source.PluginID, source.Route, "replacement", 2, types)
	types[0] = sourceType
	// The removed Type arrives after replacement and captures current context.
	idx.OnAdd(source, json.RawMessage(`{"link":123}`))
	// An extraction captured before replacement also cannot report an error.
	g.unresolvedNode(nodeFromEntry(source), "retired mapping error", old)
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
	if len(g.EdgesFrom(source.EntryKey())) != 0 {
		t.Fatal("removed Type retained derived edges")
	}
	if snapshot, bound := g.boundSnapshot(source.PluginID, source.Route, sourceType); snapshot != nil || bound {
		t.Fatal("removed Type retained context")
	}
	current := makeEntry("current", "", "id")
	idx.OnAdd(current, json.RawMessage(`{}`))
	if g.CheckComplete(source.PluginID, source.Route) == nil {
		t.Fatal("known current Type missing binding was silently complete")
	}
	g.SetNoDeclarations(source.PluginID, source.Route, "current")
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
	g.ClearDeclarationsForConnection(source.PluginID, source.Route)
	idx.OnAdd(source, json.RawMessage(`{}`))
	if g.CheckComplete(source.PluginID, source.Route) == nil {
		t.Fatal("route retirement retained catalog exclusion")
	}
}

func TestCatalogObservationRetiresOnlyRemovedTypeState(t *testing.T) {
	g, _, idx, source, _, _ := boundFixture(t, MethodLabelSelector)
	idx.OnAdd(source, json.RawMessage(`{"link":{"app":"web"},"account":"a"}`))
	if !g.hasSelectors(source.EntryKey()) {
		t.Fatal("selector was not cached")
	}
	oldMissing, _ := g.boundSnapshot(source.PluginID, source.Route, "removed-missing")
	g.RecordDeclarationError(source.PluginID, source.Route, "removed-error", resource.NewError("UNAVAILABLE", "removed declaration"))
	denied := resource.NewError("FORBIDDEN", "current declaration denied")
	g.RecordDeclarationError(source.PluginID, source.Route, "current", denied)
	g.ObserveDeclarationCatalog(source.PluginID, source.Route, "replacement", 2, []string{"current"})
	if g.hasSelectors(source.EntryKey()) {
		t.Fatal("removed Type retained selector")
	}
	g.unresolvedNode(node("k8s", "c1", "removed-missing", "", "id"), "old missing declaration", oldMissing)
	if got := g.CheckComplete(source.PluginID, source.Route); got != denied {
		t.Fatalf("retirement lost current denial: %v", got)
	}
	g.SetNoDeclarations(source.PluginID, source.Route, "current")
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
}
func TestDeclarationCatalogMembershipStaysRouteLocal(t *testing.T) {
	g := NewRelationshipGraph()
	route := resource.AccessRoute{Connection: "one"}
	g.ObserveDeclarationCatalog("p", route, "revision", 1, []string{})
	if snapshot, _ := g.boundSnapshot("p", route, "removed"); snapshot != nil {
		t.Fatal("complete empty catalog did not exclude Type")
	}
	for _, other := range []struct{ plugin, connection string }{{"other", "one"}, {"p", "one/child"}} {
		snapshot, bound := g.boundSnapshot(other.plugin, resource.AccessRoute{Connection: other.connection}, "removed")
		if snapshot == nil || bound {
			t.Fatal("catalog membership crossed plugin or route")
		}
	}
}
