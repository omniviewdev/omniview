package graph

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// setTestDeclarations supplies the explicit schema used by the legacy fixtures.
func setTestDeclarations(g *RelationshipGraph, plugin string, route resource.AccessRoute, sourceType string, decls []resource.RelationshipDescriptor) {
	dimensions := map[string][]resource.Dimension{
		"core::v1::Pod": {{Name: "namespace"}}, "core::v1::Service": {{Name: "namespace"}},
		"apps::v1::ReplicaSet": {{Name: "namespace"}}, "apps::v1::Deployment": {{Name: "namespace"}},
		"core::v1::ConfigMap": {{Name: "namespace"}}, "networking::v1::NetworkPolicy": {{Name: "namespace"}},
		"example::v1::Group": {{Name: "namespace"}}, "target/type": {{Name: "account"}},
	}
	target := func(typ string) TargetBinding {
		return TargetBinding{Target: resource.ReadTarget{Route: route, Provider: plugin, Authority: "authority:" + route.Connection, Type: typ}, IdentityDimensions: dimensions[typ]}
	}
	bindings := DeclarationBindings{Source: target(sourceType)}
	seen := map[string]bool{}
	for _, decl := range decls {
		if !seen[decl.TargetType] {
			bindings.Targets = append(bindings.Targets, target(decl.TargetType))
			seen[decl.TargetType] = true
		}
	}
	if err := g.SetBoundDeclarations(plugin, route, sourceType, decls, bindings); err != nil {
		panic(err)
	}
}

func boundFixture(t *testing.T, method string) (*RelationshipGraph, *registry.MemoryStore, *Indexer, registry.ResourceEntry, DeclarationBindings, resource.RelationshipDescriptor) {
	t.Helper()
	g, store, idx := setupIndexer()
	source := makeEntry("opaque/source", "", "source/id")
	source.Reference.Address.Authority = "unknown:source"
	source.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "tenant", Value: "source"}}
	binding := DeclarationBindings{
		Source:      TargetBinding{Target: resource.ReadTarget{Route: source.Route, Provider: "k8s", Authority: "unknown:source", Type: "opaque/source"}, IdentityDimensions: []resource.Dimension{{Name: "tenant"}}},
		Targets:     []TargetBinding{{Target: resource.ReadTarget{Route: resource.AccessRoute{Connection: "target/route"}, Provider: "other-provider", Authority: "unknown:target", Type: "opaque/target"}, IdentityDimensions: []resource.Dimension{{Name: "account"}, {Name: "zone"}}}},
		SourceEpoch: 1,
	}
	decl := resource.RelationshipDescriptor{Type: resource.RelUses, TargetType: "opaque/target", TargetScope: []resource.ScopeEntry{{Dimension: "zone", Value: "west"}}, ScopeExtractors: []resource.ScopeExtractor{{Dimension: "account", FieldPath: "account"}}, Extractor: &resource.RelationshipExtractor{Method: method, FieldPath: "link"}}
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, binding); err != nil {
		t.Fatal(err)
	}
	return g, store, idx, source, binding, decl
}

func TestBoundFieldPathUsesTargetIdentity(t *testing.T) {
	g, _, idx, source, _, _ := boundFixture(t, MethodFieldPath)
	idx.OnAdd(source, json.RawMessage(`{"link":"native/id","account":"a/b"}`))
	edges := g.EdgesFrom(source.EntryKey())
	if len(edges) != 1 {
		t.Fatalf("want target edge, got %v", edges)
	}
	target := edges[0].Target
	if target.Reference.Address.Authority != "unknown:target" || target.Reference.Address.Provider != "other-provider" || target.Route.Connection != "target/route" || !scopeMatches(target.Reference.Address.Scope, []resource.ScopeEntry{{Dimension: "account", Value: "a/b"}, {Dimension: "zone", Value: "west"}}) {
		t.Fatalf("wrong target identity: %+v", target)
	}
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
}

func TestBoundExtractionReportsIncomplete(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		change     func(*DeclarationBindings)
	}{
		{name: "missing mapping", body: `{"link":"id"}`},
		{name: "numeric ID", body: `{"link":123,"account":"a"}`},
		{name: "missing binding", body: `{"link":"id","account":"a"}`, change: func(b *DeclarationBindings) { b.Targets = nil }},
		{name: "no inherited dimension", body: `{"link":"id","account":"a"}`, change: func(b *DeclarationBindings) {
			b.Targets[0].IdentityDimensions = append(b.Targets[0].IdentityDimensions, resource.Dimension{Name: "tenant"})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
			if tc.change != nil {
				tc.change(&bindings)
				if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
					t.Fatal(err)
				}
			}
			idx.OnAdd(source, json.RawMessage(tc.body))
			if len(g.EdgesFrom(source.EntryKey())) != 0 {
				t.Fatal("unbound edge emitted")
			}
			if g.CheckComplete(source.PluginID, source.Route) == nil {
				t.Fatal("missing explicit incomplete error")
			}
		})
	}
}

func TestBoundAbsentOptionalFieldIsComplete(t *testing.T) {
	g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
	bindings.Targets = nil
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
		t.Fatal(err)
	}
	idx.OnAdd(source, json.RawMessage(`{}`))
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
}

func TestBoundSelectorsCrossTargetAuthority(t *testing.T) {
	for _, late := range []bool{false, true} {
		t.Run(map[bool]string{false: "existing", true: "late"}[late], func(t *testing.T) {
			g, store, idx, source, bindings, _ := boundFixture(t, MethodLabelSelector)
			target := registry.ResourceEntry{PluginID: source.PluginID, Route: bindings.Targets[0].Target.Route, Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: "other-provider", Authority: "unknown:target", Type: "opaque/target", ID: "target", Scope: []resource.ScopeEntry{{Dimension: "account", Value: "a"}, {Dimension: "zone", Value: "west"}}}}, Labels: map[string]string{"app": "web"}}
			var rejected []registry.ResourceEntry
			for _, kind := range []string{"authority", "provider", "scope", "extra dimension", "route"} {
				wrong := target
				wrong.Reference.Address.ID = kind
				switch kind {
				case "authority":
					wrong.Reference.Address.Authority = source.Reference.Address.Authority
				case "provider":
					wrong.Reference.Address.Provider = source.Reference.Address.Provider
				case "scope":
					wrong.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "account", Value: "other"}, {Dimension: "zone", Value: "west"}}
				case "extra dimension":
					wrong.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "account", Value: "a"}, {Dimension: "zone", Value: "west"}, {Dimension: "tenant", Value: "source"}}
				case "route":
					wrong.Route = source.Route
				}
				rejected = append(rejected, wrong)
				if !late {
					store.Put(wrong)
				}
			}
			if !late {
				store.Put(target)
			}
			idx.OnAdd(source, json.RawMessage(`{"link":{"app":"web"},"account":"a"}`))
			if late {
				store.Put(target)
				idx.OnAdd(target, json.RawMessage(`{}`))
			}
			if late {
				for _, wrong := range rejected {
					store.Put(wrong)
					idx.OnAdd(wrong, json.RawMessage(`{}`))
				}
			}
			if len(g.EdgesFrom(source.EntryKey())) != 1 {
				t.Fatal("selector did not match distinct target authority")
			}
			g.ClearDeclarationsForConnection(source.PluginID, source.Route)
			if g.hasSelectors(source.EntryKey()) {
				t.Fatal("retired selector survived")
			}
			if _, _, ok := g.GetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type); ok {
				t.Fatal("retired declaration survived")
			}
		})
	}
}

func TestBoundPublicationFreezesAndRetiresSnapshots(t *testing.T) {
	g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
	values := []string{"a"}
	bindings.Targets[0].Target.Scope = resource.QueryScope{{Dimension: "account", Match: resource.ScopeOneOf, Values: &values}}
	decl.Extractor.LabelSelector = map[string]string{"fixed": "before"}
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
		t.Fatal(err)
	}
	old, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	values[0] = "mutated"
	bindings.Targets[0].IdentityDimensions[0].Name = "mutated"
	decl.Extractor.LabelSelector["fixed"] = "mutated"
	returnedDecls, returnedBindings, _ := g.GetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type)
	if returnedDecls[0].Extractor.LabelSelector["fixed"] != "before" {
		t.Fatal("declaration input mutated snapshot")
	}
	(*returnedBindings.Targets[0].Target.Scope[0].Values)[0] = "mutated getter"
	returnedBindings.Source.IdentityDimensions[0].Name = "mutated getter"
	idx.OnAdd(source, json.RawMessage(`{"link":"id","account":"a"}`))
	if len(g.EdgesFrom(source.EntryKey())) != 1 {
		t.Fatal("binding input or getter mutated snapshot")
	}
	g.SetNoDeclarations(source.PluginID, source.Route, source.Reference.Address.Type)
	oldDecl := old.declarations[0]
	oldDecl.TargetScope = append([]resource.ScopeEntry{{Dimension: "account", Value: "a"}}, oldDecl.TargetScope...)
	idx.extractFieldPath(nodeFromEntry(source), source, json.RawMessage(`{"link":"late"}`), oldDecl, old.bindings.Targets[0], old)
	if len(g.EdgesFrom(source.EntryKey())) != 0 {
		t.Fatal("retired extraction republished an edge")
	}
	idx.OnAdd(source, json.RawMessage(`{"link":"ignored"}`))
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
}

func TestBoundDeclarationErrorsRemainIndependent(t *testing.T) {
	g := NewRelationshipGraph()
	route := resource.AccessRoute{Connection: "route"}
	g.RecordDeclarationError("p", route, "", fmt.Errorf("catalog unavailable"))
	g.RecordDeclarationError("p", route, "first", fmt.Errorf("first unavailable"))
	g.SetNoDeclarations("p", route, "second")
	g.RecordDeclarationError("p", route, "", nil)
	if g.CheckComplete("p", route) == nil {
		t.Fatal("one type success cleared another type failure")
	}
	g.ClearDeclarationsForConnection("p", route)
	if err := g.CheckComplete("p", route); err != nil {
		t.Fatal(err)
	}
}

func TestBoundPublicationIsIdempotent(t *testing.T) {
	g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
	idx.OnAdd(source, json.RawMessage(`{"link":"id","account":"a"}`))
	before, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
		t.Fatal(err)
	}
	after, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	if before != after || len(g.EdgesFrom(source.EntryKey())) != 1 {
		t.Fatal("identical publication retired valid observations")
	}
}

func TestBoundPermissionDenialDominatesPartialState(t *testing.T) {
	g := NewRelationshipGraph()
	route := resource.AccessRoute{Connection: "route"}
	g.RecordDeclarationError("p", route, "unavailable", resource.NewError("UNAVAILABLE", "catalog unavailable"))
	denied := resource.NewError("FORBIDDEN", "target denied")
	g.RecordDeclarationError("p", route, "denied", denied)
	missing, _ := g.boundSnapshot("p", route, "source")
	g.unresolvedNode(node("p", "route", "source", "", "id"), "mapping missing", missing)
	if got := g.CheckComplete("p", route); got != denied {
		t.Fatalf("permission denial classification lost: %v", got)
	}
}

func TestRetiredExtractionCannotPublishIncompleteCoverage(t *testing.T) {
	g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
	old, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	bindings.SourceEpoch++
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
		t.Fatal(err)
	}
	// Resume old extraction after replacement. Invalid IDs must not poison
	// the current snapshot's whole-result coverage.
	idx.extractFieldPath(nodeFromEntry(source), source, json.RawMessage(`{"link":123}`), old.declarations[0], old.bindings.Targets[0], old)
	g.unresolvedNode(nodeFromEntry(source), "retired missing scope", old)
	g.unresolvedNode(nodeFromEntry(source), "retired missing source binding", nil)
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
	current, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	g.unresolvedNode(nodeFromEntry(source), "current missing scope", current)
	if g.CheckComplete(source.PluginID, source.Route) == nil {
		t.Fatal("current extraction failure was dropped")
	}
}

func TestRetiredMissingSourceCannotRepublishAfterRouteClear(t *testing.T) {
	g := NewRelationshipGraph()
	source := node("p", "route", "source", "", "id")
	old, bound := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	if bound {
		t.Fatal("unexpected source binding")
	}
	g.ClearDeclarationsForConnection(source.PluginID, source.Route)
	current, _ := g.boundSnapshot(source.PluginID, source.Route, source.Reference.Address.Type)
	g.unresolvedNode(source, "retired missing source", old)
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
	g.unresolvedNode(source, "current missing source", current)
	if g.CheckComplete(source.PluginID, source.Route) == nil {
		t.Fatal("current missing source was dropped")
	}
}

func TestQueuedRetiredSourceCannotPoisonReplacementCoverage(t *testing.T) {
	for _, change := range []string{"authority", "scope"} {
		t.Run(change, func(t *testing.T) {
			g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
			bindings.SourceEpoch++
			current := source
			if change == "authority" {
				bindings.Source.Target.Authority = "replacement:source"
				current.Reference.Address.Authority = "replacement:source"
			} else {
				values := []string{"replacement"}
				bindings.Source.Target.Scope = resource.QueryScope{{Dimension: "tenant", Match: resource.ScopeOneOf, Values: &values}}
				current.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "tenant", Value: "replacement"}}
			}
			if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
				t.Fatal(err)
			}
			// Both observations capture replacement declarations; only the current
			// source can derive edges or report incomplete replacement coverage.
			idx.OnAdd(source, json.RawMessage(`{"link":123}`))
			if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
				t.Fatal(err)
			}
			if len(g.EdgesFrom(source.EntryKey())) != 0 {
				t.Fatal("retired source derived an edge")
			}
			idx.OnAdd(current, json.RawMessage(`{"link":"id","account":"a"}`))
			if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
				t.Fatal(err)
			}
			if len(g.EdgesFrom(current.EntryKey())) != 1 {
				t.Fatal("current source did not use replacement declarations")
			}
		})
	}
}

func TestBoundGraphQueryOnlyDimensionsStayOutsideIdentity(t *testing.T) {
	g, _, idx, source, bindings, decl := boundFixture(t, MethodFieldPath)
	tenant, account := []string{"source"}, []string{"a/b"}
	bindings.Source.Target.Scope = resource.QueryScope{{Dimension: "tenant", Match: resource.ScopeOneOf, Values: &tenant}, {Dimension: "repository", Match: resource.ScopeAny}}
	bindings.Targets[0].Target.Scope = resource.QueryScope{{Dimension: "account", Match: resource.ScopeOneOf, Values: &account}, {Dimension: "zone", Match: resource.ScopeAny}, {Dimension: "repository", Match: resource.ScopeAny}}
	if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, bindings); err != nil {
		t.Fatal(err)
	}
	idx.OnAdd(source, json.RawMessage(`{"link":"repository-X/opaque-looking-ID","account":"a/b"}`))
	edges := g.EdgesFrom(source.EntryKey())
	if len(edges) != 1 || len(edges[0].Target.Reference.Address.Scope) != 2 {
		t.Fatalf("query-only dimension became identity or rejected exact mapping: %+v", edges)
	}
	if err := g.CheckComplete(source.PluginID, source.Route); err != nil {
		t.Fatal(err)
	}
	malformed := nodeFromEntry(source)
	malformed.Reference.Address.Scope = nil
	if bindingMatches(bindings.Source, malformed) {
		t.Fatal("any query selection accepted missing identity dimensions")
	}
	for _, target := range []bool{false, true} {
		candidate := cloneBoundSet(boundSet{bindings: bindings}).bindings
		repository := []string{"repository-X"}
		constraint := resource.ScopeConstraint{Dimension: "repository", Match: resource.ScopeOneOf, Values: &repository}
		if target {
			candidate.Targets[0].Target.Scope[2] = constraint
		} else {
			candidate.Source.Target.Scope[1] = constraint
		}
		if err := g.SetBoundDeclarations(source.PluginID, source.Route, source.Reference.Address.Type, []resource.RelationshipDescriptor{decl}, candidate); resource.ErrorCode(err) != "UNSUPPORTED" {
			t.Fatalf("graph admitted unproven query-only membership: %v", err)
		}
	}
}
